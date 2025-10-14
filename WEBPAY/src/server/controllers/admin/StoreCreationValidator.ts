/**
 * /src/server/controllers/admin/StoreCreationValidator.ts
 *
 * Internal delegate for AdminRouteHandlers.
 * Validates and sanitizes all input fields for new store creation,
 * enforces uniqueness and brandColor rules.
 */

export class StoreCreationValidator {
  private static BRAND_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

  /**
   * Validates and sanitizes store creation input.
   * @param input Input fields from the request body.
   * @param existingPrincipals Array of already in-use principals for uniqueness check.
   * @returns Sanitized DTO for store creation.
   * @throws Error with validation message if input is invalid.
   */
  public validateAndBuildStoreDTO(
    input: {
      displayName: any;
      principal: any;
      brandColor: any;
      logoUrl?: any;
      supportEmail?: any;
      supportUrl?: any;
    },
    existingPrincipals: string[]
  ): {
    displayName: string;
    principal: string;
    brandColor: string;
    logoUrl?: string | null;
    supportEmail?: string | null;
    supportUrl?: string | null;
  } {
    if (!input.displayName || typeof input.displayName !== 'string') {
      throw new Error('Display name is required and must be a string.');
    }
    if (!input.principal || typeof input.principal !== 'string') {
      throw new Error('Principal is required and must be a string.');
    }
    if (existingPrincipals.includes(input.principal)) {
      throw new Error('Principal must be unique.');
    }
    if (
      !input.brandColor ||
      typeof input.brandColor !== 'string' ||
      !StoreCreationValidator.BRAND_COLOR_REGEX.test(input.brandColor)
    ) {
      throw new Error('Brand color must be a valid hex color (e.g., #AABBCC).');
    }
    const safeLogoUrl =
      input.logoUrl && typeof input.logoUrl === 'string' ? input.logoUrl : null;
    const safeSupportEmail =
      input.supportEmail && typeof input.supportEmail === 'string'
        ? input.supportEmail
        : null;
    const safeSupportUrl =
      input.supportUrl && typeof input.supportUrl === 'string'
        ? input.supportUrl
        : null;

    return {
      displayName: input.displayName.trim(),
      principal: input.principal.trim(),
      brandColor: input.brandColor,
      logoUrl: safeLogoUrl,
      supportEmail: safeSupportEmail,
      supportUrl: safeSupportUrl,
    };
  }
}
