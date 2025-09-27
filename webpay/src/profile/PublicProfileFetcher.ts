import { IBridgeApiClient } from '../contracts/interfaces';
import { PublicProfile } from '../models/core';

class PublicProfileFetcher {
  private bridgeApiClient: IBridgeApiClient;

  constructor(deps: { bridgeApiClient: IBridgeApiClient }) {
    this.bridgeApiClient = deps.bridgeApiClient;
  }

  async fetchBranding(storeId: string): Promise<PublicProfile> {
    return this.bridgeApiClient.getPublicProfile(storeId);
  }
}

export { PublicProfileFetcher };
