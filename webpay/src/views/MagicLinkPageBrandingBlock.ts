class MagicLinkPageBrandingBlock {
  /**
   * Renders the branding block for the magic-link payment page.
   * @param branding - Branding info: displayName (required), logoUrl, brandColor, supportEmail, supportUrl.
   * @returns {string} - HTML string for branding block.
   */
  static render(branding: {
    displayName: string,
    logoUrl?: string,
    brandColor: string,
    supportEmail?: string,
    supportUrl?: string
  }): string {
    const { displayName, logoUrl, brandColor, supportEmail, supportUrl } = branding;
    return `
    ${logoUrl
      ? `<img id="branding-logoImg" src="${logoUrl}" alt="${displayName} Logo" class="h-12 mb-3">`
      : `<div id="branding-logoImg" class="h-12 mb-3 hidden"></div>`
    }
    <h1 id="branding-displayName" class="text-2xl font-bold mb-1">${displayName}</h1>
    <div id="branding-brandBar" class="w-20 h-1.5 rounded-full mb-4" style="background-color:${brandColor};"></div>
    ${(supportEmail || supportUrl) ? `
      <div class="mt-4 text-xs text-gray-500">
        Need help?
        ${supportEmail ? `<span id="branding-supportEmail" class="ml-1">${supportEmail}</span>` : ''}
        ${supportUrl ? `<a id="branding-supportUrl" class="ml-2 underline" href="${supportUrl}" target="_blank">${supportUrl}</a>` : ''}
      </div>
    ` : ''}
  `;
  }
}

export { MagicLinkPageBrandingBlock };
