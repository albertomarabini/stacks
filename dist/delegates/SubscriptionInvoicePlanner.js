"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriptionInvoicePlanner = void 0;
// src/delegates/SubscriptionInvoicePlanner.ts
const crypto_1 = __importDefault(require("crypto"));
class SubscriptionInvoicePlanner {
    constructor(store, pricing, cfg, codec) {
        this.store = store;
        this.pricing = pricing;
        this.cfg = cfg;
        this.codec = codec;
    }
    async plan(subscription, currentHeight) {
        const ttlSecs = Number(process.env.QUOTE_TTL_SECONDS);
        if (!Number.isFinite(ttlSecs) || ttlSecs <= 0) {
            throw new Error('Missing or invalid QUOTE_TTL_SECONDS.');
        }
        let idHex;
        do {
            idHex = this.codec.generateRandomBuff32Hex();
            this.codec.assertHex64(idHex);
        } while (!this.store.ensureInvoiceIdHexUnique(idHex));
        const idBuf32 = this.codec.toBuff32Hex(idHex);
        const idRaw = crypto_1.default.randomUUID();
        const usdAtCreate = await this.pricing.getUsdPriceSnapshot();
        const nowMs = Date.now();
        const avgBlockSecs = this.cfg.getAvgBlockSecs();
        const expiresAtBlocks = currentHeight + Math.ceil(ttlSecs / avgBlockSecs);
        const quoteExpiresAtMs = nowMs + ttlSecs * 1000;
        const nextDue = subscription.next_invoice_at + subscription.interval_blocks;
        return {
            idHex,
            idBuf32,
            idRaw,
            usdAtCreate,
            quoteExpiresAtMs,
            expiresAtBlocks,
            nextDue,
        };
    }
    buildWebhookRawBody(planned, subscription) {
        return JSON.stringify({
            subscriptionId: subscription.id,
            invoiceId: planned.idRaw,
            amountSats: subscription.amount_sats,
            nextDue: planned.nextDue,
            subscriber: subscription.subscriber,
        });
    }
}
exports.SubscriptionInvoicePlanner = SubscriptionInvoicePlanner;
//# sourceMappingURL=SubscriptionInvoicePlanner.js.map