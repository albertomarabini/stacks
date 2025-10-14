// src/client/islands/helpers/MagicLinkBlobParser.ts
var MagicLinkBlobParser = class {
  /**
   * Parses and validates the magic-link blob from base64url string.
   * @param u base64url-encoded blob
   * @returns { unsignedCall: any, expiry: number }
   * @throws Error if malformed, expired, or invalid structure
   */
  static parseAndValidate(u) {
    let base64 = u.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4) base64 += "=";
    let decoded;
    try {
      decoded = atob(base64);
    } catch {
      throw new Error("Malformed magic-link (base64 decode failed)");
    }
    let payload;
    try {
      payload = JSON.parse(decoded);
    } catch {
      throw new Error("Malformed magic-link (JSON parse failed)");
    }
    if (typeof payload !== "object" || typeof payload.unsignedCall !== "object" || typeof payload.expiry !== "number") {
      throw new Error("Malformed magic-link blob");
    }
    if (Date.now() > payload.expiry) {
      throw new Error("This payment link has expired.");
    }
    const unsignedCall = payload.unsignedCall;
    if (unsignedCall.function !== "pay-invoice" || unsignedCall.postConditionMode !== "deny" || !Array.isArray(unsignedCall.postConditions)) {
      throw new Error("Malformed or unauthorized payment request.");
    }
    const hasSBTC = unsignedCall.postConditions.some(
      (pc) => pc.conditionCode === "Equal" && typeof pc.amount === "string" && pc.assetInfo && typeof pc.assetInfo === "object" && typeof pc.assetInfo.assetName === "string" && /sb?tc/i.test(pc.assetInfo.assetName)
    );
    if (!hasSBTC) {
      throw new Error("Payment request missing valid sBTC postcondition.");
    }
    return {
      unsignedCall,
      expiry: payload.expiry
    };
  }
};
export {
  MagicLinkBlobParser
};
//# sourceMappingURL=MagicLinkBlobParser.js.map
