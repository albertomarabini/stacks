/**
 * /src/server/utils/NoCacheHeaderSetter.ts
 *
 * Delegate for setting HTTP no-store, no-cache headers for payment SSR pages.
 * Used by PublicRouteHandlers. Stateless utility.
 */

export class NoCacheHeaderSetter {
  static set(res: any): void {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
  }
}
