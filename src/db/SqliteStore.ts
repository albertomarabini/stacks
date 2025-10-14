// src/db/SqliteStore.ts
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

import type { ISqliteStore } from '../contracts/dao';
import type {
  MerchantRow,
  InvoiceRow,
  SubscriptionRow,
  WebhookLogRow,
  InvoiceStatus,
  WebhookEventType,
  SubscriptionMode,
} from '../contracts/domain';
import { WebhookRetryQueryComposer } from '../delegates/WebhookRetryQueryComposer';
import { MerchantProjectionPolicy } from '../delegates/MerchantProjectionPolicy';
import { SqlInListBuilder } from '../delegates/SqlInListBuilder';
import type { IInvoiceIdCodec } from '../contracts/interfaces';

const nowSec = () => Math.floor(Date.now() / 1000);

export class SqliteStore implements ISqliteStore {
  private readonly db: Database.Database;
  private readonly webhookRetryComposer = new WebhookRetryQueryComposer({
    maxAttempts: 5,
    backoffSeconds: [0, 60, 120, 240, 480, 960],
  });
  private readonly merchantProjection = new MerchantProjectionPolicy();
  private readonly inListBuilder = new SqlInListBuilder();
  // Optional codec, kept for integrators; local guards are used otherwise.
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  private readonly codec?: IInvoiceIdCodec;

  constructor(db: Database.Database, codec?: IInvoiceIdCodec) {
    this.db = db;
    this.codec = codec;
  }

  migrate(): void {
    const migrationsPath = path.join(process.cwd(), 'db', 'migrations.sql');
    const sql = fs.readFileSync(migrationsPath, 'utf8');
    this.db.exec(sql);
  }

  // Merchants

  findActiveByApiKey(apiKey: string): MerchantRow | undefined {
    const stmt = this.db.prepare(
      `SELECT * FROM merchants WHERE stx_private_key = ? AND active = 1 LIMIT 1`,
    );
    const row = stmt.get(apiKey) as MerchantRow | undefined;
    return row;
  }

  insertMerchant(row: MerchantRow): void {
    const stmt = this.db.prepare(`
      INSERT INTO merchants (
        id, principal, name, display_name, logo_url, brand_color,
        webhook_url, hmac_secret, stx_private_key, active, support_email,
        support_url, allowed_origins, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      row.id,
      row.principal,
      row.name ?? null,
      row.display_name ?? null,
      row.logo_url ?? null,
      row.brand_color ?? null,
      row.webhook_url ?? null,
      row.hmac_secret,
      row.stx_private_key,
      row.active,
      row.support_email ?? null,
      row.support_url ?? null,
      row.allowed_origins ?? null,
      row.created_at,
    );
  }

  updateMerchantActive(storeId: string, active: boolean): number {
    const stmt = this.db.prepare(`UPDATE merchants SET active = ? WHERE id = ?`);
    const info = stmt.run(active ? 1 : 0, storeId);
    return info.changes;
  }

  updateStxPrivateKey(storeId: string, key: string): void {
      this.db
        .prepare(`UPDATE merchants SET stx_private_key = ? WHERE id = ?`)
        .run(key, storeId);
    }

  listMerchantsProjection(): Omit<MerchantRow, 'stx_private_key' | 'hmac_secret'>[] {
    const sql = this.merchantProjection.getListProjectionSQL();
    const dbRows = this.db.prepare(sql).all() as any[];
    return dbRows.map((r) => this.merchantProjection.mapListRow(r));
  }
  getMerchantById(storeId: string): MerchantRow | undefined {
    return this.db.prepare(`SELECT * FROM merchants WHERE id = ?`).get(storeId) as MerchantRow | undefined;
  }

  public updateMerchantProfile(
    storeId: string,
    patch: Partial<Pick<
      MerchantRow,
      | 'name'
      | 'display_name'
      | 'logo_url'
      | 'brand_color'
      | 'webhook_url'
      | 'support_email'
      | 'support_url'
      | 'allowed_origins'
      | 'principal'
    >>
  ): void {
    const allowed = [
      'name',
      'display_name',
      'logo_url',
      'brand_color',
      'webhook_url',
      'support_email',
      'support_url',
      'allowed_origins',
      'principal'
    ] as const;

    const keys = allowed.filter(k => (patch as any)[k] !== undefined);
    if (keys.length === 0) return; // nothing to update

    const setSql = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => (patch as any)[k]);

    this.db.prepare(
      `UPDATE merchants SET ${setSql} WHERE id = ?`
    ).run(...values, storeId);
  }

  // 1) Rotate + bump version, clear revealed flag (atomic)
  rotateKeysPersist(storeId: string, apiKey: string, hmacSecret: string, now = nowSec()): number {
    const update = this.db.prepare(`
      UPDATE merchants
         SET stx_private_key = ?,
             hmac_secret = ?,
             keys_rotation_version = keys_rotation_version + 1,
             keys_last_rotated_at = ?,
             keys_last_revealed_at = NULL,
             keys_dual_valid_until = NULL
       WHERE id = ?
    `);
    const fetchV = this.db.prepare(`SELECT keys_rotation_version AS v FROM merchants WHERE id = ?`);

    const tx = this.db.transaction((id: string) => {
      update.run(apiKey, hmacSecret, now, id);
      return fetchV.get(id) as { v: number } | undefined;
    });

    const row = tx(storeId);
    return row?.v ?? 0;
  }

  // 2) Exactly-once reveal for that version
  markKeysRevealedOnce(storeId: string, expectVersion: number, now = nowSec()): boolean {
    const stmt = this.db.prepare(`
      UPDATE merchants
         SET keys_last_revealed_at = ?
       WHERE id = ?
         AND keys_rotation_version = ?
         AND keys_last_revealed_at IS NULL
    `);
    const info = stmt.run(now, storeId, expectVersion);
    return info.changes === 1;
  }

  // Invoices

  public readonly invoices = {
    insert: (row: InvoiceRow): void => {
      SqliteStore.assertHex64(row.id_hex);
      if (!Number.isInteger(row.amount_sats) || row.amount_sats <= 0) {
        throw new TypeError('amount_sats must be positive int');
      }
      if (row.status !== 'unpaid') {
        throw new TypeError("status must be 'unpaid' on insert");
      }
      if (typeof row.merchant_principal !== 'string' || row.merchant_principal.length === 0) {
        throw new TypeError('merchant_principal required');
      }
      if (!Number.isInteger(row.quote_expires_at)) {
        throw new TypeError('quote_expires_at must be integer ms epoch');
      }
      if (!Number.isInteger(row.created_at)) {
        throw new TypeError('created_at must be integer epoch seconds');
      }

      const stmt = this.db.prepare(`
        INSERT INTO invoices (
          id_raw, id_hex, store_id, amount_sats, usd_at_create, quote_expires_at,
          merchant_principal, status, memo, webhook_url, created_at, subscription_id,
          refunded_at, refund_amount, refund_txid, refund_count, payer, txid, expired
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, NULL, 0, NULL, NULL, 0)
      `);
      stmt.run(
        row.id_raw,
        row.id_hex,
        row.store_id,
        row.amount_sats,
        row.usd_at_create,
        row.quote_expires_at,
        row.merchant_principal,
        'unpaid',
        row.memo ?? null,
        row.webhook_url ?? null,
        row.created_at,
        row.subscription_id ?? null,
      );
    },

    markCanceled: (storeId: string, idRaw: string): number => {
      const stmt = this.db.prepare(`
        UPDATE invoices
        SET status = 'canceled'
        WHERE store_id = ? AND id_raw = ? AND status = 'unpaid' AND IFNULL(expired, 0) = 0
      `);
      const info = stmt.run(storeId, idRaw);
      return info.changes ?? 0;
    },

    findByStoreAndIdRaw: (storeId: string, idRaw: string): InvoiceRow | undefined => {
      const stmt = this.db.prepare(
        `SELECT * FROM invoices WHERE store_id = ? AND id_raw = ? LIMIT 1`,
      );
      const row = stmt.get(storeId, idRaw) as InvoiceRow | undefined;
      return row;
    },
  };

  getInvoiceById(idRaw: string): InvoiceRow | undefined {
    const stmt = this.db.prepare(`SELECT * FROM invoices WHERE id_raw = ? LIMIT 1`);
    const row = stmt.get(idRaw) as InvoiceRow | undefined;
    return row;
  }

  getInvoiceWithStore(idRaw: string): (InvoiceRow & { store: MerchantRow }) | undefined {
    const inv = this.getInvoiceById(idRaw);
    if (!inv) return undefined;
    const m = this.db
      .prepare(`SELECT * FROM merchants WHERE id = ? LIMIT 1`)
      .get(inv.store_id) as MerchantRow | undefined;
    if (!m) return undefined;
    return Object.assign({}, inv, { store: m });
  }

  listInvoicesByStore(
    storeId: string,
    opts?: { status?: InvoiceStatus; orderByCreatedDesc?: boolean },
  ): InvoiceRow[] {
    if (opts?.status) {
      const stmt = this.db.prepare(
        `SELECT * FROM invoices WHERE store_id = ? AND status = ? ORDER BY created_at ${opts.orderByCreatedDesc ? 'DESC' : 'ASC'
        }`,
      );
      return stmt.all(storeId, opts.status) as InvoiceRow[];
    }
    const stmt = this.db.prepare(
      `SELECT * FROM invoices WHERE store_id = ? ORDER BY created_at ${opts?.orderByCreatedDesc ? 'DESC' : 'ASC'
      }`,
    );
    return stmt.all(storeId) as InvoiceRow[];
  }

  markInvoicePaid(idHex: string, payer: string, txId: string, _tx?: unknown): void {
    SqliteStore.assertHex64(idHex);
    this.db
      .prepare(
        `UPDATE invoices SET status = 'paid', payer = ?, txid = ? WHERE id_hex = ?`,
      )
      .run(payer, txId, idHex);
  }

  upsertInvoiceRefund(idHex: string, amountSats: number, refundTxId: string, _tx?: unknown): void {
    SqliteStore.assertHex64(idHex);
    if (!Number.isInteger(amountSats) || amountSats <= 0) {
      throw new TypeError('amountSats must be positive int');
    }
    const tx = this.db.transaction((hex: string, inc: number, rtx: string) => {
      const current = this.db
        .prepare(
          `SELECT amount_sats, refund_amount FROM invoices WHERE id_hex = ? LIMIT 1`,
        )
        .get(hex) as { amount_sats: number; refund_amount: number } | undefined;
      if (!current) return;
      const newTotal = (current.refund_amount ?? 0) + inc;
      const now = Math.floor(Date.now() / 1000);
      const newStatus: InvoiceStatus =
        newTotal >= current.amount_sats ? 'refunded' : 'partially_refunded';
      this.db
        .prepare(
          `UPDATE invoices
             SET refund_amount = ?, refund_txid = ?, refunded_at = ?, refund_count = refund_count + 1, status = ?
           WHERE id_hex = ?`,
        )
        .run(newTotal, rtx, now, newStatus, hex);
    });
    tx(idHex, amountSats, refundTxId);
  }

  markInvoiceCanceled(idHexOrIdRaw: string, _tx?: unknown): void {
    const info = this.db
      .prepare(`UPDATE invoices SET status = 'canceled' WHERE id_hex = ?`)
      .run(idHexOrIdRaw);
    if (info.changes === 0) {
      this.db
        .prepare(`UPDATE invoices SET status = 'canceled' WHERE id_raw = ?`)
        .run(idHexOrIdRaw);
    }
  }

  updateInvoiceStatus(idRaw: string, status: InvoiceStatus, expired?: 0 | 1): void {
    if (expired === undefined) {
      this.db
        .prepare(`UPDATE invoices SET status = ? WHERE id_raw = ?`)
        .run(status, idRaw);
      return;
    }
    this.db
      .prepare(`UPDATE invoices SET status = ?, expired = ? WHERE id_raw = ?`)
      .run(status, expired, idRaw);
  }

  ensureInvoiceIdHexUnique(idHex: string): boolean {
    SqliteStore.assertHex64(idHex);
    const row = this.db
      .prepare(`SELECT 1 AS one FROM invoices WHERE id_hex = ? LIMIT 1`)
      .get(idHex) as { one: number } | undefined;
    return !row;
  }

  invoiceExists(idHex: string): boolean {
    SqliteStore.assertHex64(idHex);
    const row = this.db
      .prepare(`SELECT 1 AS one FROM invoices WHERE id_hex = ? LIMIT 1`)
      .get(idHex) as { one: number } | undefined;
    return !!row;
  }

  bulkMarkExpired(idRawList: string[]): number {
    if (!idRawList.length) return 0;
    const { clause, params } = this.inListBuilder.buildInClause('id_raw', idRawList);
    const stmt = this.db.prepare(
      `UPDATE invoices SET status = 'expired', expired = 1 WHERE ${clause}`,
    );
    const info = stmt.run(...params);
    return info.changes;
  }

  // Subscriptions

  insertSubscription(row: SubscriptionRow): void {
    const stmt = this.db.prepare(`
      INSERT INTO subscriptions (
        id, id_hex, store_id, merchant_principal, subscriber,
        amount_sats, interval_blocks, active, created_at,
        last_billed_at, next_invoice_at, last_paid_invoice_id, mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      row.id,
      row.id_hex,
      row.store_id,
      row.merchant_principal,
      row.subscriber,
      row.amount_sats,
      row.interval_blocks,
      row.active,
      row.created_at,
      row.last_billed_at ?? null,
      row.next_invoice_at,
      row.last_paid_invoice_id ?? null,
      row.mode,
    );
  }

  getSubscriptionByIdForStore(id: string, storeId: string): SubscriptionRow | undefined {
    const stmt = this.db.prepare(
      `SELECT * FROM subscriptions WHERE id = ? AND store_id = ? LIMIT 1`,
    );
    const row = stmt.get(id, storeId) as SubscriptionRow | undefined;
    return row;
  }

  getActiveSubscription(id: string, storeId: string): SubscriptionRow | undefined {
    const stmt = this.db.prepare(
      `SELECT * FROM subscriptions WHERE id = ? AND store_id = ? AND active = 1 LIMIT 1`,
    );
    const row = stmt.get(id, storeId) as SubscriptionRow | undefined;
    return row;
  }

  getActiveSubscriptions(id: string, storeId: string): SubscriptionRow | undefined {
    const stmt = this.db.prepare(
      `SELECT * FROM subscriptions WHERE id = ? AND store_id = ? AND active = 1 LIMIT 1`,
    );
    const row = stmt.get(id, storeId) as SubscriptionRow | undefined;
    return row;
  }

  updateSubscriptionMode(id: string, storeId: string, mode: SubscriptionMode): void {
    this.db
      .prepare(`UPDATE subscriptions SET mode = ? WHERE id = ? AND store_id = ?`)
      .run(mode, id, storeId);
  }

  deactivateSubscription(id: string, storeId: string, _tx?: unknown): void {
    this.db
      .prepare(`UPDATE subscriptions SET active = 0 WHERE id = ? AND store_id = ?`)
      .run(id, storeId);
  }

  setSubscriptionActive(input: { idHex: string; active: 0 | 1 }): void {
    SqliteStore.assertHex64(input.idHex);
    this.db
      .prepare(`UPDATE subscriptions SET active = ? WHERE id_hex = ?`)
      .run(input.active, input.idHex);
  }

  upsertSubscriptionByHex(input: {
    idHex: string;
    storeId: string;
    merchantPrincipal: string;
    subscriber: string;
    amountSats: number;
    intervalBlocks: number;
    active: 1;
  }): void {
    SqliteStore.assertHex64(input.idHex);
    const existing = this.db
      .prepare(
        `SELECT id, mode FROM subscriptions WHERE id_hex = ? AND store_id = ? LIMIT 1`,
      )
      .get(input.idHex, input.storeId) as { id: string; mode: SubscriptionMode } | undefined;

    if (existing) {
      this.db
        .prepare(
          `UPDATE subscriptions
             SET merchant_principal = ?,
                 subscriber = ?,
                 amount_sats = ?,
                 interval_blocks = ?,
                 active = ?
           WHERE id_hex = ? AND store_id = ?`,
        )
        .run(
          input.merchantPrincipal,
          input.subscriber,
          input.amountSats,
          input.intervalBlocks,
          1,
          input.idHex,
          input.storeId,
        );
      return;
    }

    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `INSERT INTO subscriptions (
           id, id_hex, store_id, merchant_principal, subscriber,
           amount_sats, interval_blocks, active, created_at, last_billed_at,
           next_invoice_at, last_paid_invoice_id, mode
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)`,
      )
      .run(
        input.idHex,
        input.idHex,
        input.storeId,
        input.merchantPrincipal,
        input.subscriber,
        input.amountSats,
        input.intervalBlocks,
        1,
        now,
        0,
        'invoice',
      );
  }

  advanceSubscriptionSchedule(id: string): void {
    const now = Math.floor(Date.now() / 1000);
    this.db
      .prepare(
        `UPDATE subscriptions
           SET next_invoice_at = next_invoice_at + interval_blocks,
               last_billed_at = ?
         WHERE id = ?`,
      )
      .run(now, id);
  }

  updateSubscriptionLastPaid(input: { subscriptionId: string; lastPaidInvoiceId: string }): void {
    this.db
      .prepare(`UPDATE subscriptions SET last_paid_invoice_id = ? WHERE id_hex = ?`)
      .run(input.lastPaidInvoiceId, input.subscriptionId);
  }

  subscriptionExists(idHex: string): boolean {
    SqliteStore.assertHex64(idHex);
    const row = this.db
      .prepare(`SELECT 1 AS one FROM subscriptions WHERE id_hex = ? LIMIT 1`)
      .get(idHex) as { one: number } | undefined;
    return !!row;
  }

  selectDueSubscriptions(currentHeight: number): SubscriptionRow[] {
    const stmt = this.db.prepare(
      `SELECT * FROM subscriptions
         WHERE active = 1
           AND mode = 'invoice'
           AND next_invoice_at <= ?
       ORDER BY next_invoice_at ASC`,
    );
    return stmt.all(currentHeight) as SubscriptionRow[];
  }

  getStoreIdByPrincipal(merchantPrincipal: string): string | undefined {
    const row = this.db
      .prepare(`SELECT id FROM merchants WHERE principal = ? LIMIT 1`)
      .get(merchantPrincipal) as { id: string } | undefined;
    return row?.id;
  }


  selectInvoicesByStatuses(
    statuses: InvoiceStatus[],
    limit: number,
    storeId?: string
  ): Pick<InvoiceRow, 'id_hex' | 'status' | 'refund_amount' | 'merchant_principal'>[] {
    if (typeof statuses === "string")
      statuses =[statuses]
    if (!Array.isArray(statuses) || statuses.length === 0) return [];

    const cols = `id_hex, status, refund_amount, merchant_principal`;
    const wheres: string[] = [];
    const params: any[] = [];

    if (storeId) {
      wheres.push(`store_id = ?`);
      params.push(storeId);
    }
    const placeholders = statuses.map(() => '?').join(',');
    wheres.push(`status IN (${placeholders})`);
    params.push(...statuses);

    const whereSql = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';
    const sql = `
    SELECT ${cols}
      FROM invoices
      ${whereSql}
     ORDER BY created_at DESC
     LIMIT ?
  `;
    params.push(limit);

    return this.db.prepare(sql).all(...params) as any[];
  }

  getInvoiceStatusByHex(idHex: string): InvoiceStatus | undefined {
    SqliteStore.assertHex64(idHex);
    const row = this.db
      .prepare(`SELECT status FROM invoices WHERE id_hex = ? LIMIT 1`)
      .get(idHex) as { status: InvoiceStatus } | undefined;
    return row?.status;
  }

  // Webhooks

  insertWebhookAttempt(row: WebhookLogRow): string {
    const stmt = this.db.prepare(`
      INSERT INTO webhook_logs (
        id, store_id, invoice_id, subscription_id, event_type,
        payload, status_code, success, attempts, last_attempt_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      row.id,
      row.store_id,
      row.invoice_id ?? null,
      row.subscription_id ?? null,
      row.event_type,
      row.payload,
      row.status_code ?? null,
      row.success,
      row.attempts,
      row.last_attempt_at,
    );
    return row.id;
  }

  updateWebhookAttemptStatus(id: string, patch: { success: 0 | 1; statusCode?: number }): void {
    if (patch.statusCode === undefined) {
      this.db
        .prepare(`UPDATE webhook_logs SET success = ? WHERE id = ?`)
        .run(patch.success, id);
      return;
    }
    this.db
      .prepare(`UPDATE webhook_logs SET success = ?, status_code = ? WHERE id = ?`)
      .run(patch.success, patch.statusCode, id);
  }

  listWebhooksForStore(storeId: string): WebhookLogRow[] {
    const stmt = this.db.prepare(
      `SELECT * FROM webhook_logs WHERE store_id = ? ORDER BY last_attempt_at DESC`,
    );
    return stmt.all(storeId) as WebhookLogRow[];
  }

  listAdminWebhooks(storeId?: string, failedOnly?: boolean): WebhookLogRow[] {
    const parts: string[] = [`SELECT * FROM webhook_logs`];
    const wheres: string[] = [];
    const params: any[] = [];
    if (storeId) {
      wheres.push(`store_id = ?`);
      params.push(storeId);
    }
    if (failedOnly) {
      wheres.push(`success = 0`);
    }
    if (wheres.length) {
      parts.push(`WHERE ${wheres.join(' AND ')}`);
    }
    parts.push(`ORDER BY last_attempt_at DESC`);
    const sql = parts.join(' ');
    return this.db.prepare(sql).all(...params) as WebhookLogRow[];
  }

  getWebhookLogById(id: string): WebhookLogRow | undefined {
    const stmt = this.db.prepare(`SELECT * FROM webhook_logs WHERE id = ? LIMIT 1`);
    const row = stmt.get(id) as WebhookLogRow | undefined;
    return row;
  }

  existsSuccessfulDeliveryFor(ctx: {
    storeId: string;
    invoiceId?: string;
    subscriptionId?: string;
    eventType: WebhookEventType;
  }): boolean {
    const { sql, params } = this.webhookRetryComposer.composeExistsSuccessfulDeliverySQL({
      storeId: ctx.storeId,
      invoiceId: ctx.invoiceId,
      subscriptionId: ctx.subscriptionId,
      eventType: ctx.eventType as WebhookEventType,
    });
    const row = this.db.prepare(sql).get(...params) as { 1: number } | undefined;
    return !!row;
  }

  selectDueWebhookRetries(): WebhookLogRow[] {
    const { sql } = this.webhookRetryComposer.composeSelectDueRetriesSQL();
    const rows = this.db.prepare(sql).all() as WebhookLogRow[];
    return rows;
  }

  getDueWebhookAttempts(nowEpochSecs: number): WebhookLogRow[] {
    const { sql, params } = this.webhookRetryComposer.composeGetDueAttemptsSQL(nowEpochSecs);
    const rows = this.db.prepare(sql).all(...params) as WebhookLogRow[];
    return rows;
  }

  hasSuccessfulExpiredWebhook(storeId: string, invoiceId: string): boolean {
    const { sql, params } = this.webhookRetryComposer.composeHasSuccessfulExpiredWebhookSQL(
      storeId,
      invoiceId,
    );
    const row = this.db.prepare(sql).get(...params) as { 1: number } | undefined;
    return !!row;
  }

  // Admin queries

  selectAdminInvoices(statuses?: InvoiceStatus[], storeId?: string): InvoiceRow[] {
    const parts: string[] = [`SELECT * FROM invoices`];
    const wheres: string[] = [];
    const params: any[] = [];
    if (storeId) {
      wheres.push(`store_id = ?`);
      params.push(storeId);
    }
    if (Array.isArray(statuses) && statuses.length > 0) {
      const placeholders = statuses.map(() => '?').join(',');
      wheres.push(`status IN (${placeholders})`);
      params.push(...statuses);
    }
    if (wheres.length) {
      parts.push(`WHERE ${wheres.join(' AND ')}`);
    }
    parts.push(`ORDER BY created_at DESC`);

    // ✅ Soft cap: only applied when env set. No signature change.
    const limit = Number(process.env.POLLER_SELECT_ADMIN_LIMIT || 0);
    if (Number.isFinite(limit) && limit > 0) {
      parts.push(`LIMIT ${limit}`);
    }

    const sql = parts.join(' ');
    return this.db.prepare(sql).all(...params) as InvoiceRow[];
  }

  // Poller cursor

  getPollerCursor():
    | { lastRunAt: number; lastHeight: number; lastTxId?: string; lastBlockHash?: string }
    | null {
    const row = this.db
      .prepare(
        `SELECT last_run_at, last_height, last_txid, last_block_hash FROM poller_cursor WHERE id = 1`,
      )
      .get() as
      | { last_run_at: number; last_height: number; last_txid: string | null; last_block_hash: string | null }
      | undefined;
    if (!row) return null;
    return {
      lastRunAt: Number(row.last_run_at),
      lastHeight: Number(row.last_height),
      lastTxId: row.last_txid ?? undefined,
      lastBlockHash: row.last_block_hash ?? undefined,
    };
  }

  savePollerCursor(cursor: {
    lastRunAt: number;
    lastHeight: number;
    lastTxId?: string;
    lastBlockHash?: string;
  }): void {
    if (!Number.isInteger(cursor.lastRunAt) || cursor.lastRunAt <= 0) {
      throw new TypeError('lastRunAt must be positive integer');
    }
    if (!Number.isInteger(cursor.lastHeight) || cursor.lastHeight < 0) {
      throw new TypeError('lastHeight must be non-negative integer');
    }
    const stmt = this.db.prepare(`
      INSERT INTO poller_cursor (id, last_run_at, last_height, last_txid, last_block_hash)
      VALUES (1, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        last_run_at = excluded.last_run_at,
        last_height = excluded.last_height,
        last_txid = excluded.last_txid,
        last_block_hash = excluded.last_block_hash
    `);
    stmt.run(
      cursor.lastRunAt,
      cursor.lastHeight,
      cursor.lastTxId ?? null,
      cursor.lastBlockHash ?? null,
    );
  }

  // Utilities

  private static assertHex64(idHex: string): void {
    if (typeof idHex !== 'string' || idHex.length !== 64) {
      throw new Error('idHex must be a 64-character hex string');
    }
    if (!/^[0-9A-Fa-f]{64}$/.test(idHex)) {
      throw new Error('idHex must contain only hex characters');
    }
    const buf = Buffer.from(idHex, 'hex');
    if (buf.length !== 32) {
      throw new Error('idHex must decode to 32 bytes');
    }
    const roundTrip = Buffer.from(buf).toString('hex');
    if (roundTrip.length !== 64) {
      throw new Error('idHex round-trip failed');
    }
  }
}

export function openDatabaseAndMigrate(dbPath: string): ISqliteStore {
  if (process.env.GLOBAL_DEBUGGING === "1") {
    try {
      fs.rmSync(dbPath, { force: true });
      fs.rmSync(`${dbPath}-wal`, { force: true });
      fs.rmSync(`${dbPath}-shm`, { force: true });
    } catch { /* ignore */ }
  }

  const db = new Database(dbPath);
  const store = new SqliteStore(db);
  store.migrate();
  return store;
}
