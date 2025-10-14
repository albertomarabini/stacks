/**
 * /src/server/controllers/merchant/InputValidationDelegate.ts
 *
 * Internal delegate for MerchantRouteHandlers.
 * Centralizes all POST/PATCH payload validation for invoices, branding, and subscriptions.
 * Stateless, throws on validation errors.
 */

export class InputValidationDelegate {
  /**
   * Validates invoice input for creation or update.
   * Ensures amount > 0 (number), ttl in [120, 1800] (integer), memo is string (may be empty).
   * @param input Object containing amount, ttl, and optional memo.
   * @returns { amount: number, ttl: number, memo: string }
   * @throws Error on validation failure.
   */
  validateInvoiceInput(input: { amount: any; ttl: any; memo?: any }): { amount: number; ttl: number; memo: string } {
    const { amount, ttl, memo } = input;
    if (typeof amount !== 'number' || amount <= 0 || !isFinite(amount)) {
      throw new Error('Amount must be a positive number');
    }
    const ttlNum = Number(ttl);
    if (!Number.isInteger(ttlNum) || ttlNum < 120 || ttlNum > 1800) {
      throw new Error('TTL must be an integer between 120 and 1800');
    }
    return {
      amount,
      ttl: ttlNum,
      memo: typeof memo === 'string' ? memo : (memo === undefined ? '' : String(memo)),
    };
  }

  /**
   * Validates subscription input DTO.
   * Ensures required fields are present and valid.
   * Example: amount > 0, interval string, principal string.
   * @param dto Subscription payload object.
   * @returns Normalized DTO object.
   * @throws Error on validation failure.
   */
  validateSubscriptionInput(dto: any): any {
    if (!dto) throw new Error('Subscription payload required');
    if (typeof dto.amount !== 'number' || dto.amount <= 0) {
      throw new Error('Subscription amount must be a positive number');
    }
    if (!dto.interval || typeof dto.interval !== 'string') {
      throw new Error('Subscription interval required');
    }
    if (!dto.principal || typeof dto.principal !== 'string') {
      throw new Error('Subscription principal required');
    }
    // Additional field checks can be added here as per schema.
    return dto;
  }

  /**
   * Validates and sanitizes branding/profile input payload.
   * Converts all fields to strings as appropriate, sanitizes brandColor.
   * @param input Branding/profile update payload.
   * @returns Normalized object for storage/update.
   */
  validateBrandingProfileInput(input: {
    displayName?: any;
    brandColor?: any;
    logoUrl?: any;
    supportEmail?: any;
    supportUrl?: any;
  }): {
    displayName?: string;
    brandColor?: string;
    logoUrl?: string;
    supportEmail?: string;
    supportUrl?: string;
  } {
    const sanitized: any = {};
    if ('displayName' in input) sanitized.displayName = String(input.displayName ?? '').trim();
    if ('brandColor' in input) sanitized.brandColor = this.sanitizeBrandColor(input.brandColor);
    if ('logoUrl' in input) sanitized.logoUrl = String(input.logoUrl ?? '').trim();
    if ('supportEmail' in input) sanitized.supportEmail = String(input.supportEmail ?? '').trim();
    if ('supportUrl' in input) sanitized.supportUrl = String(input.supportUrl ?? '').trim();
    return sanitized;
  }

  /**
   * Sanitizes a brandColor string. Returns if valid, or fallback if invalid.
   * @param color Input brand color string.
   * @returns Validated hex color string.
   */
  sanitizeBrandColor(color: any): string {
    if (typeof color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(color)) {
      return color;
    }
    // Fallback to default brand color.
    return '#4F46E5';
  }
}
