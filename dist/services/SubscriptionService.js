"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriptionService = void 0;
// src/services/SubscriptionService.ts
const crypto_1 = __importDefault(require("crypto"));
class SubscriptionService {
    bindDependencies(deps) {
        this.store = deps.store;
        this.builder = deps.builder;
        this.chain = deps.chain;
        this.cfg = deps.cfg;
        this.codec = deps.codec;
        this.pricing = deps.pricing;
    }
    async createSubscription(store, body) {
        const id = crypto_1.default.randomUUID();
        const idHex = this.generateUniqueSubHex();
        const now = Math.floor(Date.now() / 1000);
        const tip = await this.chain.getTip();
        const nextInvoiceAt = tip.height + body.intervalBlocks;
        const mode = body.mode ?? 'invoice';
        const row = {
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
        let unsignedCall;
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
    // src/services/SubscriptionService.ts
    async generateInvoiceForSubscription(sub, opts) {
        const idHex = this.generateUniqueInvoiceHex();
        const nowMs = Date.now();
        const nowSecs = Math.floor(nowMs / 1000);
        // --- USD price snapshot with fallback (match InvoiceService.createInvoice) ---
        let usdAtCreate;
        try {
            usdAtCreate = await this.pricing.getUsdPriceSnapshot();
        }
        catch (e) {
            // don’t fail the request — UI only uses this for display
            const fallback = Number(process.env.PRICE_SNAPSHOT_DEFAULT ?? 0);
            usdAtCreate = Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
        }
        // --- expiry (add cushion; avoid instant-expire edge cases) ---
        const avgBlockSecs = this.cfg.getAvgBlockSecs?.() ?? 30;
        const minCushionBlocks = 10;
        const tip = await this.chain.getTip(); // assumes { height }
        const ttlBlocks = Math.ceil(opts.ttlSeconds / avgBlockSecs);
        const expiresAtBlock = tip.height + Math.max(minCushionBlocks, ttlBlocks + 1);
        const unsignedCall = this.builder.buildCreateInvoice({
            idHex,
            amountSats: sub.amount_sats,
            memo: opts.memo,
            expiresAtBlock,
        });
        const idRaw = crypto_1.default.randomUUID();
        const quoteExpiresAt = nowMs + opts.ttlSeconds * 1000;
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
        // Best-effort; don’t let this break the response
        try {
            this.store.advanceSubscriptionSchedule(sub.id);
        }
        catch { }
        const invoice = {
            invoiceId: idRaw,
            idHex,
            storeId: opts.storeId,
            amountSats: sub.amount_sats,
            usdAtCreate,
            quoteExpiresAt,
            merchantPrincipal: opts.merchantPrincipal,
            status: 'unpaid',
            payer: undefined,
            txId: undefined,
            memo: opts.memo ?? undefined,
            subscriptionId: sub.id,
            createdAt: nowSecs,
            refundAmount: 0,
            refundTxId: undefined,
            store: undefined,
        };
        return { invoice, unsignedCall };
    }
    async setMode(sub, mode) {
        this.store.updateSubscriptionMode(sub.id, sub.store_id, mode);
        let unsignedCall;
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
        const updated = this.store.getSubscriptionByIdForStore(sub.id, sub.store_id) ||
            { ...sub, mode };
        return { row: updated, unsignedCall };
    }
    async cancel(sub) {
        this.store.deactivateSubscription(sub.id, sub.store_id);
        const unsignedCall = this.builder.buildCancelSubscription({ idHex: sub.id_hex });
        const updated = this.store.getSubscriptionByIdForStore(sub.id, sub.store_id) ||
            { ...sub, active: 0 };
        return { row: updated, unsignedCall };
    }
    generateUniqueSubHex() {
        let idHex;
        do {
            idHex = this.codec.generateRandomBuff32Hex();
            this.codec.assertHex64(idHex);
        } while (this.store.subscriptionExists(idHex));
        return idHex;
    }
    generateUniqueInvoiceHex() {
        let idHex;
        do {
            idHex = this.codec.generateRandomBuff32Hex();
            this.codec.assertHex64(idHex);
        } while (!this.store.ensureInvoiceIdHexUnique(idHex));
        return idHex;
    }
}
exports.SubscriptionService = SubscriptionService;
//# sourceMappingURL=SubscriptionService.js.map