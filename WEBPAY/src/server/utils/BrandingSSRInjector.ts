import { BrandingService } from '../services/BrandingService';
import { BrandColorSanitizer } from './BrandColorSanitizer';

/**
 * BrandingSSRInjector
 *
 * Delegate utility for fetching, sanitizing, and injecting branding into Express SSR context (res.locals).
 * Consumed by ExpressApp and PublicRouteHandlers.
 */
export class BrandingSSRInjector {
  /**
   * Fetches, sanitizes, and injects branding into Express SSR context.
   * Always sets res.locals.branding to a valid object, using fallback if needed.
   * @param res Express.Response
   * @param storeId Optional storeId to fetch branding for
   */
  static async injectBranding(res: any, storeId?: string): Promise<void> {
    let branding;
    try {
      if (storeId) {
        branding = await res.app.locals.brandingService.fetchBranding(storeId);
      } else {
        branding = res.app.locals.brandingService.injectFallbackBranding();
      }
    } catch {
      branding = res.app.locals.brandingService.injectFallbackBranding();
    }
    branding.brandColor = BrandColorSanitizer.sanitize(branding.brandColor);
    res.locals.branding = branding;
  }
}
