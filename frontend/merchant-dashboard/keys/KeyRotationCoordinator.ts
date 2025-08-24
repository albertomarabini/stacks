// /frontend/merchant-dashboard/keys/KeyRotationCoordinator.ts
import type { MerchantApiHttpClient } from '/frontend/merchant-dashboard/http/MerchantApiHttpClient';

export class KeyRotationCoordinator {
  private oneTimeSecrets: { apiKey: string; hmacSecret: string } | null = null;

  public async rotate(
    storeId: string,
    http: MerchantApiHttpClient,
    onAuthError: (e: unknown) => never,
  ): Promise<{ apiKey: string; hmacSecret: string }> {
    const secrets = await http.requestJson<{ apiKey: string; hmacSecret: string }>(
      `/api/v1/stores/${encodeURIComponent(storeId)}/rotate-keys`,
      { method: 'POST', headers: http.buildHeaders(false) },
      onAuthError,
    );
    return secrets;
  }

  public show(secrets: { apiKey: string; hmacSecret: string }): { apiKey: string; hmacSecret: string } {
    this.oneTimeSecrets = secrets;
    return secrets;
  }

  public clear(): null {
    this.oneTimeSecrets = null;
    return this.oneTimeSecrets;
  }

  public get(): { apiKey: string; hmacSecret: string } | null {
    return this.oneTimeSecrets;
  }
}
