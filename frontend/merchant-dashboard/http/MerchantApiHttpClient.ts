// /frontend/merchant-dashboard/http/MerchantApiHttpClient.ts

export class MerchantApiHttpClient {
  private storeId = '';
  private apiKey = '';

  public setContext(ctx: { storeId: string; apiKey: string }): void {
    this.storeId = ctx.storeId;
    this.apiKey = ctx.apiKey;
  }

  public buildHeaders(hasJson: boolean, overrideApiKey?: string): HeadersInit {
    return {
      ...(hasJson ? { 'Content-Type': 'application/json' } : {}),
      'X-API-Key': overrideApiKey ?? this.apiKey,
    };
  }

  public async requestJson<T>(
    url: string,
    init: RequestInit & { expectJson?: boolean } = {},
    onAuthError: (e: unknown) => never,
  ): Promise<T> {
    const res = await fetch(url, init);
    if (res.status === 401 || res.status === 403) {
      onAuthError(res);
    }
    if ((init as any).expectJson === false) {
      return undefined as unknown as T;
    }
    const data = (await res.json()) as T;
    return data;
  }
}
