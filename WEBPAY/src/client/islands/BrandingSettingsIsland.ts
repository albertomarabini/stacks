/**
 * BrandingSettingsIsland.ts
 * Client-side JS island for live branding color preview in settings/profile view.
 * Stateless, browser-local. All logic is within handleBrandColorInputChange.
 */

/**
 * handleBrandColorInputChange
 * Handler for brand color input field's onchange and onblur events.
 * Validates input as hex color (#RRGGBB) and sets --brand CSS variable in preview node.
 * @param event Event object from input change/blur
 */
export function handleBrandColorInputChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const value = input.value.trim();
  const previewNode = document.getElementById('brand-preview');
  if (!previewNode) return;
  if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
    previewNode.style.setProperty('--brand', value);
  } else {
    previewNode.style.setProperty('--brand', '#111827');
  }
}
