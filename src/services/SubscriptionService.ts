// src/services/SubscriptionService.ts
import crypto from 'crypto';
import type { ISqliteStore } from '../contracts/dao';
import type {
  IContractCallBuilder,
  IStacksChainClient,
  IConfigService,
  IInvoiceIdCodec,
} from '../contracts/interfaces';
import { PricingService } from './PricingService';
import type {
  SubscriptionRow,
  PublicInvoiceDTO,
  UnsignedContractCall,
} from '../contracts/domain';

type CreateSubInput = {
  subscriber: string;
  amountSats: number;
  intervalBlocks: number;
  mode?: 'invoice' | 'direct';
};

export class SubscriptionService {
  private store!: ISqliteStore;
  private builder!: IContractCallBuilder;
  private chain!: IStacksChainClient;
  private cfg!: IConfigService;
  private codec!: IInvoiceIdCodec;
  private pricing!: PricingService;

  bindDependencies(deps: {
    store: ISqliteStore;
    builder: IContractCallBuilder;
    chain: IStacksChainClient;
    cfg: IConfigService;
    codec: IInvoiceIdCodec;
    pricing: PricingService;
  }): void {
    this.store = deps.store;
    this.builder = deps.builder;
    this.chain = deps.chain;
    this.cfg = deps.cfg;
    this.codec = deps.codec;
    this.pricing = deps.pricing;
  }

  async createSubscription(
    store: { id: string; principal: string },
    body: CreateSubInput,
  ): Promise<{ row: SubscriptionRow; unsignedCall?: UnsignedContractCall }> {
    const id = crypto.randomUUID();
    const idHex = this.generateUniqueSubHex();
    const now = Math.floor(Date.now() / 1000);
    const tip = await this.chain.getTip();
    const nextInvoiceAt = tip.height + body.intervalBlocks;
    const mode = body.mode ?? 'invoice';
    
    const row: SubscriptionRow = {
      id,
      id_hex: idHex,
      store_id: store.id,
      merchant_principal: store.principal,
      subscriber: body.subscriber,
      amount_sats: body.amountSats,
      interval_blocks: body.intervalBlocks,
      active: 1,
      created_at: now,
      last_billed_at: undefined,
      next_invoice_at: nextInvoiceAt,
      last_paid_invoice_id: undefined,
      mode,
    };

    this.store.insertSubscription(row);

    let unsignedCall: UnsignedContractCall | undefined;
    if (mode === 'direct') {
      unsignedCall = this.builder.buildCreateSubscription({
        idHex,
        merchant: store.principal,
        subscriber: body.subscriber,
        amountSats: body.amountSats,
        intervalBlocks: body.intervalBlocks,
      });
    }

    return { row, unsignedCall };
  }

  async generateInvoiceForSubscription(
    sub: SubscriptionRow,
    opts: {
      storeId: string;
      merchantPrincipal: string;
      ttlSeconds: number;
      memo?: string;
      webhookUrl?: string;
    },
  ): Promise<{ invoice: PublicInvoiceDTO; unsignedCall: UnsignedContractCall }> {
    const idHex = this.generateUniqueInvoiceHex();
    const nowMs = Date.now();
    const nowSecs = Math.floor(nowMs / 1000);
    const usdAtCreate = await this.pricing.getUsdPriceSnapshot();
    const tip = await this.chain.getTip();
    const avgBlockSecs = this.cfg.getAvgBlockSecs();
    const expiresAtBlocks = tip.height + Math.ceil(opts.ttlSeconds / avgBlockSecs);
    const quoteExpiresAt = nowMs + opts.ttlSeconds * 1000;

    const unsignedCall = this.builder.buildCreateInvoice({
      idHex,
      amountSats: sub.amount_sats,
      memo: opts.memo,
      expiresAtBlock: expiresAtBlocks,
    });

    const idRaw = crypto.randomUUID();

    this.store.invoices.insert({
      id_raw: idRaw,
      id_hex: idHex,
      store_id: opts.storeId,
      amount_sats: sub.amount_sats,
      usd_at_create: usdAtCreate,
      quote_expires_at: quoteExpiresAt,
      merchant_principal: opts.merchantPrincipal,
      status: 'unpaid',
      payer: undefined,
      txid: undefined,
      memo: opts.memo,
      webhook_url: opts.webhookUrl,
      created_at: nowSecs,
      refunded_at: undefined,
      refund_amount: 0,
      refund_txid: undefined,
      subscription_id: sub.id,
      refund_count: 0,
      expired: 0,
    });

    this.store.advanceSubscriptionSchedule(sub.id);

    const invoice: PublicInvoiceDTO = {
      invoiceId: idRaw,
      idHex,
      storeId: opts.storeId,
      amountSats: sub.amount_sats,
      usdAtCreate,
      quoteExpiresAt: quoteExpiresAt,
      merchantPrincipal: opts.merchantPrincipal,
      status: 'unpaid',
      payer: undefined,
      txId: undefined,
      memo: opts.memo ?? undefined,
      subscriptionId: sub.id,
      createdAt: nowSecs,
      refundAmount: undefined,
      refundTxId: undefined,
      store: undefined,
    };

    return { invoice, unsignedCall };
  }

  async setMode(
    sub: SubscriptionRow,
    mode: 'invoice' | 'direct',
  ): Promise<{ row: SubscriptionRow; unsignedCall?: UnsignedContractCall }> {
    this.store.updateSubscriptionMode(sub.id, sub.store_id, mode);
    let unsignedCall: UnsignedContractCall | undefined;

    if (mode === 'direct') {
      const onchain = await this.chain.readSubscription(sub.id_hex);
      if (!onchain) {
        unsignedCall = this.builder.buildCreateSubscription({
          idHex: sub.id_hex,
          merchant: sub.merchant_principal,
          subscriber: sub.subscriber,
          amountSats: sub.amount_sats,
          intervalBlocks: sub.interval_blocks,
        });
      }
    }

    const updated =
      this.store.getSubscriptionByIdForStore(sub.id, sub.store_id) ||
      ({ ...sub, mode } as SubscriptionRow);

    return { row: updated, unsignedCall };
  }

  async cancel(
    sub: SubscriptionRow,
  ): Promise<{ row: SubscriptionRow; unsignedCall: UnsignedContractCall }> {
    this.store.deactivateSubscription(sub.id, sub.store_id);
    const unsignedCall = this.builder.buildCancelSubscription({ idHex: sub.id_hex });
    const updated =
      this.store.getSubscriptionByIdForStore(sub.id, sub.store_id) ||
      ({ ...sub, active: 0 } as SubscriptionRow);
    return { row: updated, unsignedCall };
  }

  private generateUniqueSubHex(): string {
    let idHex: string;
    do {
      idHex = this.codec.generateRandomBuff32Hex();
      this.codec.assertHex64(idHex);
    } while (this.store.subscriptionExists(idHex));
    return idHex;
  }

  private generateUniqueInvoiceHex(): string {
    let idHex: string;
    do {
      idHex = this.codec.generateRandomBuff32Hex();
      this.codec.assertHex64(idHex);
    } while (!this.store.ensureInvoiceIdHexUnique(idHex));
    return idHex;
  }
}
