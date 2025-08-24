// /frontend/checkout/delegates/PublicCheckoutApiClient.ts
import { PublicInvoiceDTO, StorePublicProfileDTO } from '/src/contracts/domain';

export class PublicCheckoutApiClient {
  async fetchInvoiceJson(
    invoiceId: string,
    opts?: { signal?: AbortSignal }
  ): Promise<PublicInvoiceDTO> {
    const res = await fetch(`/i/${encodeURIComponent(invoiceId)}`, {
      headers: { Accept: 'application/json' },
      signal: opts?.signal,
    });
    if (!res.ok) {
      const err: any = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return (await res.json()) as PublicInvoiceDTO;
  }

  async fetchStorePublicProfile(
    storeId: string,
    opts?: { signal?: AbortSignal }
  ): Promise<StorePublicProfileDTO> {
    const res = await fetch(
      `/api/v1/stores/${encodeURIComponent(storeId)}/public-profile`,
      {
        headers: { Accept: 'application/json' },
        signal: opts?.signal,
      }
    );
    if (!res.ok) return {} as StorePublicProfileDTO;
    return (await res.json()) as StorePublicProfileDTO;
  }
}
