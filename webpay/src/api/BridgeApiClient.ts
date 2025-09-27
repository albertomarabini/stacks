import { BridgeApiSecurityEnforcer } from './BridgeApiSecurityEnforcer';
import { BridgeApiHttpRequestHelper } from './BridgeApiHttpRequestHelper';
import { EmailBrandingFallbackHandler } from './EmailBrandingFallbackHandler';
import { IBridgeApiClient } from '../contracts/interfaces';
import {
  Store,
  Invoice,
  MagicLinkDTO,
  Subscription,
  PublicProfile,
  StoreSecrets,
  WebhookLog,
  PollerStatus,
  UnsignedCall
} from '../models/core';
import { config } from '../config/config';

class BridgeApiClient implements IBridgeApiClient {
  private baseUrl: string;
  private securityEnforcer: BridgeApiSecurityEnforcer;
  private httpRequestHelper: BridgeApiHttpRequestHelper;
  private emailBrandingFallbackHandler: EmailBrandingFallbackHandler;

  constructor() {
    this.baseUrl = config.BRIDGE_API_BASE_URL;
    this.securityEnforcer = new BridgeApiSecurityEnforcer(config.STORE_SECRETS);
    this.httpRequestHelper = new BridgeApiHttpRequestHelper();
    this.emailBrandingFallbackHandler = new EmailBrandingFallbackHandler();
  }

  async prepareInvoice(
    storeId: string,
    payload: {
      amount_sats: number;
      ttl_seconds: number;
      memo: string;
      orderId?: string;
      payerPrincipal?: string;
    }
  ): Promise<MagicLinkDTO> {
    const apiKey = this.securityEnforcer.getStoreApiKey(storeId);
    this.securityEnforcer.validatePrepareInvoicePayload(payload);
    const endpoint = `/api/v1/stores/${storeId}/prepare-invoice`;
    return await this.httpRequestHelper.doRequest('POST', this.baseUrl, endpoint, { apiKey, body: payload });
  }

  async createStore(payload: {
    principal: string;
    name: string;
    display_name?: string;
    logo_url?: string;
    brand_color?: string;
    allowed_origins?: string[];
    webhook_url?: string;
  }): Promise<Store> {
    const endpoint = `/api/admin/stores`;
    return await this.httpRequestHelper.doRequest('POST', this.baseUrl, endpoint, { body: payload });
  }

  async getStoreList(): Promise<Store[]> {
    const endpoint = `/api/admin/stores`;
    return await this.httpRequestHelper.doRequest('GET', this.baseUrl, endpoint);
  }

  async setStoreActiveState(
    storeId: string,
    newState: boolean
  ): Promise<{ active: boolean }> {
    const endpoint = `/api/admin/stores/${storeId}/activate`;
    return await this.httpRequestHelper.doRequest('PATCH', this.baseUrl, endpoint, { body: { active: newState } });
  }

  async getStoreProfile(storeId: string): Promise<Store> {
    const endpoint = `/api/v1/stores/${storeId}/profile`;
    return await this.httpRequestHelper.doRequest('GET', this.baseUrl, endpoint);
  }

  async updateStoreProfile(
    storeId: string,
    payload: {
      displayName?: string;
      logoUrl?: string;
      brandColor?: string;
      allowedOrigins?: string[];
      webhookUrl?: string;
    }
  ): Promise<Store> {
    const endpoint = `/api/v1/stores/${storeId}/profile`;
    return await this.httpRequestHelper.doRequest('PATCH', this.baseUrl, endpoint, { body: payload });
  }

  async getPublicProfile(storeId: string): Promise<PublicProfile> {
    const endpoint = `/api/v1/stores/${storeId}/public-profile`;
    return await this.httpRequestHelper.doRequest('GET', this.baseUrl, endpoint);
  }

  async rotateKeys(storeId: string): Promise<StoreSecrets> {
    const endpoint = `/api/admin/stores/${storeId}/rotate-keys`;
    const result = await this.httpRequestHelper.doRequest('POST', this.baseUrl, endpoint);
    this.securityEnforcer.enforceOneTimeReveal(result.alreadyRevealed);
    return result;
  }

  async setSbtcToken(payload: { contractAddress: string; contractName: string }): Promise<object> {
    const endpoint = `/api/admin/set-sbtc-token`;
    return await this.httpRequestHelper.doRequest('POST', this.baseUrl, endpoint, { body: payload });
  }

  async getWebhooksLog(query: { status: 'all' | 'failed'; storeId?: string }): Promise<WebhookLog[]> {
    const endpoint = `/api/admin/webhooks`;
    return await this.httpRequestHelper.doRequest('GET', this.baseUrl, endpoint, { query });
  }

  async retryWebhook(webhookLogId: string): Promise<object> {
    const endpoint = `/api/admin/webhooks/retry`;
    return await this.httpRequestHelper.doRequest('POST', this.baseUrl, endpoint, { body: { webhookLogId } });
  }

  async getPollerStatus(): Promise<PollerStatus> {
    const endpoint = `/api/admin/poller`;
    return await this.httpRequestHelper.doRequest('GET', this.baseUrl, endpoint);
  }

  async restartPoller(): Promise<{ running: boolean }> {
    const endpoint = `/api/admin/poller/restart`;
    return await this.httpRequestHelper.doRequest('POST', this.baseUrl, endpoint);
  }

  async bootstrapProtocol(): Promise<object> {
    const endpoint = `/api/admin/bootstrap`;
    return await this.httpRequestHelper.doRequest('POST', this.baseUrl, endpoint);
  }

  async syncOnchain(storeId: string): Promise<{ calls: UnsignedCall[] }> {
    const endpoint = `/api/admin/stores/${storeId}/sync-onchain`;
    return await this.httpRequestHelper.doRequest('POST', this.baseUrl, endpoint);
  }
}

export { BridgeApiClient };
