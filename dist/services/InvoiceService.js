"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvoiceService = void 0;
// src/services/InvoiceService.ts
const crypto_1 = __importDefault(require("crypto"));
class InvoiceService {
    bindDependencies(deps) {
        this.store = deps.store;
        this.chain = deps.chain;
        this.builder = deps.builder;
        this.cfg = deps.cfg;
        this.pricing = deps.pricing;
        this.codec = deps.codec;
    }
    async createInvoice(store, input) {
        this.assertPositiveInt(input.amountSats, 'amountSats');
        this.assertPositiveInt(input.ttlSeconds, 'ttlSeconds');
        const idHex = this.codec.generateRandomBuff32Hex();
        this.codec.assertHex64(idHex);
        let usdAtCreate;
        try {
            usdAtCreate = await this.pricing.getUsdPriceSnapshot();
        }
        catch (e) {
            if (e?.code === 'price_unavailable') {
                // Accept invoice creation without a live USD quote (display-only in UI)
                const fallback = Number(process.env.PRICE_SNAPSHOT_DEFAULT ?? 0);
                usdAtCreate = Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
            }
            else {
                throw e;
            }
        }
        const tipHeight = await this.chain.getTipHeight();
        const avgBlockSecs = this.cfg.getAvgBlockSecs();
        const minCushionBlocks = 10;
        const ttlBlocks = Math.ceil(input.ttlSeconds / avgBlockSecs);
        const expiresAtBlock = tipHeight + Math.max(minCushionBlocks, ttlBlocks + 1);
        const unsignedTx = this.builder.buildCreateInvoice({
            idHex,
            amountSats: input.amountSats,
            memo: input.memo,
            expiresAtBlock,
        });
        const nowMs = Date.now();
        const nowSecs = Math.floor(nowMs / 1000);
        const quoteExpiresAt = nowMs + input.ttlSeconds * 1000;
        const idRaw = crypto_1.default.randomUUID();
        this.store.invoices.insert({
            id_raw: idRaw,
            id_hex: idHex,
            store_id: store.id,
            amount_sats: input.amountSats,
            usd_at_create: usdAtCreate,
            quote_expires_at: quoteExpiresAt,
            merchant_principal: store.principal,
            status: 'unpaid',
            payer: undefined,
            txid: undefined,
            memo: input.memo,
            webhook_url: input.webhookUrl,
            created_at: nowSecs,
            refunded_at: undefined,
            refund_amount: 0,
            refund_txid: undefined,
            subscription_id: undefined,
            refund_count: 0,
            expired: 0,
        });
        const dto = {
            invoiceId: idRaw,
            idHex,
            storeId: store.id,
            amountSats: input.amountSats,
            usdAtCreate,
            quoteExpiresAt,
            merchantPrincipal: store.principal,
            status: 'unpaid',
            payer: undefined,
            txId: undefined,
            memo: input.memo,
            subscriptionId: undefined,
            createdAt: nowSecs,
            refundAmount: 0,
            refundTxId: undefined,
            store: undefined,
        };
        const magicLink = `/i/${idRaw}`;
        return { ...dto, magicLink, unsignedTx };
    }
    async broadcastCreateInvoice(unsignedCall, merchantKey) {
        // Sign as merchant; Stacks.js will POST /v2/transactions and return { txid }. :contentReference[oaicite:7]{index=7}turn3file16
        const { txid } = await this.chain.signAndBroadcast(unsignedCall, merchantKey);
        return txid;
    }
    assertPositiveInt(n, name) {
        if (!Number.isInteger(n) || n <= 0) {
            throw new TypeError(`${name} must be a positive integer`);
        }
    }
}
exports.InvoiceService = InvoiceService;
//# sourceMappingURL=InvoiceService.js.map