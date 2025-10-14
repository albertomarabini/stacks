"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SqliteStore = void 0;
exports.openDatabaseAndMigrate = openDatabaseAndMigrate;
// src/db/SqliteStore.ts
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const WebhookRetryQueryComposer_1 = require("../delegates/WebhookRetryQueryComposer");
const MerchantProjectionPolicy_1 = require("../delegates/MerchantProjectionPolicy");
const SqlInListBuilder_1 = require("../delegates/SqlInListBuilder");
const nowSec = () => Math.floor(Date.now() / 1000);
class SqliteStore {
    constructor(db, codec) {
        this.webhookRetryComposer = new WebhookRetryQueryComposer_1.WebhookRetryQueryComposer({
            maxAttempts: 5,
            backoffSeconds: [0, 60, 120, 240, 480, 960],
        });
        this.merchantProjection = new MerchantProjectionPolicy_1.MerchantProjectionPolicy();
        this.inListBuilder = new SqlInListBuilder_1.SqlInListBuilder();
        // Invoices
        this.invoices = {
            insert: (row) => {
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
                stmt.run(row.id_raw, row.id_hex, row.store_id, row.amount_sats, row.usd_at_create, row.quote_expires_at, row.merchant_principal, 'unpaid', row.memo ?? null, row.webhook_url ?? null, row.created_at, row.subscription_id ?? null);
            },
            markCanceled: (storeId, idRaw) => {
                const stmt = this.db.prepare(`
        UPDATE invoices
        SET status = 'canceled'
        WHERE store_id = ? AND id_raw = ? AND status = 'unpaid' AND IFNULL(expired, 0) = 0
      `);
                const info = stmt.run(storeId, idRaw);
                return info.changes ?? 0;
            },
            findByStoreAndIdRaw: (storeId, idRaw) => {
                const stmt = this.db.prepare(`SELECT * FROM invoices WHERE store_id = ? AND id_raw = ? LIMIT 1`);
                const row = stmt.get(storeId, idRaw);
                return row;
            },
        };
        this.db = db;
        this.codec = codec;
    }
    migrate() {
        const migrationsPath = path_1.default.join(process.cwd(), 'db', 'migrations.sql');
        const sql = fs_1.default.readFileSync(migrationsPath, 'utf8');
        this.db.exec(sql);
    }
    // Merchants
    findActiveByApiKey(apiKey) {
        const stmt = this.db.prepare(`SELECT * FROM merchants WHERE stx_private_key = ? AND active = 1 LIMIT 1`);
        const row = stmt.get(apiKey);
        return row;
    }
    insertMerchant(row) {
        const stmt = this.db.prepare(`
      INSERT INTO merchants (
        id, principal, name, display_name, logo_url, brand_color,
        webhook_url, hmac_secret, stx_private_key, active, support_email,
        support_url, allowed_origins, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(row.id, row.principal, row.name ?? null, row.display_name ?? null, row.logo_url ?? null, row.brand_color ?? null, row.webhook_url ?? null, row.hmac_secret, row.stx_private_key, row.active, row.support_email ?? null, row.support_url ?? null, row.allowed_origins ?? null, row.created_at);
    }
    updateMerchantActive(storeId, active) {
        const stmt = this.db.prepare(`UPDATE merchants SET active = ? WHERE id = ?`);
        const info = stmt.run(active ? 1 : 0, storeId);
        return info.changes;
    }
    updateStxPrivateKey(storeId, key) {
        this.db
            .prepare(`UPDATE merchants SET stx_private_key = ? WHERE id = ?`)
            .run(key, storeId);
    }
    listMerchantsProjection() {
        const sql = this.merchantProjection.getListProjectionSQL();
        const dbRows = this.db.prepare(sql).all();
        return dbRows.map((r) => this.merchantProjection.mapListRow(r));
    }
    getMerchantById(storeId) {
        return this.db.prepare(`SELECT * FROM merchants WHERE id = ?`).get(storeId);
    }
    updateMerchantProfile(storeId, patch) {
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
        ];
        const keys = allowed.filter(k => patch[k] !== undefined);
        if (keys.length === 0)
            return; // nothing to update
        const setSql = keys.map(k => `${k} = ?`).join(', ');
        const values = keys.map(k => patch[k]);
        this.db.prepare(`UPDATE merchants SET ${setSql} WHERE id = ?`).run(...values, storeId);
    }
    // 1) Rotate + bump version, clear revealed flag (atomic)
    rotateKeysPersist(storeId, apiKey, hmacSecret, now = nowSec()) {
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
        const tx = this.db.transaction((id) => {
            update.run(apiKey, hmacSecret, now, id);
            return fetchV.get(id);
        });
        const row = tx(storeId);
        return row?.v ?? 0;
    }
    // 2) Exactly-once reveal for that version
    markKeysRevealedOnce(storeId, expectVersion, now = nowSec()) {
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
    getInvoiceById(idRaw) {
        const stmt = this.db.prepare(`SELECT * FROM invoices WHERE id_raw = ? LIMIT 1`);
        const row = stmt.get(idRaw);
        return row;
    }
    getInvoiceWithStore(idRaw) {
        const inv = this.getInvoiceById(idRaw);
        if (!inv)
            return undefined;
        const m = this.db
            .prepare(`SELECT * FROM merchants WHERE id = ? LIMIT 1`)
            .get(inv.store_id);
        if (!m)
            return undefined;
        return Object.assign({}, inv, { store: m });
    }
    listInvoicesByStore(storeId, opts) {
        if (opts?.status) {
            const stmt = this.db.prepare(`SELECT * FROM invoices WHERE store_id = ? AND status = ? ORDER BY created_at ${opts.orderByCreatedDesc ? 'DESC' : 'ASC'}`);
            return stmt.all(storeId, opts.status);
        }
        const stmt = this.db.prepare(`SELECT * FROM invoices WHERE store_id = ? ORDER BY created_at ${opts?.orderByCreatedDesc ? 'DESC' : 'ASC'}`);
        return stmt.all(storeId);
    }
    markInvoicePaid(idHex, payer, txId, _tx) {
        SqliteStore.assertHex64(idHex);
        this.db
            .prepare(`UPDATE invoices SET status = 'paid', payer = ?, txid = ? WHERE id_hex = ?`)
            .run(payer, txId, idHex);
    }
    upsertInvoiceRefund(idHex, amountSats, refundTxId, _tx) {
        SqliteStore.assertHex64(idHex);
        if (!Number.isInteger(amountSats) || amountSats <= 0) {
            throw new TypeError('amountSats must be positive int');
        }
        const tx = this.db.transaction((hex, inc, rtx) => {
            const current = this.db
                .prepare(`SELECT amount_sats, refund_amount FROM invoices WHERE id_hex = ? LIMIT 1`)
                .get(hex);
            if (!current)
                return;
            const newTotal = (current.refund_amount ?? 0) + inc;
            const now = Math.floor(Date.now() / 1000);
            const newStatus = newTotal >= current.amount_sats ? 'refunded' : 'partially_refunded';
            this.db
                .prepare(`UPDATE invoices
             SET refund_amount = ?, refund_txid = ?, refunded_at = ?, refund_count = refund_count + 1, status = ?
           WHERE id_hex = ?`)
                .run(newTotal, rtx, now, newStatus, hex);
        });
        tx(idHex, amountSats, refundTxId);
    }
    markInvoiceCanceled(idHexOrIdRaw, _tx) {
        const info = this.db
            .prepare(`UPDATE invoices SET status = 'canceled' WHERE id_hex = ?`)
            .run(idHexOrIdRaw);
        if (info.changes === 0) {
            this.db
                .prepare(`UPDATE invoices SET status = 'canceled' WHERE id_raw = ?`)
                .run(idHexOrIdRaw);
        }
    }
    updateInvoiceStatus(idRaw, status, expired) {
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
    ensureInvoiceIdHexUnique(idHex) {
        SqliteStore.assertHex64(idHex);
        const row = this.db
            .prepare(`SELECT 1 AS one FROM invoices WHERE id_hex = ? LIMIT 1`)
            .get(idHex);
        return !row;
    }
    invoiceExists(idHex) {
        SqliteStore.assertHex64(idHex);
        const row = this.db
            .prepare(`SELECT 1 AS one FROM invoices WHERE id_hex = ? LIMIT 1`)
            .get(idHex);
        return !!row;
    }
    bulkMarkExpired(idRawList) {
        if (!idRawList.length)
            return 0;
        const { clause, params } = this.inListBuilder.buildInClause('id_raw', idRawList);
        const stmt = this.db.prepare(`UPDATE invoices SET status = 'expired', expired = 1 WHERE ${clause}`);
        const info = stmt.run(...params);
        return info.changes;
    }
    // Subscriptions
    insertSubscription(row) {
        const stmt = this.db.prepare(`
      INSERT INTO subscriptions (
        id, id_hex, store_id, merchant_principal, subscriber,
        amount_sats, interval_blocks, active, created_at,
        last_billed_at, next_invoice_at, last_paid_invoice_id, mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(row.id, row.id_hex, row.store_id, row.merchant_principal, row.subscriber, row.amount_sats, row.interval_blocks, row.active, row.created_at, row.last_billed_at ?? null, row.next_invoice_at, row.last_paid_invoice_id ?? null, row.mode);
    }
    getSubscriptionByIdForStore(id, storeId) {
        const stmt = this.db.prepare(`SELECT * FROM subscriptions WHERE id = ? AND store_id = ? LIMIT 1`);
        const row = stmt.get(id, storeId);
        return row;
    }
    getActiveSubscription(id, storeId) {
        const stmt = this.db.prepare(`SELECT * FROM subscriptions WHERE id = ? AND store_id = ? AND active = 1 LIMIT 1`);
        const row = stmt.get(id, storeId);
        return row;
    }
    getActiveSubscriptions(id, storeId) {
        const stmt = this.db.prepare(`SELECT * FROM subscriptions WHERE id = ? AND store_id = ? AND active = 1 LIMIT 1`);
        const row = stmt.get(id, storeId);
        return row;
    }
    updateSubscriptionMode(id, storeId, mode) {
        this.db
            .prepare(`UPDATE subscriptions SET mode = ? WHERE id = ? AND store_id = ?`)
            .run(mode, id, storeId);
    }
    deactivateSubscription(id, storeId, _tx) {
        this.db
            .prepare(`UPDATE subscriptions SET active = 0 WHERE id = ? AND store_id = ?`)
            .run(id, storeId);
    }
    setSubscriptionActive(input) {
        SqliteStore.assertHex64(input.idHex);
        this.db
            .prepare(`UPDATE subscriptions SET active = ? WHERE id_hex = ?`)
            .run(input.active, input.idHex);
    }
    upsertSubscriptionByHex(input) {
        SqliteStore.assertHex64(input.idHex);
        const existing = this.db
            .prepare(`SELECT id, mode FROM subscriptions WHERE id_hex = ? AND store_id = ? LIMIT 1`)
            .get(input.idHex, input.storeId);
        if (existing) {
            this.db
                .prepare(`UPDATE subscriptions
             SET merchant_principal = ?,
                 subscriber = ?,
                 amount_sats = ?,
                 interval_blocks = ?,
                 active = ?
           WHERE id_hex = ? AND store_id = ?`)
                .run(input.merchantPrincipal, input.subscriber, input.amountSats, input.intervalBlocks, 1, input.idHex, input.storeId);
            return;
        }
        const now = Math.floor(Date.now() / 1000);
        this.db
            .prepare(`INSERT INTO subscriptions (
           id, id_hex, store_id, merchant_principal, subscriber,
           amount_sats, interval_blocks, active, created_at, last_billed_at,
           next_invoice_at, last_paid_invoice_id, mode
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?)`)
            .run(input.idHex, input.idHex, input.storeId, input.merchantPrincipal, input.subscriber, input.amountSats, input.intervalBlocks, 1, now, 0, 'invoice');
    }
    advanceSubscriptionSchedule(id) {
        const now = Math.floor(Date.now() / 1000);
        this.db
            .prepare(`UPDATE subscriptions
           SET next_invoice_at = next_invoice_at + interval_blocks,
               last_billed_at = ?
         WHERE id = ?`)
            .run(now, id);
    }
    updateSubscriptionLastPaid(input) {
        this.db
            .prepare(`UPDATE subscriptions SET last_paid_invoice_id = ? WHERE id_hex = ?`)
            .run(input.lastPaidInvoiceId, input.subscriptionId);
    }
    subscriptionExists(idHex) {
        SqliteStore.assertHex64(idHex);
        const row = this.db
            .prepare(`SELECT 1 AS one FROM subscriptions WHERE id_hex = ? LIMIT 1`)
            .get(idHex);
        return !!row;
    }
    selectDueSubscriptions(currentHeight) {
        const stmt = this.db.prepare(`SELECT * FROM subscriptions
         WHERE active = 1
           AND mode = 'invoice'
           AND next_invoice_at <= ?
       ORDER BY next_invoice_at ASC`);
        return stmt.all(currentHeight);
    }
    getStoreIdByPrincipal(merchantPrincipal) {
        const row = this.db
            .prepare(`SELECT id FROM merchants WHERE principal = ? LIMIT 1`)
            .get(merchantPrincipal);
        return row?.id;
    }
    selectInvoicesByStatuses(statuses, limit, storeId) {
        if (typeof statuses === "string")
            statuses = [statuses];
        if (!Array.isArray(statuses) || statuses.length === 0)
            return [];
        const cols = `id_hex, status, refund_amount, merchant_principal`;
        const wheres = [];
        const params = [];
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
        return this.db.prepare(sql).all(...params);
    }
    getInvoiceStatusByHex(idHex) {
        SqliteStore.assertHex64(idHex);
        const row = this.db
            .prepare(`SELECT status FROM invoices WHERE id_hex = ? LIMIT 1`)
            .get(idHex);
        return row?.status;
    }
    // Webhooks
    insertWebhookAttempt(row) {
        const stmt = this.db.prepare(`
      INSERT INTO webhook_logs (
        id, store_id, invoice_id, subscription_id, event_type,
        payload, status_code, success, attempts, last_attempt_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(row.id, row.store_id, row.invoice_id ?? null, row.subscription_id ?? null, row.event_type, row.payload, row.status_code ?? null, row.success, row.attempts, row.last_attempt_at);
        return row.id;
    }
    updateWebhookAttemptStatus(id, patch) {
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
    listWebhooksForStore(storeId) {
        const stmt = this.db.prepare(`SELECT * FROM webhook_logs WHERE store_id = ? ORDER BY last_attempt_at DESC`);
        return stmt.all(storeId);
    }
    listAdminWebhooks(storeId, failedOnly) {
        const parts = [`SELECT * FROM webhook_logs`];
        const wheres = [];
        const params = [];
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
        return this.db.prepare(sql).all(...params);
    }
    getWebhookLogById(id) {
        const stmt = this.db.prepare(`SELECT * FROM webhook_logs WHERE id = ? LIMIT 1`);
        const row = stmt.get(id);
        return row;
    }
    existsSuccessfulDeliveryFor(ctx) {
        const { sql, params } = this.webhookRetryComposer.composeExistsSuccessfulDeliverySQL({
            storeId: ctx.storeId,
            invoiceId: ctx.invoiceId,
            subscriptionId: ctx.subscriptionId,
            eventType: ctx.eventType,
        });
        const row = this.db.prepare(sql).get(...params);
        return !!row;
    }
    selectDueWebhookRetries() {
        const { sql } = this.webhookRetryComposer.composeSelectDueRetriesSQL();
        const rows = this.db.prepare(sql).all();
        return rows;
    }
    getDueWebhookAttempts(nowEpochSecs) {
        const { sql, params } = this.webhookRetryComposer.composeGetDueAttemptsSQL(nowEpochSecs);
        const rows = this.db.prepare(sql).all(...params);
        return rows;
    }
    hasSuccessfulExpiredWebhook(storeId, invoiceId) {
        const { sql, params } = this.webhookRetryComposer.composeHasSuccessfulExpiredWebhookSQL(storeId, invoiceId);
        const row = this.db.prepare(sql).get(...params);
        return !!row;
    }
    // Admin queries
    selectAdminInvoices(statuses, storeId) {
        const parts = [`SELECT * FROM invoices`];
        const wheres = [];
        const params = [];
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
        return this.db.prepare(sql).all(...params);
    }
    // Poller cursor
    getPollerCursor() {
        const row = this.db
            .prepare(`SELECT last_run_at, last_height, last_txid, last_block_hash FROM poller_cursor WHERE id = 1`)
            .get();
        if (!row)
            return null;
        return {
            lastRunAt: Number(row.last_run_at),
            lastHeight: Number(row.last_height),
            lastTxId: row.last_txid ?? undefined,
            lastBlockHash: row.last_block_hash ?? undefined,
        };
    }
    savePollerCursor(cursor) {
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
        stmt.run(cursor.lastRunAt, cursor.lastHeight, cursor.lastTxId ?? null, cursor.lastBlockHash ?? null);
    }
    // Utilities
    static assertHex64(idHex) {
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
exports.SqliteStore = SqliteStore;
function openDatabaseAndMigrate(dbPath) {
    if (process.env.GLOBAL_DEBUGGING === "1") {
        try {
            fs_1.default.rmSync(dbPath, { force: true });
            fs_1.default.rmSync(`${dbPath}-wal`, { force: true });
            fs_1.default.rmSync(`${dbPath}-shm`, { force: true });
        }
        catch { /* ignore */ }
    }
    const db = new better_sqlite3_1.default(dbPath);
    const store = new SqliteStore(db);
    store.migrate();
    return store;
}
//# sourceMappingURL=SqliteStore.js.map