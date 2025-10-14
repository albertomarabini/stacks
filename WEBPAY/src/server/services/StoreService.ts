import type { IBridgeClient, IStoreService } from '../../shared/contracts/interfaces';
import type { Branding } from '../../shared/models/dto';

/**
 * StoreService
 *
 * Handles merchant store CRUD, POS config, branding/profile fetch,
 * and API key rotation via BridgeClient.
 * Stateless; never persists domain data or local storage.
 * Outputs are per-request only.
 */
export class StoreService implements IStoreService {
  private bridgeClient: IBridgeClient;

  constructor(bridgeClient: IBridgeClient) {
    this.bridgeClient = bridgeClient;
  }

  /**
   * Fetches the normalized Branding DTO for the store (merchant/internal context).
   * @param storeId The store's unique identifier.
   * @returns Promise<Branding>
   */
  async fetchStoreProfile(storeId: string): Promise<Branding> {
    return await this.bridgeClient.getProfile(storeId);
  }

  /**
   * Fetches the normalized Branding DTO for the store (public context).
   * @param storeId The store's unique identifier.
   * @returns Promise<Branding>
   */
  async fetchPublicBranding(storeId: string): Promise<Branding> {
    return await this.bridgeClient.getPublicProfile(storeId);
  }

  /**
   * Rotates API keys for the store.
   * Returns the new apiKey and hmacSecret for one-time display (never persisted).
   * @param storeId The store's unique identifier.
   * @returns Promise<{ apiKey: string; hmacSecret: string }>
   */
  async rotateApiKeys(storeId: string): Promise<{ apiKey: string; hmacSecret: string }> {
    // This method delegates to the BridgeClient, which must implement rotateApiKeys.
    // The result is only ever returned for one-time SSR reveal.
    return await (this.bridgeClient as any).rotateApiKeys(storeId);
  }
}
