// src/delegates/WebhookRetryQueryComposer.ts
import type { WebhookEventType } from '../contracts/domain';

export type ComposedQuery = { sql: string; params: any[] };

export interface WebhookRetryQueryComposerOptions {
  maxAttempts: number;
  backoffSeconds: number[];
}

export class WebhookRetryQueryComposer {
  private readonly maxAttempts: number;
  private readonly backoffSeconds: number[];

  constructor(opts: WebhookRetryQueryComposerOptions) {
    if (!opts || !Array.isArray(opts.backoffSeconds) || opts.backoffSeconds.length === 0) {
      throw new Error('backoffSeconds must be a non-empty array');
    }
    if (typeof opts.maxAttempts !== 'number' || opts.maxAttempts <= 0) {
      throw new Error('maxAttempts must be a positive number');
    }
    this.maxAttempts = opts.maxAttempts;
    this.backoffSeconds = opts.backoffSeconds;
  }

  composeSelectDueRetriesSQL(): ComposedQuery {
    const backoffCase = this.buildCaseExpr('w.attempts');
    const sql = `
      SELECT *
      FROM webhook_logs w
      WHERE w.success = 0
        AND w.attempts < ${this.maxAttempts}
        AND (
          (strftime('%s','now') - w.last_attempt_at) >= ${backoffCase}
        )
        AND w.last_attempt_at = (
          SELECT MAX(w2.last_attempt_at)
          FROM webhook_logs w2
          WHERE w2.store_id = w.store_id
            AND COALESCE(w2.invoice_id, '') = COALESCE(w.invoice_id, '')
            AND COALESCE(w2.subscription_id, '') = COALESCE(w.subscription_id, '')
            AND w2.event_type = w.event_type
        )
      ORDER BY w.last_attempt_at ASC
    `;
    return { sql, params: [] };
  }

  composeGetDueAttemptsSQL(nowEpochSecs: number): ComposedQuery {
    const backoffCase = this.buildCaseExpr('attempts');
    const sql = `
      SELECT *
      FROM webhook_logs
      WHERE success = 0
        AND attempts < ${this.maxAttempts}
        AND (? - last_attempt_at) >= ${backoffCase}
      ORDER BY last_attempt_at ASC
    `;
    return { sql, params: [nowEpochSecs] };
  }

  composeExistsSuccessfulDeliverySQL(ctx: {
    storeId: string;
    invoiceId?: string;
    subscriptionId?: string;
    eventType: WebhookEventType;
  }): ComposedQuery {
    const sql = `
      SELECT 1
      FROM webhook_logs
      WHERE store_id = ?
        AND event_type = ?
        AND (invoice_id IS ? OR invoice_id = ?)
        AND (subscription_id IS ? OR subscription_id = ?)
        AND success = 1
      LIMIT 1
    `;
    const params = [
      ctx.storeId,
      ctx.eventType,
      ctx.invoiceId ?? null,
      ctx.invoiceId ?? null,
      ctx.subscriptionId ?? null,
      ctx.subscriptionId ?? null,
    ];
    return { sql, params };
  }

  composeHasSuccessfulExpiredWebhookSQL(storeId: string, invoiceId: string): ComposedQuery {
    const sql = `
      SELECT 1
      FROM webhook_logs
      WHERE store_id = ?
        AND invoice_id = ?
        AND event_type = 'invoice-expired'
        AND success = 1
      LIMIT 1
    `;
    return { sql, params: [storeId, invoiceId] };
  }

  private buildCaseExpr(attemptsColumn: string): string {
    const whens = this.backoffSeconds.map((sec, idx) => `WHEN ${idx} THEN ${sec}`).join(' ');
    const last = this.backoffSeconds[this.backoffSeconds.length - 1];
    return `CASE ${attemptsColumn} ${whens} ELSE ${last} END`;
  }
}
