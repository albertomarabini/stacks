import { PublicProfile } from '../models/core';

class EmailBrandingFallbackHandler {
  static applyBrandingFallbacks(branding: {
    logo?: string | null;
    brandColor?: string | null;
    displayName?: string | null;
    supportEmail?: string | null;
    supportUrl?: string | null;
  }): {
    logo: string;
    brandColor: string;
    displayName: string;
    supportEmail: string;
    supportUrl: string;
  } {
    return {
      logo: branding.logo || 'https://webpay.app/default-logo.png',
      brandColor: branding.brandColor || '#222222',
      displayName: branding.displayName || 'Merchant',
      supportEmail: branding.supportEmail || 'support@webpay.app',
      supportUrl: branding.supportUrl || 'https://webpay.app/support'
    };
  }
}

export { EmailBrandingFallbackHandler };
