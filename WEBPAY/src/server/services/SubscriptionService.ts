import type { IBridgeClient, ISubscriptionService } from '../../shared/contracts/interfaces';
import type { SubscriptionDTO } from '../../shared/models/dto';

export class SubscriptionService implements ISubscriptionService{
  private bridgeClient: IBridgeClient;

  constructor(bridgeClient: IBridgeClient) {
    this.bridgeClient = bridgeClient;
  }

  async createSubscription(storeId: string, dto: object, apiKey: string): Promise<SubscriptionDTO> {
    const result = await this.bridgeClient.createSubscription(storeId, dto as any, apiKey);
    return result as SubscriptionDTO;
  }

  async cancelSubscription(storeId: string, subscriptionId: string): Promise<SubscriptionDTO> {
    if (typeof (this.bridgeClient as any).cancelSubscription === 'function') {
      const result = await (this.bridgeClient as any).cancelSubscription(storeId, subscriptionId);
      return result as SubscriptionDTO;
    }
    throw new Error('cancelSubscription not implemented in BridgeClient');
  }

  async fetchSubscriptions(storeId: string): Promise<SubscriptionDTO[]> {
    if (typeof (this.bridgeClient as any).fetchSubscriptions === 'function') {
      const result = await (this.bridgeClient as any).fetchSubscriptions(storeId);
      return result as SubscriptionDTO[];
    }
    throw new Error('fetchSubscriptions not implemented in BridgeClient');
  }

  async fetchSubscriptionDetail(storeId: string, subscriptionId: string): Promise<SubscriptionDTO> {
    if (typeof (this.bridgeClient as any).fetchSubscriptionDetail === 'function') {
      const result = await (this.bridgeClient as any).fetchSubscriptionDetail(storeId, subscriptionId);
      return result as SubscriptionDTO;
    }
    throw new Error('fetchSubscriptionDetail not implemented in BridgeClient');
  }

  async fetchFilteredSubscriptions(storeId: string, filterParams: object): Promise<SubscriptionDTO[]> {
    if (typeof (this.bridgeClient as any).fetchFilteredSubscriptions === 'function') {
      const result = await (this.bridgeClient as any).fetchFilteredSubscriptions(storeId, filterParams);
      return result as SubscriptionDTO[];
    }
    throw new Error('fetchFilteredSubscriptions not implemented in BridgeClient');
  }
}

