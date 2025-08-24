// src/delegates/MerchantKeyRotationService.ts
import { randomBytes } from 'crypto';
import type { ISqliteStore } from '/src/contracts/dao';

export class MerchantKeyRotationService {
  rotate(
    store: ISqliteStore,
    storeId: string
  ):
    | { ok: true; apiKey: string; hmacSecret: string }
    | { ok: false; notFound: true } {
    const exists = store.listMerchantsProjection().some((m: any) => m.id === storeId);
    if (!exists) return { ok: false, notFound: true };

    const apiKey = randomBytes(32).toString('hex');
    const hmacSecret = randomBytes(32).toString('hex');

    store.updateMerchantKeysTx(storeId, apiKey, hmacSecret);

    return { ok: true, apiKey, hmacSecret };
  }
}
