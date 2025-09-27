import { Store } from '../models/core';

class StoreProfileFormDelegate {
  renderFormFields(form: HTMLFormElement, data: Store): void {
    (form.querySelector('[name="displayName"]') as HTMLInputElement).value = data.displayName || '';
    (form.querySelector('[name="logoUrl"]') as HTMLInputElement).value = data.logoUrl || '';
    (form.querySelector('[name="brandColor"]') as HTMLInputElement).value = data.brandColor || '';
    (form.querySelector('[name="allowedOrigins"]') as HTMLInputElement).value =
      Array.isArray(data.allowedOrigins) ? data.allowedOrigins.join(',') : '';
    (form.querySelector('[name="webhookUrl"]') as HTMLInputElement).value = data.webhookUrl || '';
  }

  extractAndValidateFormInput(
    form: HTMLFormElement
  ): { payload: Record<string, any> } | { error: string } {
    const displayName = (form.querySelector('[name="displayName"]') as HTMLInputElement).value;
    const logoUrl = (form.querySelector('[name="logoUrl"]') as HTMLInputElement).value;
    const brandColor = (form.querySelector('[name="brandColor"]') as HTMLInputElement).value;
    const allowedOrigins = (form.querySelector('[name="allowedOrigins"]') as HTMLInputElement).value;
    const webhookUrl = (form.querySelector('[name="webhookUrl"]') as HTMLInputElement).value;

    if (logoUrl && !/^https?:\/\//.test(logoUrl)) {
      return { error: 'logoUrl must be a valid URL.' };
    }
    if (brandColor && !/^#[a-fA-F0-9]{6}$/.test(brandColor)) {
      return { error: 'brandColor must be a hex color.' };
    }

    const allowedOriginsArr = allowedOrigins
      ? allowedOrigins.split(',').map(s => s.trim()).filter(Boolean)
      : undefined;

    const payload: Record<string, any> = {};
    if (displayName) payload.displayName = displayName;
    if (logoUrl) payload.logoUrl = logoUrl;
    if (brandColor) payload.brandColor = brandColor;
    if (allowedOriginsArr && allowedOriginsArr.length > 0) payload.allowedOrigins = allowedOriginsArr;
    if (webhookUrl) payload.webhookUrl = webhookUrl;

    return { payload };
  }
}

export { StoreProfileFormDelegate };
