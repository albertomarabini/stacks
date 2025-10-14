/**
 * /src/server/controllers/admin/BrandingCssVariableInjector.ts
 *
 * Internal delegate for AdminRouteHandlers.
 * Generates a <style> tag with the CSS --brand variable for SSR layout, validating brandColor or falling back.
 */

export class BrandingCssVariableInjector {
  private static BRAND_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

  /**
   * Generates a <style> tag string for the CSS --brand variable.
   * @param brandColor Optional brand color (hex).
   * @param fallback Fallback color if brandColor invalid.
   * @returns <style> tag string.
   */
  public generateBrandCssVariableStyle(brandColor: string | undefined, fallback: string): string {
    const safeBrand = '#' + (typeof brandColor === 'string'? brandColor : fallback);
    return `<style>:root { --brand: ${safeBrand}; }</style>`;
  }
}
