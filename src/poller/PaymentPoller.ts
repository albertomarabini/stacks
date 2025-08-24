// src/poller/PaymentPoller.ts
import type { ISqliteStore } from '/src/contracts/dao';
import type {
  IStacksChainClient,
  IConfigService,
  IWebhookDispatcher,
} from '/src/contracts/interfaces';
import type {
  PollerMetrics,
  NormalizedEvent,
  InvoiceStatus,
} from '/src/contracts/domain';
import { ContractCallEventNormalizer } from '/src/delegates/ContractCallEventNormalizer';
import { ReorgGuard } from '/src/delegates/ReorgGuard';
import { SubscriptionLifecycleProcessor } from '/src/delegates/SubscriptionLifecycleProcessor';
import { InvoiceEventApplier } from '/src/delegates/InvoiceEventApplier';
import { ExpirationMonitor } from '/src/services/ExpirationMonitor';

type CursorState = {
  lastHeight: number;
  lastTxId?: string;
  lastBlockHash?: string;
};

export class PaymentPoller {
  private chain!: IStacksChainClient;
  private store!: ISqliteStore;
  private dispatcher!: IWebhookDispatcher;
  private expirations!: ExpirationMonitor;
  private cfg!: IConfigService;

  private cursor: CursorState = { lastHeight: 0 };
  private metrics: PollerMetrics = {
    running: false,
    lastRunAt: undefined,
    lastHeight: 0,
    lastTxId: undefined,
    lastBlockHash: undefined,
    lagBlocks: undefined,
  };

  private pollHandle: NodeJS.Timeout | null = null;
  private currentIntervalMs = 0;
  private rewindToHeight: number | undefined;

  private eventNormalizer = new ContractCallEventNormalizer();
  private reorgGuard = new ReorgGuard();
  private subscriptionProcessor!: SubscriptionLifecycleProcessor;
  private invoiceApplier!: InvoiceEventApplier;

  bindDependencies(
    chain: IStacksChainClient,
    store: ISqliteStore,
    dispatcher: IWebhookDispatcher,
    expirations: ExpirationMonitor,
    cfg: IConfigService,
  ): void {
    this.chain = chain;
    this.store = store;
    this.dispatcher = dispatcher;
    this.expirations = expirations;
    this.cfg = cfg;

    this.subscriptionProcessor = new SubscriptionLifecycleProcessor(
      this.store,
      this.chain,
      this.dispatcher,
    );
    this.invoiceApplier = new InvoiceEventApplier(this.store, this.dispatcher);
  }

  bootstrapPoller(): void {
    if (this.pollHandle) return;
    const pollSecs = this.cfg.getPollingConfig().pollIntervalSecs;
    const avgBlockSecs = this.cfg.getAvgBlockSecs();
    const intervalSecs = Math.max(pollSecs, avgBlockSecs, 30);
    this.currentIntervalMs = intervalSecs * 1000;

    if (!this.cursor) {
      this.cursor = { lastHeight: 0, lastTxId: undefined, lastBlockHash: undefined };
    }
    this.metrics = {
      running: false,
      lastRunAt: undefined,
      lastHeight: 0,
      lastTxId: undefined,
      lastBlockHash: undefined,
      lagBlocks: undefined,
    };

    this.pollHandle = setInterval(() => void this.timerCallback(), this.currentIntervalMs);
  }

  timerCallback(): void {
    void this.pollTick().catch(() => {});
  }

  async startPoller(): Promise<void> {
    const saved =
      this.store.getPollerCursor() ??
      null;

    if (saved) {
      this.cursor = {
        lastHeight: saved.lastHeight,
        lastTxId: saved.lastTxId,
        lastBlockHash: saved.lastBlockHash,
      };
    } else {
      const tip = await this.chain.getTip();
      this.cursor = {
        lastHeight: tip.height,
        lastTxId: undefined,
        lastBlockHash: tip.blockHash,
      };
    }

    const pollSecs = this.cfg.getPollingConfig().pollIntervalSecs;
    this.currentIntervalMs = pollSecs * 1000;
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    this.pollHandle = setInterval(() => void this.timerCallback(), this.currentIntervalMs);

    this.metrics = {
      running: false,
      lastRunAt: undefined,
      lastHeight: this.cursor.lastHeight,
      lastTxId: this.cursor.lastTxId,
      lastBlockHash: this.cursor.lastBlockHash,
      lagBlocks: 0,
    };
  }

  async pollTick(): Promise<void> {
    if (!this.guardReentrancy()) return;

    let tipHeight = 0;
    try {
      const { tipHeight: th, tipBlockHash, cursorRef } = await this.readChainTip();
      tipHeight = th;
      const fromHeight = this.rewindToHeight !== undefined ? this.rewindToHeight : cursorRef.lastHeight + 1;

      const batch = await this.fetchAndFilterEvents(fromHeight);

      const { minConfirmations } = this.cfg.getPollingConfig();
      await this.processSubscriptionEvents(batch, tipHeight, minConfirmations);

      for (const e of batch) {
        await this.processEvent(e, tipHeight, minConfirmations);
      }

      const unpaid: InvoiceStatus[] = ['unpaid'];
      const candidates = this.store
        .selectAdminInvoices(unpaid)
        .map((r) => r.id_hex);
      await this.expirations.sweepOnchainStatuses(candidates, {
        store: this.store,
        chain: this.chain,
        dispatcher: this.dispatcher,
      });

      const reorg = await this.detectReorg(fromHeight, tipHeight);
      if (reorg) {
        this.planRewindWindow();
        return;
      }

      const lastTxId = batch.length ? batch[batch.length - 1].tx_id : undefined;
      await this.updateCursorState(
        { height: tipHeight, blockHash: tipBlockHash, parentHash: '' },
        lastTxId,
      );
      this.rewindToHeight = undefined;
    } finally {
      this.refreshMetrics({ tipHeight });
    }
  }

  guardReentrancy(): boolean {
    if (this.metrics.running) return false;
    this.metrics.running = true;
    return true;
  }

  async readChainTip(): Promise<{
    tipHeight: number;
    tipBlockHash: string;
    cursorRef: CursorState;
  }> {
    const cursorRef = { ...this.cursor };
    const { height, blockHash } = await this.chain.getTip();
    return { tipHeight: height, tipBlockHash: blockHash, cursorRef };
  }

  async fetchAndFilterEvents(fromHeight: number): Promise<NormalizedEvent[]> {
    return this.eventNormalizer.fetchAndFilterEvents(fromHeight, this.chain, this.store);
  }

  async processSubscriptionEvents(
    eventBatch: NormalizedEvent[],
    tipHeight: number,
    minConfirmations: number,
  ): Promise<void> {
    await this.subscriptionProcessor.processBatch(eventBatch, tipHeight, minConfirmations);
  }

  async processEvent(
    e: NormalizedEvent,
    tipHeight: number,
    minConfirmations: number,
  ): Promise<void> {
    const confirmations = tipHeight - e.block_height + 1;
    if (confirmations < minConfirmations) return;

    if (e.type === 'invoice-paid') {
      await this.onInvoicePaidConfirmed(e);
      return;
    }
    if (e.type === 'refund-invoice') {
      await this.onRefundConfirmed(e);
      return;
    }
    if (e.type === 'invoice-canceled') {
      await this.onInvoiceCanceled(e);
      return;
    }
  }

  async detectReorg(firstBlockToProcessHeight: number, tipHeight: number): Promise<boolean> {
    return this.reorgGuard.detectReorg(
      firstBlockToProcessHeight,
      tipHeight,
      { lastHeight: this.cursor.lastHeight, lastBlockHash: this.cursor.lastBlockHash },
      this.chain,
    );
  }

  planRewindWindow(): void {
    const { reorgWindowBlocks } = this.cfg.getPollingConfig();
    const target = this.reorgGuard.computeRewindTarget(
      { lastHeight: this.cursor.lastHeight, lastBlockHash: this.cursor.lastBlockHash },
      reorgWindowBlocks,
    );
    this.planRewind(target);
  }

  planRewind(targetHeight: number): void {
    this.rewindToHeight = targetHeight;
  }

  async updateCursorState(
    processedBlockHeader: { height: number; blockHash: string; parentHash: string },
    lastTxId?: string,
  ): Promise<void> {
    this.cursor = {
      lastHeight: processedBlockHeader.height,
      lastTxId,
      lastBlockHash: processedBlockHeader.blockHash,
    };
    const now = Math.floor(Date.now() / 1000);
    this.store.savePollerCursor({
      lastRunAt: now,
      lastHeight: this.cursor.lastHeight,
      lastTxId: this.cursor.lastTxId,
      lastBlockHash: this.cursor.lastBlockHash,
    });

    const tip = await this.chain.getTip();
    this.metrics.lastHeight = this.cursor.lastHeight;
    this.metrics.lastTxId = this.cursor.lastTxId;
    this.metrics.lastBlockHash = this.cursor.lastBlockHash;
    this.metrics.lagBlocks = Math.max(0, tip.height - this.cursor.lastHeight);
  }

  async onInvoicePaidConfirmed(event: NormalizedEvent): Promise<void> {
    await this.invoiceApplier.handlePaid(event);
  }

  async onRefundConfirmed(event: NormalizedEvent): Promise<void> {
    await this.invoiceApplier.handleRefund(event);
  }

  async onSubscriptionCreated(
    event: NormalizedEvent,
    tipHeight: number,
    minConfirmations: number,
  ): Promise<void> {
    const confirmations = tipHeight - event.block_height + 1;
    if (confirmations < minConfirmations) return;
    if (!/^[0-9A-Fa-f]{64}$/.test(event.idHex)) return;
    const storeId = this.store.getStoreIdByPrincipal(String(event.merchantPrincipal));
    if (!storeId) return;

    this.store.upsertSubscriptionByHex({
      idHex: event.idHex,
      storeId,
      merchantPrincipal: String(event.merchantPrincipal),
      subscriber: String(event.subscriber),
      amountSats: Number(event.amountSats),
      intervalBlocks: Number(event.intervalBlocks),
      active: 1,
    });

    const onchain = await this.chain.readSubscription(event.idHex);
    const nextDue =
      onchain?.nextDue !== undefined ? Number(onchain.nextDue) : tipHeight + Number(event.intervalBlocks ?? 0);

    const rawBody = JSON.stringify({
      subscriptionId: event.idHex,
      merchant: String(event.merchantPrincipal),
      subscriber: String(event.subscriber),
      amountSats: Number(event.amountSats),
      intervalBlocks: Number(event.intervalBlocks),
      nextDue,
    });

    await this.dispatcher.dispatch({
      storeId,
      subscriptionId: event.idHex,
      eventType: 'subscription-created',
      rawBody,
    });
  }

  async onSubscriptionPaid(
    event: NormalizedEvent,
    tipHeight: number,
    minConfirmations: number,
  ): Promise<void> {
    const confirmations = tipHeight - event.block_height + 1;
    if (confirmations < minConfirmations) return;

    const onchain = await this.chain.readSubscription(event.idHex);
    const amountSats = onchain ? Number(onchain.amountSats) : 0;
    const nextDue = onchain ? Number(onchain.nextDue) : tipHeight + Number(event.intervalBlocks ?? 0);
    const merchant = onchain?.merchant;
    const storeId = merchant ? this.store.getStoreIdByPrincipal(merchant) : undefined;
    if (!storeId) return;

    this.store.updateSubscriptionLastPaid({ subscriptionId: event.idHex, lastPaidInvoiceId: '' });

    const rawBody = JSON.stringify({
      subscriptionId: event.idHex,
      subscriber: String(event.sender),
      amountSats,
      txId: event.tx_id,
      nextDue,
    });

    await this.dispatcher.dispatch({
      storeId,
      subscriptionId: event.idHex,
      eventType: 'subscription-paid',
      rawBody,
    });
  }

  async onSubscriptionCanceled(
    event: NormalizedEvent,
    tipHeight: number,
    minConfirmations: number,
  ): Promise<void> {
    const confirmations = tipHeight - event.block_height + 1;
    if (confirmations < minConfirmations) return;

    this.store.setSubscriptionActive({ idHex: event.idHex, active: 0 });

    const onchain = await this.chain.readSubscription(event.idHex);
    const storeId = onchain ? this.store.getStoreIdByPrincipal(onchain.merchant) : undefined;
    if (!storeId) return;

    const rawBody = JSON.stringify({ subscriptionId: event.idHex });

    await this.dispatcher.dispatch({
      storeId,
      subscriptionId: event.idHex,
      eventType: 'subscription-canceled',
      rawBody,
    });
  }

  refreshMetrics(snapshot?: Partial<PollerMetrics> & { tipHeight?: number }): void {
    this.metrics.running = false;
    this.metrics.lastRunAt = Math.floor(Date.now() / 1000);
    this.metrics.lastHeight = this.cursor.lastHeight;
    this.metrics.lastTxId = this.cursor.lastTxId;
    this.metrics.lastBlockHash = this.cursor.lastBlockHash;
    if (typeof snapshot?.tipHeight === 'number') {
      this.metrics.lagBlocks = Math.max(0, snapshot.tipHeight - this.cursor.lastHeight);
    }
  }

  restartPoller(): { running: boolean } {
    if (this.pollHandle) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    this.metrics.running = false;
    const ms =
      this.currentIntervalMs ||
      this.cfg.getPollingConfig().pollIntervalSecs * 1000;
    this.currentIntervalMs = ms;
    this.pollHandle = setInterval(() => void this.timerCallback(), ms);
    return { running: !!this.pollHandle };
  }

  getState(): PollerMetrics {
    return { ...this.metrics };
  }
}
