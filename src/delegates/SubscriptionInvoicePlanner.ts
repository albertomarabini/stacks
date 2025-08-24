// src/delegates/SubscriptionInvoicePlanner.ts
import crypto from 'crypto';
import type { ISqliteStore } from '/src/contracts/dao';
import type { IInvoiceIdCodec, IConfigService } from '/src/contracts/interfaces';
import type { SubscriptionRow } from '/src/contracts/domain';
import { PricingService } from '/src/services/PricingService';

export type PlannedInvoice = {
  idHex: string;
  idBuf32: Uint8Array;
  idRaw: string;
  usdAtCreate: number;
  quoteExpiresAtMs: number;
  expiresAtBlocks: number;
  nextDue: number;
};

export class SubscriptionInvoicePlanner {
  constructor(
    private store: ISqliteStore,
    private pricing: PricingService,
    private cfg: IConfigService,
    private codec: IInvoiceIdCodec
  ) {}

  async plan(subscription: SubscriptionRow, currentHeight: number): Promise<PlannedInvoice> {
    const ttlSecs = Number(process.env.QUOTE_TTL_SECONDS);
    if (!Number.isFinite(ttlSecs) || ttlSecs <= 0) {
      throw new Error('Missing or invalid QUOTE_TTL_SECONDS.');
    }

    let idHex: string;
    do {
      idHex = this.codec.generateRandomBuff32Hex();
      this.codec.assertHex64(idHex);
    } while (!this.store.ensureInvoiceIdHexUnique(idHex));

    const idBuf32 = this.codec.toBuff32Hex(idHex);
    const idRaw = crypto.randomUUID();

    const usdAtCreate = await this.pricing.getUsdPriceSnapshot();
    const nowMs = Date.now();

    const avgBlockSecs = this.cfg.getAvgBlockSecs();
    const expiresAtBlocks = currentHeight + Math.ceil(ttlSecs / avgBlockSecs);
    const quoteExpiresAtMs = nowMs + ttlSecs * 1000;

    const nextDue = subscription.next_invoice_at + subscription.interval_blocks;

    return {
      idHex,
      idBuf32,
      idRaw,
      usdAtCreate,
      quoteExpiresAtMs,
      expiresAtBlocks,
      nextDue,
    };
  }

  buildWebhookRawBody(planned: PlannedInvoice, subscription: SubscriptionRow): string {
    return JSON.stringify({
      subscriptionId: subscription.id,
      invoiceId: planned.idRaw,
      amountSats: subscription.amount_sats,
      nextDue: planned.nextDue,
      subscriber: subscription.subscriber,
    });
  }
}
