// src/delegates/WebhookAttemptPlanner.ts
import crypto from 'crypto';
import type { ISqliteStore } from '../contracts/dao';
import type { WebhookLogRow } from '../contracts/domain';

type RecordCtx = {
  storeId: string;
  invoiceId?: string;
  subscriptionId?: string;
  eventType: string;
  rawBody: string;
  attempts: number;
  now: number; // epoch seconds
};

type FailureCtx = {
  attemptLogId: string;
  attempts: number;
  storeId: string;
  invoiceId?: string;
  subscriptionId?: string;
  eventType: string;
  rawBody: string;
  now: number; // epoch seconds
};

type PlanCtx = {
  storeId: string;
  invoiceId?: string;
  subscriptionId?: string;
  eventType: string;
  rawBody: string;
  attempts: number;
  now: number; // epoch seconds
};

const MAX_ATTEMPTS = 5;

export class WebhookAttemptPlanner {
  recordInitialAttempt(store: ISqliteStore, ctx: RecordCtx): string {
    const id = crypto.randomUUID();
    const row: WebhookLogRow = {
      id,
      store_id: ctx.storeId,
      invoice_id: ctx.invoiceId,
      subscription_id: ctx.subscriptionId,
      event_type: ctx.eventType as any,
      payload: ctx.rawBody,
      status_code: undefined,
      success: 0,
      attempts: ctx.attempts,
      last_attempt_at: ctx.now,
    };
    store.insertWebhookAttempt(row);
    return id;
  }

  markSuccess(store: ISqliteStore, attemptLogId: string, status: number): void {
    store.updateWebhookAttemptStatus(attemptLogId, { success: 1, statusCode: status });
  }

  async handleFailureAndPlanNext(
    store: ISqliteStore,
    ctx: FailureCtx,
    statusOrNull?: number,
  ): Promise<void> {
    store.updateWebhookAttemptStatus(ctx.attemptLogId, {
      success: 0,
      statusCode: typeof statusOrNull === 'number' ? statusOrNull : undefined,
    });
    if (ctx.attempts >= MAX_ATTEMPTS) return;
    await this.planNextAttempt(store, {
      storeId: ctx.storeId,
      invoiceId: ctx.invoiceId,
      subscriptionId: ctx.subscriptionId,
      eventType: ctx.eventType,
      rawBody: ctx.rawBody,
      attempts: ctx.attempts,
      now: ctx.now,
    });
  }

  async planNextAttempt(store: ISqliteStore, ctx: PlanCtx): Promise<void> {
    const nextAttempt = ctx.attempts + 1;
    if (nextAttempt > MAX_ATTEMPTS) return;
    const id = crypto.randomUUID();
    const row: WebhookLogRow = {
      id,
      store_id: ctx.storeId,
      invoice_id: ctx.invoiceId,
      subscription_id: ctx.subscriptionId,
      event_type: ctx.eventType as any,
      payload: ctx.rawBody,
      status_code: undefined,
      success: 0,
      attempts: nextAttempt,
      last_attempt_at: ctx.now,
    };
    store.insertWebhookAttempt(row);
  }
}

export default WebhookAttemptPlanner;
