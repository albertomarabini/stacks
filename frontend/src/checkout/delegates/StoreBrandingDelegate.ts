import type { StorePublicProfileDTO } from '/src/contracts/domain';

export class StoreBrandingDelegate {
  applyBranding(profile: StorePublicProfileDTO): void {
    if (profile.brandColor) {
      document.documentElement.style.setProperty('--accent', profile.brandColor);
    }
    this.updateHeader(profile.displayName, profile.logoUrl);
  }

  updateHeader(displayName?: string, logoUrl?: string): void {
    const nameEl = document.querySelector('#storeName') as HTMLElement | null;
    const logoEl = document.querySelector('#storeLogo') as HTMLImageElement | null;

    if (nameEl) nameEl.textContent = displayName ?? '';

    if (logoUrl && logoEl) {
      logoEl.src = logoUrl;
      logoEl.alt = displayName ? `${displayName} logo` : 'Store logo';
      logoEl.removeAttribute('hidden');
    } else if (logoEl) {
      logoEl.removeAttribute('src');
      logoEl.alt = 'Store logo';
      logoEl.setAttribute('hidden', 'true');
    }
  }
}
