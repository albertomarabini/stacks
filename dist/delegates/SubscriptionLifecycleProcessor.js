"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriptionLifecycleProcessor = void 0;
class SubscriptionLifecycleProcessor {
    constructor(store, chain, dispatcher) {
        this.store = store;
        this.chain = chain;
        this.dispatcher = dispatcher;
    }
    async processBatch(batch, tipHeight, minConfirmations) {
        // create-subscription
        for (const e of batch) {
            if (e.type !== 'create-subscription')
                continue;
            const conf = tipHeight - e.block_height + 1;
            if (conf < minConfirmations)
                continue;
            const storeId = this.store.getStoreIdByPrincipal(e.merchantPrincipal);
            if (!storeId)
                continue;
            this.store.upsertSubscriptionByHex({
                idHex: e.idHex,
                storeId,
                merchantPrincipal: e.merchantPrincipal,
                subscriber: e.subscriber,
                amountSats: e.amountSats,
                intervalBlocks: e.intervalBlocks,
                active: 1,
            });
            const onchain = await this.chain.readSubscription(e.idHex);
            const nextDue = onchain?.nextDue ? Number(onchain.nextDue) : 0;
            const rawBody = JSON.stringify({
                subscriptionId: e.idHex,
                merchant: e.merchantPrincipal,
                subscriber: e.subscriber,
                amountSats: e.amountSats,
                intervalBlocks: e.intervalBlocks,
                nextDue,
            });
            await this.dispatcher.dispatch({
                storeId,
                subscriptionId: e.idHex,
                eventType: 'subscription-created',
                rawBody,
            });
        }
        // cancel-subscription
        for (const e of batch) {
            if (e.type !== 'cancel-subscription')
                continue;
            const conf = tipHeight - e.block_height + 1;
            if (conf < minConfirmations)
                continue;
            this.store.setSubscriptionActive({ idHex: e.idHex, active: 0 });
            const onchain = await this.chain.readSubscription(e.idHex);
            const storeId = onchain ? this.store.getStoreIdByPrincipal(onchain.merchant) : undefined;
            if (!storeId)
                continue;
            const rawBody = JSON.stringify({ subscriptionId: e.idHex });
            await this.dispatcher.dispatch({
                storeId,
                subscriptionId: e.idHex,
                eventType: 'subscription-canceled',
                rawBody,
            });
        }
        // pay-subscription
        for (const e of batch) {
            if (e.type !== 'pay-subscription')
                continue;
            const conf = tipHeight - e.block_height + 1;
            if (conf < minConfirmations)
                continue;
            const onchain = await this.chain.readSubscription(e.idHex);
            const amountSats = onchain ? Number(onchain.amountSats) : 0;
            const nextDue = onchain ? Number(onchain.nextDue) : 0;
            const merchant = onchain?.merchant;
            const storeId = merchant ? this.store.getStoreIdByPrincipal(merchant) : undefined;
            if (!storeId)
                continue;
            // DB linkage update (idempotency handled in DAO)
            this.store.updateSubscriptionLastPaid({ subscriptionId: e.idHex, lastPaidInvoiceId: '' });
            const rawBody = JSON.stringify({
                subscriptionId: e.idHex,
                subscriber: e.sender,
                amountSats,
                txId: e.tx_id,
                nextDue,
            });
            await this.dispatcher.dispatch({
                storeId,
                subscriptionId: e.idHex,
                eventType: 'subscription-paid',
                rawBody,
            });
        }
    }
}
exports.SubscriptionLifecycleProcessor = SubscriptionLifecycleProcessor;
//# sourceMappingURL=SubscriptionLifecycleProcessor.js.map