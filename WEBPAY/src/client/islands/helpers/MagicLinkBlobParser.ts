export class MagicLinkBlobParser {
  /**
   * Parses and validates the magic-link blob from base64url string.
   * @param u base64url-encoded blob
   * @returns { unsignedCall: any, expiry: number }
   * @throws Error if malformed, expired, or invalid structure
   */
  static parseAndValidate(u: string): { unsignedCall: any; expiry: number } {
    // Step 1: Decode base64url (replace -/_ and pad)
    let base64 = u.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    let decoded: string;
    try {
      decoded = atob(base64);
    } catch {
      throw new Error('Malformed magic-link (base64 decode failed)');
    }

    // Step 2: Parse JSON
    let payload: any;
    try {
      payload = JSON.parse(decoded);
    } catch {
      throw new Error('Malformed magic-link (JSON parse failed)');
    }

    // Step 3: Check structure
    if (
      typeof payload !== 'object' ||
      typeof payload.unsignedCall !== 'object' ||
      typeof payload.expiry !== 'number'
    ) {
      throw new Error('Malformed magic-link blob');
    }

    // Step 4: Expiry
    if (Date.now() > payload.expiry) {
      throw new Error('This payment link has expired.');
    }

    // Step 5: Validate unsignedCall
    const unsignedCall = payload.unsignedCall;
    if (
      unsignedCall.function !== 'pay-invoice' ||
      unsignedCall.postConditionMode !== 'deny' ||
      !Array.isArray(unsignedCall.postConditions)
    ) {
      throw new Error('Malformed or unauthorized payment request.');
    }

    // Step 6: At least one FT postcondition for sBTC
    const hasSBTC = unsignedCall.postConditions.some(
      (pc: any) =>
        pc.conditionCode === 'Equal' &&
        typeof pc.amount === 'string' &&
        pc.assetInfo &&
        typeof pc.assetInfo === 'object' &&
        typeof pc.assetInfo.assetName === 'string' &&
        /sb?tc/i.test(pc.assetInfo.assetName)
    );
    if (!hasSBTC) {
      throw new Error('Payment request missing valid sBTC postcondition.');
    }

    // All checks passed
    return {
      unsignedCall,
      expiry: payload.expiry
    };
  }
}
