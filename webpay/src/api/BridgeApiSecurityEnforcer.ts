import { StoreSecrets } from '../models/core';

class BridgeApiSecurityEnforcer {
  private storeSecrets: Record<string, { apiKey: string; hmacSecret: string }>;

  constructor(storeSecrets: Record<string, { apiKey: string; hmacSecret: string }>) {
    this.storeSecrets = storeSecrets;
  }

  getStoreApiKey(storeId: string): string {
    const secrets = this.storeSecrets[storeId];
    if (!secrets || !secrets.apiKey) {
      throw {
        statusCode: 500,
        message: `Missing API key for store ${storeId}`
      };
    }
    return secrets.apiKey;
  }

  validatePrepareInvoicePayload(payload: { amount_sats: number; ttl_seconds: number; memo: string; orderId?: string; payerPrincipal?: string }): void {
    if (
      typeof payload.amount_sats !== 'number' ||
      payload.amount_sats <= 0 ||
      typeof payload.ttl_seconds !== 'number' ||
      payload.ttl_seconds < 120 ||
      payload.ttl_seconds > 1800 ||
      typeof payload.memo !== 'string' ||
      !payload.memo
    ) {
      throw {
        statusCode: 400,
        message: 'Invalid invoice creation parameters'
      };
    }
  }

  enforceOneTimeReveal(alreadyRevealed: boolean): void {
    if (alreadyRevealed) {
      throw {
        statusCode: 403,
        message: 'Secret already revealed; further access forbidden'
      };
    }
  }
}

export { BridgeApiSecurityEnforcer };
