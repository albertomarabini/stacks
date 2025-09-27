import { IBridgeApiClient } from '../contracts/interfaces';
import { PublicProfile } from '../models/core';

class BrandingProfileManager {
  private bridgeApiClient: IBridgeApiClient;

  constructor(deps: { bridgeApiClient: IBridgeApiClient }) {
    this.bridgeApiClient = deps.bridgeApiClient;
  }

  /**
   * Fetches branding/public profile data for a given store from the Bridge API.
   * Always live fetch, no local/session cache.
   * @param storeId
   * @returns Promise<PublicProfile>
   */
  async fetchBranding(storeId: string): Promise<PublicProfile> {
    return await this.bridgeApiClient.getPublicProfile(storeId);
  }

  /**
   * Handles branding/profile input DOM change events.
   * Each event (e.g. input or change) fetches updated branding from Bridge and applies to the preview UI.
   * @param event
   */
  async handleInputChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    // Find the enclosing form, and then the storeId input
    const form = input.form as HTMLFormElement;
    const storeIdInput = form.querySelector('[name="storeId"]') as HTMLInputElement;
    const storeId = storeIdInput.value;
    const branding = await this.bridgeApiClient.getPublicProfile(storeId);
    this.applyBrandingToUI(branding);
  }

  /**
   * Inject branding data into all relevant UI nodes/templates.
   * Called on every render or branding/profile update.
   * @param brandingData
   */
  applyBrandingToUI(brandingData: PublicProfile): void {
    const {
      displayName,
      logoUrl,
      brandColor,
      supportEmail,
      supportUrl
    } = brandingData;

    // Update .branding-displayName
    document.querySelectorAll('.branding-displayName').forEach(el => {
      (el as HTMLElement).textContent = displayName || '';
    });

    // Update .branding-logoImg (as <img>)
    document.querySelectorAll('.branding-logoImg').forEach(el => {
      const img = el as HTMLImageElement;
      if (logoUrl) {
        img.src = logoUrl;
        img.style.display = '';
      } else {
        img.src = '';
        img.style.display = 'none';
      }
    });

    // Update .branding-brandBar (as a colored bar)
    document.querySelectorAll('.branding-brandBar').forEach(el => {
      (el as HTMLElement).style.backgroundColor = brandColor || '#2563eb';
    });

    // Update .branding-supportEmail (text), show/hide
    document.querySelectorAll('.branding-supportEmail').forEach(el => {
      (el as HTMLElement).textContent = supportEmail || '';
      (el as HTMLElement).style.display = supportEmail ? '' : 'none';
    });

    // Update .branding-supportUrl (as <a>), show/hide
    document.querySelectorAll('.branding-supportUrl').forEach(el => {
      const a = el as HTMLAnchorElement;
      if (supportUrl) {
        a.textContent = supportUrl;
        a.href = supportUrl;
        a.style.display = '';
      } else {
        a.textContent = '';
        a.href = '';
        a.style.display = 'none';
      }
    });
  }

  /**
   * Express handler for GET /api/v1/stores/:storeId/public-profile.
   * Fetches branding and returns as JSON.
   */
  async handlePublicProfileRequest(req: any, res: any, next: any): Promise<void> {
    try {
      const storeId = req.params.storeId;
      const branding = await this.bridgeApiClient.getPublicProfile(storeId);
      res.json(branding);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Polls for latest branding/profile and updates UI. Used in setInterval or on-demand contexts.
   * @param storeId
   */
  async fetchAndUpdateBrandingProfile(storeId: string): Promise<void> {
    const branding = await this.bridgeApiClient.getPublicProfile(storeId);
    this.applyBrandingToUI(branding);
  }
}

export { BrandingProfileManager };
