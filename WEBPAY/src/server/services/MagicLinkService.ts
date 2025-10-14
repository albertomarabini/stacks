import crypto from "crypto";
import { IBridgeClient } from "../../shared/contracts/interfaces";
import { MagicLinkPayload, InvoiceDTO } from "../../shared/models/dto";

/**
 * MagicLinkService
 *
 * Handles full parsing, validation, HMAC, TTL/expiry, and business rules for the magic-link `u` blob.
 * Delegated to by PublicRouteHandlers. Injects BridgeClient as per DI contract.
 */
export class MagicLinkService {
  private bridgeClient: IBridgeClient;
  private deploymentNetwork: string;

  /**
   * @param bridgeClient Fully constructed instance of BridgeClient
   * @param deploymentNetwork Network string to compare (e.g. "mainnet" or "testnet")
   */
  constructor(bridgeClient: IBridgeClient, deploymentNetwork: string) {
    this.bridgeClient = bridgeClient;
    this.deploymentNetwork = deploymentNetwork;
  }

  /**
   * Validates and parses the magic-link `u` blob.
   * @param u_blob base64url-encoded magic-link payload
   * @param context { storeId, invoiceId }
   * @throws Error (with status property) if validation fails at any step
   * @returns { payload, invoice }
   */
  async validateAndParse(
    u_blob: string,
    context: { storeId: string; invoiceId: string }
  ): Promise<{ payload: MagicLinkPayload; invoice: InvoiceDTO }> {
    // Step 1: base64url-decode and parse JSON
    let decoded: string;
    let payload: MagicLinkPayload;
    try {
      decoded = this.base64UrlDecode(u_blob);
      payload = JSON.parse(decoded);
    } catch {
      const err = new Error("Invalid payment parameter: could not decode payload.");
      (err as any).status = 400;
      throw err;
    }

    // Step 2: Check required fields
    const { storeId: pStoreId, invoiceId: pInvoiceId, sig, unsignedCall, exp, v } = payload as any;
    if (
      !sig ||
      typeof sig !== "string" ||
      typeof pStoreId !== "string" ||
      typeof pInvoiceId !== "string" ||
      typeof exp !== "number" ||
      typeof unsignedCall !== "object"
    ) {
      const err = new Error("Malformed magic-link payload.");
      (err as any).status = 400;
      throw err;
    }

    // Step 3: Fetch HMAC secret for store
    let hmacSecret: string;
    try {
      const storeProfile = await this.bridgeClient.getProfile(context.storeId);
      hmacSecret = storeProfile.hmacSecret;
      if (typeof hmacSecret !== "string" || !hmacSecret) throw new Error();
    } catch {
      const err = new Error("Could not retrieve HMAC secret for store.");
      (err as any).status = 500;
      throw err;
    }

    // Step 4: Canonical JSON serialization for HMAC (stable order)
    const canonicalFields = { v, storeId: pStoreId, invoiceId: pInvoiceId, unsignedCall, exp };
    const canonicalJson = this.stableStringify(canonicalFields);

    // Step 5: Compute HMAC-SHA256 and compare with sig
    const computedSig = this.base64UrlEncode(
      crypto.createHmac("sha256", hmacSecret).update(canonicalJson).digest()
    );
    if (!this.constantTimeCompare(computedSig, sig)) {
      const err = new Error("Invalid signature for payment link.");
      (err as any).status = 403;
      throw err;
    }

    // Step 6: Verify storeId and invoiceId match route params
    if (pStoreId !== context.storeId || pInvoiceId !== context.invoiceId) {
      const err = new Error("Payment link does not match store or invoice.");
      (err as any).status = 400;
      throw err;
    }

    // Step 7: TTL/expiry checks
    const now = Math.floor(Date.now() / 1000);
    if (exp <= now) {
      const err = new Error("Payment link has expired.");
      (err as any).status = 410;
      throw err;
    }
    const ttl = exp - now;
    if (ttl < 120 || ttl > 1800) {
      const err = new Error("Payment link TTL out of range.");
      (err as any).status = 400;
      throw err;
    }

    // Step 8: unsignedCall checks
    if (
      !unsignedCall ||
      unsignedCall.function !== "pay-invoice" ||
      unsignedCall.postConditionMode !== "deny" ||
      !Array.isArray(unsignedCall.postConditions)
    ) {
      const err = new Error("Invalid call details for payment.");
      (err as any).status = 400;
      throw err;
    }

    // Find FT post-condition for sBTC with condition: eq and positive amount and payer
    const sBTCCondition = unsignedCall.postConditions.find(
      (pc: any) =>
        typeof pc === "object" &&
        pc.type === "ft-postcondition" &&
        typeof pc.address === "string" &&
        typeof pc.asset === "string" &&
        pc.asset.toLowerCase().includes("sbtc") &&
        pc.condition === "eq" &&
        typeof pc.amount === "string" &&
        /^[0-9]+$/.test(pc.amount) &&
        Number(pc.amount) > 0 &&
        pc.address
    );
    if (!sBTCCondition) {
      const err = new Error("Payment link missing required sBTC post-condition.");
      (err as any).status = 400;
      throw err;
    }

    // Step 9: Fetch invoice and verify state
    let invoice: InvoiceDTO;
    try {
      invoice = await this.bridgeClient.fetchInvoice(context.invoiceId);
    } catch {
      const err = new Error("Invoice not found or could not be fetched.");
      (err as any).status = 404;
      throw err;
    }

    // - status must be unpaid
    // - amountSats must match FT PC amount (parseInt comparison)
    // - quoteExpiresAt must match expiry (allowing for slight skew is not required unless specified)
    if (
      invoice.status !== "unpaid" ||
      Number(invoice.amountSats) !== Number(sBTCCondition.amount)
    ) {
      const err = new Error("Invoice is not unpaid or payment amount does not match.");
      (err as any).status = 400;
      throw err;
    }
    if (
      invoice.quoteExpiresAt &&
      new Date(invoice.quoteExpiresAt).getTime() <= Date.now()
    ) {
      const err = new Error("Invoice has expired.");
      (err as any).status = 410;
      throw err;
    }

    // Step 10: Network check
    if (unsignedCall.network !== this.deploymentNetwork) {
      const err = new Error("Payment link network does not match deployment.");
      (err as any).status = 400;
      throw err;
    }

    // All checks passed
    return { payload, invoice };
  }

  private base64UrlDecode(encoded: string): string {
    const padded = encoded.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((encoded.length + 3) % 4);
    return Buffer.from(padded, "base64").toString("utf8");
  }

  private base64UrlEncode(buf: Buffer): string {
    return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  private stableStringify(obj: any): string {
    if (Array.isArray(obj)) {
      return "[" + obj.map((x) => this.stableStringify(x)).join(",") + "]";
    } else if (obj && typeof obj === "object") {
      const keys = Object.keys(obj).sort();
      return (
        "{" +
        keys.map((k) => JSON.stringify(k) + ":" + this.stableStringify(obj[k])).join(",") +
        "}"
      );
    } else {
      return JSON.stringify(obj);
    }
  }

  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }
}
