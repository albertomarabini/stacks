"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriptionScheduler = void 0;
// src/schedulers/SubscriptionScheduler.ts
const transactions_1 = require("@stacks/transactions");
const network_1 = require("@stacks/network");
const SubscriptionInvoicePlanner_1 = require("../delegates/SubscriptionInvoicePlanner");
class SubscriptionScheduler {
    bindDependencies(deps) {
        this.chain = deps.chain;
        this.builder = deps.builder;
        this.store = deps.store;
        this.pricing = deps.pricing;
        this.cfg = deps.cfg;
        this.dispatcher = deps.dispatcher;
        this.codec = deps.codec;
    }
    bootstrapScheduler() {
        if (this.intervalId)
            return;
        const avgBlockSecs = this.cfg.getAvgBlockSecs();
        const poll = this.cfg.getPollingConfig().pollIntervalSecs;
        const ttlSecs = Number(process.env.QUOTE_TTL_SECONDS);
        if (!Number.isFinite(avgBlockSecs) || avgBlockSecs <= 0)
            return;
        if (!Number.isFinite(poll) || poll <= 0)
            return;
        if (!Number.isFinite(ttlSecs) || ttlSecs <= 0)
            return;
        const intervalMs = poll * 1000;
        this.intervalId = setInterval(() => this.timerCallback(), intervalMs);
    }
    timerCallback() {
        void this.tick().catch(() => { });
    }
    async tick() {
        const tip = await this.chain.getTip();
        await this.processDueSubscriptions(tip.height);
    }
    async processDueSubscriptions(currentHeight) {
        const subs = this.store.selectDueSubscriptions(currentHeight);
        for (const sub of subs) {
            try {
                await this.onSubscriptionInvoiceCreated({ subscription: sub, currentHeight });
            }
            catch {
                // Skip failed item and continue with others
            }
        }
    }
    async onSubscriptionInvoiceCreated(ctx) {
        const sub = ctx.subscription;
        const planner = new SubscriptionInvoicePlanner_1.SubscriptionInvoicePlanner(this.store, this.pricing, this.cfg, this.codec);
        const planned = await planner.plan(sub, ctx.currentHeight);
        await this.broadcastCreateInvoiceTx({
            idBuf32: planned.idBuf32,
            amountSats: sub.amount_sats,
            memo: undefined,
            expiresAtBlocks: planned.expiresAtBlocks,
        });
        const nowSecs = Math.floor(Date.now() / 1000);
        this.store.invoices.insert({
            id_raw: planned.idRaw,
            id_hex: planned.idHex,
            store_id: sub.store_id,
            amount_sats: sub.amount_sats,
            usd_at_create: planned.usdAtCreate,
            quote_expires_at: planned.quoteExpiresAtMs,
            merchant_principal: sub.merchant_principal,
            status: 'unpaid',
            payer: undefined,
            txid: undefined,
            memo: undefined,
            webhook_url: undefined,
            created_at: nowSecs,
            refunded_at: undefined,
            refund_amount: 0,
            refund_txid: undefined,
            subscription_id: sub.id,
            refund_count: 0,
            expired: 0,
        });
        this.store.advanceSubscriptionSchedule(sub.id);
        const rawBody = planner.buildWebhookRawBody(planned, sub);
        await this.dispatcher.dispatch({
            storeId: sub.store_id,
            subscriptionId: sub.id,
            invoiceId: planned.idRaw,
            eventType: 'subscription',
            rawBody,
        });
    }
    async broadcastCreateInvoiceTx(input) {
        if (!(input.idBuf32 instanceof Uint8Array) || input.idBuf32.length !== 32) {
            throw new Error('idBuf32 must be 32 bytes');
        }
        if (!Number.isInteger(input.amountSats) || input.amountSats <= 0) {
            throw new TypeError('amountSats must be a positive integer');
        }
        const idHex = this.codec.hexFromBuff32(input.idBuf32);
        const payload = this.builder.buildCreateInvoice({
            idHex,
            amountSats: input.amountSats,
            memo: input.memo,
            expiresAtBlock: input.expiresAtBlocks,
        });
        if (!this.cfg.isAutoBroadcastEnabled()) {
            throw new Error('auto_broadcast_disabled');
        }
        const senderKey = String(process.env.SCHEDULER_SENDER_KEY ?? process.env.SIGNER_PRIVATE_KEY ?? '');
        const { contractAddress, contractName, functionName, functionArgs } = payload;
        const networkName = this.cfg.getNetwork();
        const network = networkName === 'mainnet' ? network_1.STACKS_MAINNET :
            networkName === 'testnet' ? network_1.STACKS_TESTNET :
                networkName === 'devnet' ? network_1.STACKS_DEVNET :
                    network_1.STACKS_MOCKNET;
        const tx = await (0, transactions_1.makeContractCall)({
            contractAddress,
            contractName,
            functionName,
            functionArgs,
            senderKey,
            network
            // anchorMode removed — not part of SignedContractCallOptions in v7
        });
        const resp = await (0, transactions_1.broadcastTransaction)({ transaction: tx, network });
        if (typeof resp === 'string')
            return resp;
        if (resp && typeof resp.txid === 'string')
            return resp.txid;
        throw new Error('broadcast_failed');
    }
}
exports.SubscriptionScheduler = SubscriptionScheduler;
//# sourceMappingURL=SubscriptionScheduler.js.map