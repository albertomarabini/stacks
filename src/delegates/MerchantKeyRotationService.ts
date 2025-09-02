// src/delegates/MerchantKeyRotationService.ts
import { randomBytes } from 'crypto';
import type { ISqliteStore } from '../contracts/dao';

export class MerchantKeyRotationService {
  private deliveredOnce = new Set<string>();

  rotate(
    store: ISqliteStore,
    storeId: string
  ):
    | { ok: true; apiKey: string; hmacSecret: string }
    | { ok: false; notFound: true }
    | { ok: false; alreadyDelivered: true } {
    const exists = store.listMerchantsProjection().some((m: any) => m.id === storeId);
    if (!exists) return { ok: false, notFound: true };

    if (this.deliveredOnce.has(storeId)) {
      // Do not rotate again and do not leak again
      return { ok: false, alreadyDelivered: true };
    }

    const apiKey = randomBytes(32).toString('hex');
    const hmacSecret = randomBytes(32).toString('hex');

    store.updateMerchantKeysTx(storeId, apiKey, hmacSecret);
    this.deliveredOnce.add(storeId);

    return { ok: true, apiKey, hmacSecret };
  }
}
