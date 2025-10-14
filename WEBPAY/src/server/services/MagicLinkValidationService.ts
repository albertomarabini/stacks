import crypto from "crypto";
import { IBridgeClient } from "../../shared/contracts/interfaces";
import { MagicLinkPayload, InvoiceDTO } from "../../shared/models/dto";

/**
 * MagicLinkValidationService
 *
 * Internal delegate for PublicRouteHandlers.
 * Encapsulates all magic-link parsing, HMAC validation, expiry, TTL, and business logic for `/w/:storeId/:invoiceId?u=...` flows.
 * Used only by PublicRouteHandlers.
 */
export class MagicLinkValidationService {
  private bridgeClient: IBridgeClient;
  private deploymentNetwork: string;

  /**
   * @param bridgeClient IBridgeClient - required dependency for Bridge API calls
   * @param deploymentNetwork string - deployment network ("mainnet" or "testnet")
   */
  constructor(bridgeClient: IBridgeClient, deploymentNetwork: string) {
    this.bridgeClient = bridgeClient;
    this.deploymentNetwork = deploymentNetwork;
  }

  /**
   * Accepts base64url-encoded 'u' blob and context, performs full parsing and validation.
   * @param u_blob base64url-encoded magic-link payload
   * @param context { storeId, invoiceId }
   * @returns { payload, invoice }
   * @throws Error with .status set for HTTP error signaling
   */
  async validateAndParse(
    u_blob: string,
    context: { storeId: string; invoiceId: string }
  ): Promise<{ payload: MagicLinkPayload; invoice: InvoiceDTO }> {
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

    // 1) Build canonical JSON first (must come before HMAC)
    const canonicalFields = { v, storeId: pStoreId, invoiceId: pInvoiceId, unsignedCall, exp };
    const canonicalJson = JSON.stringify(canonicalFields);

    // 2) Fetch the HMAC secret via admin backchannel (no shadowing)
    let hmacSecret: string | undefined;
    try {
      const resp = await (this.bridgeClient as any).getStoreSecret(context.storeId);
      if (resp && typeof resp.hmacSecret === "string" && resp.hmacSecret) {
        hmacSecret = resp.hmacSecret;
      }
    } catch {
      const err = new Error("Could not retrieve HMAC secret for store.");
      (err as any).status = 500;
      throw err;
    }

    // 3) Definite assignment guard, then compute signature
    if (!hmacSecret) {
      const err = new Error("Could not retrieve HMAC secret for store.");
      (err as any).status = 500;
      throw err;
    }

    const computedSig = this.base64UrlEncode(
      crypto.createHmac("sha256", hmacSecret).update(canonicalJson).digest()
    );

    if (!this.constantTimeCompare(computedSig, sig)) {
      const err = new Error("Invalid signature for payment link.");
      (err as any).status = 403;
      throw err;
    }

    if (pStoreId !== context.storeId || pInvoiceId !== context.invoiceId) {
      const err = new Error("Payment link does not match store or invoice.");
      (err as any).status = 400;
      throw err;
    }

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

    // Find an sBTC FT post-condition that proves the payable amount.
    // Accept either 'eq' or 'gte' (builder may add an extra 'lte 0' guard).
    const pcs = Array.isArray(unsignedCall.postConditions) ? unsignedCall.postConditions : [];

    const sBTCCondition = pcs.find((pc: any) =>
      pc && typeof pc === "object" &&
      pc.type === "ft-postcondition" &&
      typeof pc.asset === "string" &&
      pc.asset.toLowerCase().includes("sbtc") &&
      (pc.condition === "eq" || pc.condition === "gte") && // ← widened
      typeof pc.amount === "string" &&
      /^[0-9]+$/.test(pc.amount) &&
      Number(pc.amount) > 0 &&
      typeof pc.address === "string" &&
      pc.address.length > 0
    );

    if (!sBTCCondition) {
      const err = new Error("Payment link missing required sBTC post-condition.");
      (err as any).status = 400;
      throw err;
    }

    let invoice: InvoiceDTO;
    try {
      invoice = await this.bridgeClient.fetchStoreInvoice(context.storeId, context.invoiceId);
    } catch {
      const err = new Error("Invoice not found or could not be fetched.");
      (err as any).status = 404;
      throw err;
    }

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

    if (unsignedCall.network !== this.deploymentNetwork) {
      const err = new Error("Payment link network does not match deployment.");
      (err as any).status = 400;
      throw err;
    }

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
