// src/client/islands/BrandingSettingsIsland.ts
function handleBrandColorInputChange(event) {
  const input = event.target;
  const value = input.value.trim();
  const previewNode = document.getElementById("brand-preview");
  if (!previewNode) return;
  if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
    previewNode.style.setProperty("--brand", value);
  } else {
    previewNode.style.setProperty("--brand", "#111827");
  }
}
export {
  handleBrandColorInputChange
};
//# sourceMappingURL=BrandingSettingsIsland.js.map
