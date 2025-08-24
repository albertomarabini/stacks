// src/webhooks/WebhookRetryScheduler.ts
import type { ISqliteStore } from '/src/contracts/dao';
import type { IWebhookDispatcher, IWebhookRetryScheduler } from '/src/contracts/interfaces';
import type { WebhookLogRow, WebhookEventType } from '/src/contracts/domain';

type EnqueueCtx = {
  storeId: string;
  invoiceId?: string;
  subscriptionId?: string;
  eventType: WebhookEventType;
  rawBody: string;
  attempts: number;
};

export class WebhookRetryScheduler implements IWebhookRetryScheduler {
  private store!: ISqliteStore;
  private dispatcher!: IWebhookDispatcher;
  private timerId: NodeJS.Timeout | undefined;
  private readonly intervalMs = 30000;
  private readonly inflight = new Set<string>();

  bindDependencies(store: ISqliteStore, dispatcher: IWebhookDispatcher): void {
    this.store = store;
    this.dispatcher = dispatcher;
  }

  async bootstrap(): Promise<void> {
    if (this.timerId !== undefined) return;

    const _now = Math.floor(Date.now() / 1000);
    const rows: WebhookLogRow[] = this.store.selectDueWebhookRetries();
    const seen = new Set<string>();
    for (const r of rows) {
      const entity = r.invoice_id ?? r.subscription_id ?? 'none';
      const key = `${r.store_id}:${entity}:${r.event_type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      this.enqueueRetry({
        storeId: r.store_id,
        invoiceId: r.invoice_id ?? undefined,
        subscriptionId: r.subscription_id ?? undefined,
        eventType: r.event_type,
        rawBody: r.payload,
        attempts: r.attempts,
      });
    }

    this.timerId = setInterval(() => this.onWake(), this.intervalMs);
  }

  onWake(): void {
    const now = Math.floor(Date.now() / 1000);
    void this.processDueRetries(now);
  }

  async processDueRetries(nowEpochSecs: number): Promise<void> {
    const rows: WebhookLogRow[] = this.store.getDueWebhookAttempts(nowEpochSecs);
    for (const r of rows) {
      await this.dispatcher.dispatch({
        storeId: r.store_id,
        invoiceId: r.invoice_id ?? undefined,
        subscriptionId: r.subscription_id ?? undefined,
        eventType: r.event_type,
        rawBody: r.payload,
        attempts: r.attempts,
      });
    }
  }

  enqueueRetry(ctx: EnqueueCtx): void {
    const id = ctx.invoiceId ?? ctx.subscriptionId ?? 'none';
    const key = `${ctx.storeId}:${id}:${ctx.eventType}`;
    if (this.inflight.has(key)) return;
    this.inflight.add(key);

    const backoff = [60, 120, 240, 480, 960];
    const idx = Math.min(Math.max(ctx.attempts, 1), backoff.length) - 1;
    const delayMs = backoff[idx] * 1000;

    setTimeout(async () => {
      try {
        await this.dispatcher.dispatch({
          storeId: ctx.storeId,
          invoiceId: ctx.invoiceId,
          subscriptionId: ctx.subscriptionId,
          eventType: ctx.eventType,
          rawBody: ctx.rawBody,
          attempts: ctx.attempts,
        });
      } finally {
        this.inflight.delete(key);
      }
    }, delayMs);
  }
}
