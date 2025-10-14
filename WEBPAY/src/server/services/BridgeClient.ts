import axios, { AxiosInstance } from 'axios';
import type { IBridgeClient } from '../../shared/contracts/interfaces';
import type { InvoiceDTO, Branding, SubscriptionDTO } from '../../shared/models/dto';
import http from 'http';
import https from 'https';

type MappedBridgeError = { message: string; code?: string | number };

type BridgeClientOptions = {
  baseUrl: string;
  apiKey?: string;
  adminKey?: string;
  timeoutMs?: number;
  network?: string;
};

export class BridgeClient implements IBridgeClient {
  private axios: AxiosInstance;
  private apiKey?: string;
  private adminKey?: string;
  private network?: string;

  constructor(options: BridgeClientOptions) {
    this.apiKey = options.apiKey;
    this.adminKey = options.adminKey;
    this.network = options.network;
    this.axios = axios.create({
      baseURL: options.baseUrl,
      timeout: options.timeoutMs || 60000,
      headers: { 'Content-Type': 'application/json' },
      httpAgent: new http.Agent({ keepAlive: false }),
      httpsAgent: new https.Agent({ keepAlive: false }),
    });
  }


  async getStoreSecret(storeId: string): Promise<{ hmacSecret: string }> {
    try {
      const res = await this.axios.get(
        `/api/admin/stores/${encodeURIComponent(storeId)}/secret`,
        this.adminHeaders()
      );
      const hmacSecret = res.data?.hmacSecret ?? res.data?.hmac_secret ?? null;
      if (typeof hmacSecret !== 'string' || !hmacSecret) {
        throw { message: 'Malformed admin secret response', code: 502 };
      }
      return { hmacSecret };
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }


  async prepareInvoice(storeId: string, data: object, apiKeyOverride?: string): Promise<any> {
    try {
      const key = apiKeyOverride || this.apiKey;
      const headers: Record<string,string> = { 'Content-Type': 'application/json' };
      if (key) {
        headers['x-api-key'] = key;                 // keep legacy/custom header
        // headers['Authorization'] = `Bearer ${key}`; // add Bearer for bridges that expect it
      }

      const res = await this.axios.post(
        `/api/v1/stores/${storeId}/prepare-invoice`,
        data,
        { headers }
      );

      // WATCH OUT!!!
      // return this.normalizeBridgeResponse(res.data);
      return res.data;
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  async fetchInvoice(invoiceId: string): Promise<any> {
    try {
      const res = await this.axios.get(
        `/api/v1/invoices/${invoiceId}`,
        this.apiKey ? { headers: { 'x-api-key': this.apiKey } } : undefined
      );
      return this.normalizeBridgeResponse(res.data);
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  async fetchStoreInvoice(storeId: string, invoiceId: string): Promise<any>{
    try {
      const res = await this.axios.get(
        `/api/v1/stores/${storeId}/invoices/${invoiceId}`,
        this.apiKey ? { headers: { 'x-api-key': this.apiKey } } : undefined
      );
      return this.normalizeBridgeResponse(res.data);
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  async getPublicProfile(storeId: string): Promise<any> {
    try {
      const res = await this.axios.get(
        `/api/v1/stores/${storeId}/public-profile`
      );
      return this.normalizeBridgeResponse(res.data);
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  async getProfile(storeId: string): Promise<any> {
    try {
      const res = await this.axios.get(
        `/api/v1/stores/${storeId}/profile`,
        this.apiKey ? { headers: { 'x-api-key': this.apiKey } } : undefined
      );
      return this.normalizeBridgeResponse(res.data);
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  async patchStoreProfile(storeId: string, payload: Record<string, any>): Promise<any> {
    try {
      // axios.patch(url, data, config)  ← correct order
      const res = await this.axios.patch(
        `/api/v1/stores/${encodeURIComponent(storeId)}/profile`,
        payload,
        this.merchantHeaders()
      );
      return res.data;
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  async createTx(invoiceId: string): Promise<any> {
    try {
      const res = await this.axios.post(
        `/create-tx`,
        { invoiceId },
        { headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' } }
      );
      return res.data;
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  async cancelInvoiceCreateTx(storeId: string, invoiceId: string, apiKey: string): Promise<any> {
    try {
      const res = await this.axios.post(
        `/api/v1/stores/${storeId}/invoices/${invoiceId}/cancel/create-tx`,
        null,
        { headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' } }
      );
      return res.data;
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  async cancelInvoiceDTO(storeId: string, invoiceId: string, apiKey: string): Promise<any> {
    try {
      const res = await this.axios.post(
        `/api/v1/stores/${storeId}/invoices/${invoiceId}/cancel`,
        {},
        { headers: { 'x-api-key': apiKey } }
      );
      return this.normalizeBridgeResponse(res.data);
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  async createRefundTx(storeId: string, invoiceId: string, amount: number, memo: string, apiKey: string): Promise<any> {
    try {
      const res = await this.axios.post(
        `/api/v1/stores/${storeId}/refunds/create-tx`,
        { invoiceId, amountSats : amount, memo },
        { headers: { 'x-api-key': apiKey } }
      );
      return this.normalizeBridgeResponse(res.data);
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  async archiveInvoice(storeId: string, invoiceId: string, apiKey: string): Promise<any> {
    try {
      const res = await this.axios.post(
        `/api/v1/stores/${storeId}/invoices/${invoiceId}/archive`,
        {},
        { headers: { 'x-api-key': apiKey } }
      );
      return this.normalizeBridgeResponse(res.data);
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  async listStoreInvoices(storeId: string, params: Record<string, any> = {}): Promise<any[]> {
    try {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null && String(v) !== '') qs.append(k, String(v));
      }
      const url = `/api/v1/stores/${encodeURIComponent(storeId)}/invoices${qs.toString() ? `?${qs}` : ''}`;
      const res = await this.axios.get(url, this.merchantHeaders());
      const arr = Array.isArray(res.data) ? res.data : [];
      return arr.map((d) => this.normalizeBridgeResponse(d));
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }


  async createSubscriptionInvoice(storeId: string, subscriptionId: string, ttl_seconds: number, memo: string, apiKey: string): Promise<any> {
    try {
      const res = await this.axios.post(
        `/api/v1/stores/${storeId}/subscriptions/${subscriptionId}/prepare-invoice`,
        { ttl_seconds, memo },
        { headers: { 'x-api-key': apiKey } }
      );
      return this.normalizeBridgeResponse(res.data);
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  async createSubscription(storeId: string, dto: object, apiKey: string): Promise<any> {
    try {
      const res = await this.axios.post(
        `/api/v1/stores/${storeId}/subscriptions`,
        dto,
        { headers: { 'x-api-key': apiKey } }
      );
      return this.normalizeBridgeResponse(res.data);
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  async patchStoreActivate(storeId: string, active: boolean): Promise<{ active: boolean }> {
    if (!storeId || typeof storeId !== 'string') {
      throw { message: 'Invalid storeId for activation', code: 400 };
    }
    if (typeof active !== 'boolean') {
      throw { message: 'Invalid activation flag', code: 400 };
    }
    try {
      const res = await this.axios.patch(
        `/api/admin/stores/${encodeURIComponent(storeId)}/activate`,
        { active },
        this.adminHeaders() // ← use shared admin headers (X-Admin-Token + x-api-key)
      );
      if (!res.data || typeof res.data.active !== 'boolean') {
        throw { message: 'Malformed response from Bridge (activate)', code: 502 };
      }
      return { active: res.data.active };
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }


  async fetchStoreProfile(storeId: string): Promise<any> {
    try {
      const url = `/api/v1/stores/${storeId}/profile`;
      const res = await this.axios.get(url, this.merchantHeaders())
      return this.normalizeBridgeResponse(res.data);
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  async fetchPublicProfile(storeId: string): Promise<any> {
    try {
      const res = await this.axios.get(
        `/api/v1/stores/${storeId}/public-profile`
      );
      return this.normalizeBridgeResponse(res.data);
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  normalizeBridgeResponse(res: any): InvoiceDTO | SubscriptionDTO | Branding | object {
    // Invoice normalization (InvoiceDTO)
    if (
      res &&
      (typeof res.invoiceId === 'string' || typeof res.id === 'string') &&
      typeof res.amountSats === 'number'
    ) {
      return {
        invoiceId: typeof res.invoiceId === 'string' ? res.invoiceId : res.id,
        storeId: typeof res.storeId === 'string' ? res.storeId : '',
        status: res.status,
        amountSats: res.amountSats,
        usdAtCreate: res.usdAtCreate,
        quoteExpiresAt: res.quoteExpiresAt,
        merchantPrincipal: res.merchantPrincipal,
        payer: Object.prototype.hasOwnProperty.call(res, 'payer') ? res.payer : null,
        txId: Object.prototype.hasOwnProperty.call(res, 'txId') ? res.txId : null,
        memo: Object.prototype.hasOwnProperty.call(res, 'memo') ? res.memo : null,
        subscriptionId: Object.prototype.hasOwnProperty.call(res, 'subscriptionId') ? res.subscriptionId : null,
        createdAt: Object.prototype.hasOwnProperty.call(res, 'createdAt') ? res.createdAt : null,
        refundAmount: Object.prototype.hasOwnProperty.call(res, 'refundAmount') ? res.refundAmount : null,
        refundTxId: Object.prototype.hasOwnProperty.call(res, 'refundTxId') ? res.refundTxId : null,
        store: res.store
          ? {
            displayName: res.store.displayName,
            logoUrl: res.store.logoUrl,
            brandColor: res.store.brandColor,
          }
          : undefined,
      } as InvoiceDTO;
    }
    // Branding normalization
    if (
      res &&
      typeof res.displayName === 'string'
    ) {
      return {
        principal: res.principal,
        displayName: res.displayName,
        logoUrl: typeof res.logoUrl === 'string' ? res.logoUrl : null,
        brandColor: typeof res.brandColor === 'string' ? (res.brandColor.startsWith('#') ? res.brandColor : `#${res.brandColor}`) : null,
        supportEmail: typeof res.supportEmail === 'string' ? res.supportEmail : null,
        supportUrl: typeof res.supportUrl === 'string' ? res.supportUrl : null,
        active: typeof res.active === 'boolean' ? res.active : undefined,
        deactivationReason: typeof res.deactivationReason === 'string' ? res.deactivationReason : null,
      } as Branding;
    }
    // SubscriptionDTO normalization
    if (
      res &&
      typeof res.subscriptionId === 'string' &&
      typeof res.amountSats === 'number'
    ) {
      return {
        subscriptionId: res.subscriptionId,
        storeId: res.storeId,
        status: res.status,
        amountSats: res.amountSats,
        intervalBlocks: res.intervalBlocks,
        subscriberPrincipal: res.subscriberPrincipal,
        nextDue: res.nextDue,
        lastBilled: res.lastBilled,
        mode: res.mode,
      } as SubscriptionDTO;
    }
    // Fallback: return as plain object (never leak extraneous fields)
    return {};
  }

  mapBridgeError(error: any): { message: string; code?: string | number; status?: number } {
    let code: string | number | undefined = undefined;
    let message = 'An unexpected error occurred.';
    let status: number | undefined = undefined;

    if (axios.isAxiosError(error)) {
      const resp = error.response;
      status = resp?.status;  // <— add this
      code = resp?.status;
      if (resp?.status === 401 || resp?.status === 403) {
        message = 'Session expired or unauthorized.';
      } else if (resp?.status === 404) {
        message = 'Resource not found.';
      } else if (resp?.status === 409) {
        message = 'Invalid operation (conflict).';
      } else if (resp?.status === 422) {
        message = 'Validation failed.';
      } else if (resp?.status === 500) {
        message = 'Server error. Please try again later.';
      } else if (resp && resp.data && typeof resp.data.message === 'string') {
        message = resp.data.message;
      }
    } else if (error && typeof error.code !== 'undefined') {
      code = error.code;
      message = typeof error.message === 'string' ? error.message : message;
      // allow integer-like codes to flow into status
      if (typeof error.code === 'number') status = error.code;
    } else if (error instanceof Error && typeof error.message === 'string') {
      message = error.message;
    }

    return { message, code, status }; // <— now includes status
  }


  private merchantHeaders() {
    return this.apiKey
      ? { headers: { 'Content-Type': 'application/json', 'x-api-key': this.apiKey } }
      : { headers: { 'Content-Type': 'application/json' } };
  }

  private adminHeaders() {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.adminKey) {
      // match the harness: send all three
      // headers['X-Admin-Token'] = this.adminKey;
      // headers['x-api-key'] = this.adminKey;
      headers['Authorization'] = `Bearer ${this.adminKey}`;
    }
    return { headers };
  }


  // ── Admin: stores list/create ────────────────────────────────────────────────
  async listStores(): Promise<any[]> {
    try {
      const res = await this.axios.get('/api/admin/stores', this.adminHeaders());
      return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  async createStore(dto: Record<string, unknown>): Promise<any> {
    try {
      const res = await this.axios.post('/api/admin/stores', dto, this.adminHeaders());
      return res.data ?? {};
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  // ── Admin: keys/branding/token/bootstrap/sync/poller/webhooks ────────────────
  async rotateApiKeys(storeId: string): Promise<{ apiKey: string; hmacSecret: string }> {
    try {
      const res = await this.axios.post(
        `/api/admin/stores/${encodeURIComponent(storeId)}/rotate-keys`,
        {},
        this.adminHeaders()
      );
      const apiKey = res.data?.apiKey ?? res.data?.api_key;
      const hmacSecret = res.data?.hmacSecret ?? res.data?.hmac_secret;
      if (!apiKey || !hmacSecret) throw { message: 'Rotate keys: malformed response', code: 502 };
      return { apiKey, hmacSecret };
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  async setSbtcTokenConfig(input: { contractAddress: string; contractName: string }): Promise<{ unsignedCall: any }> {
    try {
      const res = await this.axios.post('/api/admin/set-sbtc-token', input, this.adminHeaders());
      return { unsignedCall: res.data?.call ?? res.data?.unsignedCall ?? res.data };
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  async bootstrap(): Promise<{ unsignedCall: any; bootstrapState?: any }> {
    try {
      const res = await this.axios.post('/api/admin/bootstrap', {}, this.adminHeaders());
      return {
        unsignedCall: res.data?.call ?? res.data?.unsignedCall ?? res.data,
        bootstrapState: res.data?.bootstrapState,
      };
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  async syncOnchain(storeId: string): Promise<{ unsignedCalls: any[]; syncState?: any }> {
    try {
      const res = await this.axios.post(
        `/api/admin/stores/${encodeURIComponent(storeId)}/sync-onchain`,
        {},
        this.adminHeaders()
      );
      const calls = Array.isArray(res.data?.calls) ? res.data.calls : res.data?.unsignedCalls ?? [];
      return { unsignedCalls: calls, syncState: res.data?.syncState ?? res.data?.state };
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  async restartPoller(): Promise<{ pollerStatus: any }> {
    try {
      const res = await this.axios.post('/api/admin/poller/restart', {}, this.adminHeaders());
      return { pollerStatus: res.data ?? {} };
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  async fetchWebhooks(filters?: { status?: string; storeId?: string }): Promise<any[]> {
    try {
      const params = new URLSearchParams();
      if (filters?.status) params.set('status', String(filters.status));
      if (filters?.storeId) params.set('storeId', String(filters.storeId));
      const qs = params.toString();
      const url = `/api/admin/webhooks${qs ? `?${qs}` : ''}`;
      const res = await this.axios.get(url, this.adminHeaders());
      return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  async retryWebhook(webhookLogId: string): Promise<{ enqueued: boolean; alreadyDelivered?: boolean }> {
    try {
      const res = await this.axios.post(
        '/api/admin/webhooks/retry',
        { webhookLogId },
        this.adminHeaders()
      );
      return {
        enqueued: !!res.data?.enqueued,
        alreadyDelivered: res.data?.alreadyDelivered,
      };
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  async updateSettings(dto: Record<string, unknown>): Promise<void> {
    try {
      // If your server uses PATCH instead, switch to patch()
      await this.axios.post('/api/admin/settings', dto, this.adminHeaders());
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }

  // Add this method inside BridgeClient
  async getPollerStatus(): Promise<any> {
    try {
      const res = await this.axios.get('/api/admin/poller', this.adminHeaders());
      return res.data ?? {};
    } catch (err) {
      throw this.mapBridgeError(err);
    }
  }
}

