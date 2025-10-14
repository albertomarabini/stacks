/**
 * /src/server/utils/BrandColorSanitizer.ts
 *
 * Delegate utility for validating and sanitizing brandColor values.
 * Stateless, provides regex enforcement and fallback.
 * Used by PublicRouteHandlers and BrandingSSRInjector.
 */
export class BrandColorSanitizer {
  /**
   * Accepts a raw brandColor string (possibly undefined or malformed).
   * Checks if it matches the regex /^#[0-9A-Fa-f]{6}$/.
   * If valid, returns the color as-is.
   * If not, returns a neutral fallback value (#666666) for safe theming.
   *
   * @param brandColor string or undefined
   * @returns sanitized hex color string
   */
  static sanitize(brandColor: string | undefined): string {
    if (typeof brandColor === "string" && /^#[0-9A-Fa-f]{6}$/.test(brandColor)) {
      return brandColor;
    }
    return "#666666";
  }
}
