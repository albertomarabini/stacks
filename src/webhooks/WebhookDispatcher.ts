// src/webhooks/WebhookDispatcher.ts
import axios from 'axios';
import type { Request, Response, NextFunction } from 'express';
import type { ISqliteStore } from '/src/contracts/dao';
import type { IWebhookRetryScheduler } from '/src/contracts/interfaces';
import { WebhookSignatureService } from '/src/delegates/WebhookSignatureService';
import { WebhookAttemptPlanner } from '/src/delegates/WebhookAttemptPlanner';
import type { WebhookLogRow, WebhookEventType } from '/src/contracts/domain';

type DispatchCtx = {
  storeId: string;
  invoiceId?: string;
  subscriptionId?: string;
  eventType: WebhookEventType;
  rawBody: string;
  attempts?: number;
};

type SuccessCtx = { attemptLogId: string; status: number };

type FailureCtx = {
  attemptLogId: string;
  attempts: number;
  storeId: string;
  invoiceId?: string;
  subscriptionId?: string;
  eventType: WebhookEventType;
  rawBody: string;
};

export class WebhookDispatcher {
  private store!: ISqliteStore;
  private scheduler!: IWebhookRetryScheduler;
  private readonly sigSvc = new WebhookSignatureService();
  private readonly attempts = new WebhookAttemptPlanner();
  private inflight: Set<string> = new Set();

  bindStoreAndScheduler(store: ISqliteStore, scheduler: IWebhookRetryScheduler): void {
    this.store = store;
    this.scheduler = scheduler;
  }

  initCaches(): void {
    this.inflight = new Set<string>();
  }

  verifyWebhookSignature(req: Request, res: Response, next: NextFunction): void {
    const tsHeader = req.header('X-Webhook-Timestamp') || req.header('x-webhook-timestamp');
    const sigHeader = req.header('X-Webhook-Signature') || req.header('x-webhook-signature');
    const rawBody =
      typeof req.body === 'string'
        ? req.body
        : Buffer.isBuffer(req.body)
        ? req.body.toString('utf8')
        : '';
    const secret: string = (this.store as any).getStoreHmacSecretForInbound(req);
    const now = Math.floor(Date.now() / 1000);
    const decision = this.sigSvc.verifyInbound(tsHeader, sigHeader, rawBody, secret, now);
    if (!decision.ok) {
      res.status(decision.status).end();
      return;
    }
    next();
  }

  async dispatch(ctx: DispatchCtx): Promise<void> {
    const dest = this.resolveDestinationAndSecret(ctx.storeId, ctx.invoiceId);
    if (!dest || !dest.url || !dest.secret) return;

    const attemptNumber = ctx.attempts ? ctx.attempts : 1;
    const now = Math.floor(Date.now() / 1000);

    const attemptId = this.attempts.recordInitialAttempt(this.store, {
      storeId: ctx.storeId,
      invoiceId: ctx.invoiceId,
      subscriptionId: ctx.subscriptionId,
      eventType: ctx.eventType,
      rawBody: ctx.rawBody,
      attempts: attemptNumber,
      now,
    });

    const { headers } = this.sigSvc.buildOutboundHeaders(dest.secret, ctx.rawBody, now);

    try {
      const resp = await axios.post(dest.url, ctx.rawBody, { headers, timeout: 10000 });
      if (resp.status >= 200 && resp.status < 300) {
        this.onHttpSuccess({ attemptLogId: attemptId, status: resp.status });
      } else {
        await this.onHttpFailure(
          {
            attemptLogId: attemptId,
            attempts: attemptNumber,
            storeId: ctx.storeId,
            invoiceId: ctx.invoiceId,
            subscriptionId: ctx.subscriptionId,
            eventType: ctx.eventType,
            rawBody: ctx.rawBody,
          },
          resp.status,
        );
      }
    } catch (err: any) {
      const status = err?.response?.status as number | undefined;
      await this.onHttpFailure(
        {
          attemptLogId: attemptId,
          attempts: attemptNumber,
          storeId: ctx.storeId,
          invoiceId: ctx.invoiceId,
          subscriptionId: ctx.subscriptionId,
          eventType: ctx.eventType,
          rawBody: ctx.rawBody,
        },
        status,
      );
    }
  }

  onHttpSuccess(ctx: SuccessCtx): void {
    this.attempts.markSuccess(this.store, ctx.attemptLogId, ctx.status);
  }

  async onHttpFailure(ctx: FailureCtx, statusOrNull?: number): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.attempts.handleFailureAndPlanNext(
      this.store,
      {
        attemptLogId: ctx.attemptLogId,
        attempts: ctx.attempts,
        storeId: ctx.storeId,
        invoiceId: ctx.invoiceId,
        subscriptionId: ctx.subscriptionId,
        eventType: ctx.eventType,
        rawBody: ctx.rawBody,
        now,
      },
      statusOrNull,
    );

    this.scheduler.enqueueRetry({
      storeId: ctx.storeId,
      invoiceId: ctx.invoiceId,
      subscriptionId: ctx.subscriptionId,
      eventType: ctx.eventType,
      rawBody: ctx.rawBody,
      attempts: ctx.attempts,
    });
  }

  async planRetry(ctx: {
    storeId: string;
    invoiceId?: string;
    subscriptionId?: string;
    eventType: WebhookEventType;
    rawBody: string;
    attempts: number;
  }): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.attempts.planNextAttempt(this.store, { ...ctx, now });
  }

  async enqueueRetryIfNotInflight(row: WebhookLogRow): Promise<boolean> {
    const entity = row.invoice_id ?? row.subscription_id ?? 'none';
    const key = `${row.store_id}:${entity}:${row.event_type}`;
    if (this.inflight.has(key)) return false;
    this.inflight.add(key);
    try {
      await this.dispatch({
        storeId: row.store_id,
        invoiceId: row.invoice_id ?? undefined,
        subscriptionId: row.subscription_id ?? undefined,
        eventType: row.event_type,
        rawBody: row.payload,
        attempts: (row.attempts ?? 0) + 1,
      });
    } finally {
      this.inflight.delete(key);
    }
    return true;
  }

  private resolveDestinationAndSecret(
    storeId: string,
    invoiceId?: string,
  ): { url: string; secret: string } | undefined {
    if (invoiceId) {
      const row = this.store.getInvoiceWithStore(invoiceId);
      if (!row) return undefined;
      const url = row.webhook_url ?? row.store.webhook_url ?? '';
      if (!url) return undefined;
      const secret = row.store.hmac_secret;
      return { url, secret };
    }
    const merchant: {
      webhook_url?: string | null;
      hmac_secret: string;
    } = (this.store as any).getMerchantById(storeId);
    if (!merchant || !merchant.webhook_url) return undefined;
    return { url: String(merchant.webhook_url), secret: merchant.hmac_secret };
  }
}
