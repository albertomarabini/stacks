// src/schedulers/SubscriptionScheduler.ts
import type {
  IStacksChainClient,
  IContractCallBuilder,
  IConfigService,
  IInvoiceIdCodec,
  IWebhookDispatcher,
} from '../contracts/interfaces';
import type { ISqliteStore } from '../contracts/dao';
import type { SubscriptionRow } from '../contracts/domain';
import { PricingService } from '../services/PricingService';
import { SubscriptionInvoicePlanner } from '../delegates/SubscriptionInvoicePlanner';

type BroadcastInput = {
  idBuf32: Uint8Array;
  amountSats: number;
  memo?: string;
  expiresAtBlocks?: number;
};

export class SubscriptionScheduler {
  private chain!: IStacksChainClient;
  private builder!: IContractCallBuilder;
  private store!: ISqliteStore;
  private pricing!: PricingService;
  private cfg!: IConfigService;
  private dispatcher!: IWebhookDispatcher;
  private codec!: IInvoiceIdCodec;

  private intervalId: NodeJS.Timeout | undefined;

  bindDependencies(deps: {
    chain: IStacksChainClient;
    builder: IContractCallBuilder;
    store: ISqliteStore;
    pricing: PricingService;
    cfg: IConfigService;
    dispatcher: IWebhookDispatcher;
    codec: IInvoiceIdCodec;
  }): void {
    this.chain = deps.chain;
    this.builder = deps.builder;
    this.store = deps.store;
    this.pricing = deps.pricing;
    this.cfg = deps.cfg;
    this.dispatcher = deps.dispatcher;
    this.codec = deps.codec;
  }

  bootstrapScheduler(): void {
    if (this.intervalId) return;

    const avgBlockSecs = this.cfg.getAvgBlockSecs();
    const poll = this.cfg.getPollingConfig().pollIntervalSecs;
    const ttlSecs = Number(process.env.QUOTE_TTL_SECONDS);

    if (!Number.isFinite(avgBlockSecs) || avgBlockSecs <= 0) return;
    if (!Number.isFinite(poll) || poll <= 0) return;
    if (!Number.isFinite(ttlSecs) || ttlSecs <= 0) return;

    const intervalMs = poll * 1000;
    this.intervalId = setInterval(() => this.timerCallback(), intervalMs);
  }

  private timerCallback(): void {
    void this.tick().catch(() => {});
  }

  async tick(): Promise<void> {
    const tip = await this.chain.getTip();
    await this.processDueSubscriptions(tip.height);
  }

  async processDueSubscriptions(currentHeight: number): Promise<void> {
    const subs = this.store.selectDueSubscriptions(currentHeight);
    for (const sub of subs) {
      try {
        await this.onSubscriptionInvoiceCreated({ subscription: sub, currentHeight });
      } catch {
        // Skip failed item and continue with others
      }
    }
  }

  async onSubscriptionInvoiceCreated(ctx: {
    subscription: SubscriptionRow;
    currentHeight: number;
  }): Promise<void> {
    const sub = ctx.subscription;

    const planner = new SubscriptionInvoicePlanner(
      this.store,
      this.pricing,
      this.cfg,
      this.codec,
    );
    const planned = await planner.plan(sub, ctx.currentHeight);

    await this.broadcastCreateInvoiceTx({
      idBuf32: planned.idBuf32,
      amountSats: sub.amount_sats,
      memo: undefined,
      expiresAtBlocks: planned.expiresAtBlocks,
    });

    const nowSecs = Math.floor(Date.now() / 1000);
    this.store.invoices.insert({
      id_raw: planned.idRaw,
      id_hex: planned.idHex,
      store_id: sub.store_id,
      amount_sats: sub.amount_sats,
      usd_at_create: planned.usdAtCreate,
      quote_expires_at: planned.quoteExpiresAtMs,
      merchant_principal: sub.merchant_principal,
      status: 'unpaid',
      payer: undefined,
      txid: undefined,
      memo: undefined,
      webhook_url: undefined,
      created_at: nowSecs,
      refunded_at: undefined,
      refund_amount: 0,
      refund_txid: undefined,
      subscription_id: sub.id,
      refund_count: 0,
      expired: 0,
    });
    this.store.advanceSubscriptionSchedule(sub.id);

    const rawBody = planner.buildWebhookRawBody(planned, sub);
    await this.dispatcher.dispatch({
      storeId: sub.store_id,
      subscriptionId: sub.id,
      invoiceId: planned.idRaw,
      eventType: 'subscription',
      rawBody,
    });
  }

  async broadcastCreateInvoiceTx(input: BroadcastInput): Promise<string> {
    if (!(input.idBuf32 instanceof Uint8Array) || input.idBuf32.length !== 32) {
      throw new Error('idBuf32 must be 32 bytes');
    }
    if (!Number.isInteger(input.amountSats) || input.amountSats <= 0) {
      throw new TypeError('amountSats must be a positive integer');
    }

    const idHex = this.codec.hexFromBuff32(input.idBuf32);
    const payload = this.builder.buildCreateInvoice({
      idHex,
      amountSats: input.amountSats,
      memo: input.memo,
      expiresAtBlock: input.expiresAtBlocks,
    });

    if (!this.cfg.isAutoBroadcastOnChainEnabled()) {
      throw new Error('auto_broadcast_disabled');
    }

    const senderKey = String(process.env.SCHEDULER_SENDER_KEY ?? process.env.SIGNER_PRIVATE_KEY ?? '');
    // Delegate to the chain client so it applies configured baseUrl, PCs, modes, retries.
    const { txid } = await this.chain.signAndBroadcast(
      { ...payload, network: this.cfg.getNetwork() as any },
      senderKey
    );
    return txid;
  }
}
