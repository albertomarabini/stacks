import type { IBridgeClient, IBrandingService } from '../../shared/contracts/interfaces';
import type { Branding } from '../../shared/models/dto';

export class BrandingService implements IBrandingService {
  private bridgeClient: IBridgeClient;

  constructor(bridgeClient: IBridgeClient) {
    this.bridgeClient = bridgeClient;
  }

  /**
   * Fetches, sanitizes, and returns the branding/profile object for a given storeId.
   * Always returns a valid Branding object for SSR injection.
   * - For public surfaces, fetch via getPublicProfile().
   * - For merchant/admin, fetch via getProfile().
   * If fetch fails or any required field is missing/invalid, returns fallback branding.
   * @param storeId string
   * @returns Promise<Branding>
   */
  async fetchBranding(storeId: string): Promise<Branding> {
    try {
      // By business contract, merchant/admin flows should call getProfile, public flows getPublicProfile.
      // The logic for which to call must be determined by the caller, but here we always try getProfile, then fallback to getPublicProfile.
      let profile: any = null;
      try {
        profile = await this.bridgeClient.getProfile(storeId);
      } catch {
        profile = await this.bridgeClient.getPublicProfile(storeId);
      }
      const displayName = typeof profile.displayName === 'string' ? profile.displayName : '';
      const logoUrl = typeof profile.logoUrl === 'string' ? profile.logoUrl : null;
      const supportEmail = typeof profile.supportEmail === 'string' ? profile.supportEmail : null;
      const supportUrl = typeof profile.supportUrl === 'string' ? profile.supportUrl : null;
      const brandColor = this.sanitizeBrandColor(profile.brandColor);
      const principal = typeof profile.principal === 'string' ? profile.principal : null;

      if (!displayName) {
        // Required field missing or invalid
        // Always log on fallback for diagnostics (required by contract)
        // eslint-disable-next-line no-console
        console.warn('[BrandingService] Missing displayName for storeId:', storeId, 'Injecting fallback branding.');
        return this.injectFallbackBranding();
      }

      return {
        displayName,
        brandColor,
        logoUrl,
        supportEmail,
        supportUrl,
        principal
      };
    } catch (err) {
      // Any error in fetch/profile means fallback
      // eslint-disable-next-line no-console
      console.warn('[BrandingService] Failed to fetch branding for storeId:', storeId, err);
      return this.injectFallbackBranding();
    }
  }

  /**
   * Validates and sanitizes a brandColor string before SSR injection.
   * Returns only valid hex colors; fallback is #111827.
   * @param brandColor string|null|undefined
   * @returns string
   */
  sanitizeBrandColor(brandColor: string | null | undefined): string {
    return (typeof brandColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(brandColor))
      ? brandColor
      : '#111827';
  }

  /**
   * Returns a safe fallback branding object for SSR injection.
   * Logs a warning for diagnostics.
   * @returns Branding
   */
  injectFallbackBranding(): Branding {
    // eslint-disable-next-line no-console
    const branding = {
      displayName: process.env.ADMIN_DISPLAY_NAME ?? "WEBPAY",
      brandColor: process.env.ADMIN_COLOR ?? "111827",
      logoUrl: process.env.ADMIN_LOGO_URL ?? null,
      supportEmail: process.env.ADMIN_SUPPORT_EMAIL ?? null,
      supportUrl: process.env.ADMIN_SUPPORT_URL ?? null,
    };
    return branding;
  }
}
