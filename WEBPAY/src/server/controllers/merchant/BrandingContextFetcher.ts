/**
 * /src/server/controllers/merchant/BrandingContextFetcher.ts
 *
 * Internal delegate for MerchantRouteHandlers.
 * Handles fetching and normalizing branding/public-profile after save,
 * provides fallback on error. Consumed only by MerchantRouteHandlers.
 */

export class BrandingContextFetcher {
  async fetchPublicBrandingOrFallback(storeId: string, brandingService: any): Promise<any> {
    try {
      return await brandingService.fetchBranding(storeId);
    } catch {
      return brandingService.injectFallbackBranding();
    }
  }
}
