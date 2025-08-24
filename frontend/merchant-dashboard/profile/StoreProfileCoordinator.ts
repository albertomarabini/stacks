// /frontend/merchant-dashboard/profile/StoreProfileCoordinator.ts
import { StorePrivateProfileDTO } from '/src/contracts/domain';
import type { MerchantApiHttpClient } from '/frontend/merchant-dashboard/http/MerchantApiHttpClient';

export class StoreProfileCoordinator {
  private profile?: StorePrivateProfileDTO;

  public setProfileLocal(profile?: StorePrivateProfileDTO): void {
    this.profile = profile;
  }

  public async save(
    formEl: HTMLFormElement,
    storeId: string,
    http: MerchantApiHttpClient,
    onAuthError: (e: unknown) => never,
    toSnake: (v: any) => any,
  ): Promise<StorePrivateProfileDTO> {
    const fd = new FormData(formEl);
    const name = fd.get('name') ? String(fd.get('name')) : undefined;
    const displayName = fd.get('displayName') ? String(fd.get('displayName')) : undefined;
    const logoUrl = fd.get('logoUrl') ? String(fd.get('logoUrl')) : undefined;
    const brandColor = fd.get('brandColor') ? String(fd.get('brandColor')) : undefined;
    const webhookUrl = fd.get('webhookUrl') ? String(fd.get('webhookUrl')) : undefined;
    const supportEmail = fd.get('supportEmail') ? String(fd.get('supportEmail')) : undefined;
    const supportUrl = fd.get('supportUrl') ? String(fd.get('supportUrl')) : undefined;
    const allowedOriginsRaw = fd.get('allowedOrigins') ? String(fd.get('allowedOrigins')) : '';
    const allowedOrigins = allowedOriginsRaw.split('\n').map((s) => s.trim()).filter(Boolean);

    const body = toSnake({
      name,
      displayName,
      logoUrl,
      brandColor,
      webhookUrl,
      supportEmail,
      supportUrl,
      allowedOrigins: allowedOrigins.join(','),
    });

    const prof = await http.requestJson<StorePrivateProfileDTO>(
      `/api/v1/stores/${encodeURIComponent(storeId)}/profile`,
      { method: 'PATCH', headers: http.buildHeaders(true), body: JSON.stringify(body) },
      onAuthError,
    );
    this.profile = prof;
    return prof;
  }
}
