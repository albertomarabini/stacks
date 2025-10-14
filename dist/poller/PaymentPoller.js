"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentPoller = void 0;
const ContractCallEventNormalizer_1 = require("../delegates/ContractCallEventNormalizer");
const ReorgGuard_1 = require("../delegates/ReorgGuard");
const SubscriptionLifecycleProcessor_1 = require("../delegates/SubscriptionLifecycleProcessor");
const InvoiceEventApplier_1 = require("../delegates/InvoiceEventApplier");
const MAX_UNPAID_CHECKS_PER_TICK = 200;
const MAX_REFUND_CHECKS_PER_TICK = 200;
class PaymentPoller {
    constructor() {
        this.cursor = { lastHeight: 0 };
        this.metrics = {
            running: false,
            lastRunAt: undefined,
            lastHeight: 0,
            lastTxId: undefined,
            lastBlockHash: undefined,
            lagBlocks: undefined,
        };
        this.pollHandle = null;
        this.currentIntervalMs = 0;
        this.eventNormalizer = new ContractCallEventNormalizer_1.ContractCallEventNormalizer();
        this.reorgGuard = new ReorgGuard_1.ReorgGuard();
    }
    normHex64(input) {
        const s = String(input ?? '').trim();
        if (!s)
            return '';
        const no0x = s.startsWith('0x') || s.startsWith('0X') ? s.slice(2) : s;
        return no0x.toLowerCase();
    }
    isActive() { return !!this.pollHandle; }
    // ────────────────────────────────────────────────────────────────────────────
    // READ with hardened fallbacks
    // ────────────────────────────────────────────────────────────────────────────
    async readOnchainInvoice(idHex) {
        const hex = this.normHex64(idHex);
        if (!hex)
            return undefined;
        try {
            const inv = await this.chain.readInvoice?.(hex);
            if (inv && typeof inv === 'object') {
                // console.debug('[READ:INV] tuple', { idHex: hex, keys: Object.keys(inv), inv });
                return inv;
            }
        }
        catch (e) {
            // console.debug('[READ:INV] readInvoice error', e);
        }
        try {
            const s = await this.chain.readInvoiceStatus?.(hex);
            if (typeof s === 'string' && s) {
                // console.debug('[READ:INV] status-only', { idHex: hex, status: s });
                return { status: s };
            }
        }
        catch { }
        try {
            const p = await this.chain.readIsPaid?.(hex);
            if (typeof p === 'boolean') {
                // console.debug('[READ:INV] bool-only', { idHex: hex, paid: p });
                return { status: p ? 'paid' : 'unpaid' };
            }
        }
        catch { }
        console.debug('[POLLER] onchain read returned undefined for', hex);
        return undefined;
    }
    bindDependencies(chain, store, dispatcher, expirations, cfg) {
        this.chain = chain;
        this.store = store;
        this.dispatcher = dispatcher;
        this.expirations = expirations;
        this.cfg = cfg;
        this.subscriptionProcessor = new SubscriptionLifecycleProcessor_1.SubscriptionLifecycleProcessor(this.store, this.chain, this.dispatcher);
        this.invoiceApplier = new InvoiceEventApplier_1.InvoiceEventApplier(this.store, this.dispatcher);
    }
    bootstrapPoller() {
        if (this.pollHandle)
            return;
        const pollSecs = this.cfg.getPollingConfig().pollIntervalSecs;
        const avgBlockSecs = this.cfg.getAvgBlockSecs();
        const intervalSecs = Math.max(5, pollSecs, avgBlockSecs);
        this.currentIntervalMs = intervalSecs * 1000;
        if (!this.cursor) {
            this.cursor = { lastHeight: 0, lastTxId: undefined, lastBlockHash: undefined };
        }
        this.metrics = {
            running: false,
            lastRunAt: undefined,
            lastHeight: 0,
            lastTxId: undefined,
            lastBlockHash: undefined,
            lagBlocks: undefined,
        };
        this.pollHandle = setInterval(() => void this.timerCallback(), this.currentIntervalMs);
        void this.timerCallback();
    }
    timerCallback() {
        void this.pollTick().catch((err) => {
            // keep interval alive but surface failures
            // eslint-disable-next-line no-console
            console.debug('[POLLER] pollTick error:', err?.stack || err);
            this.refreshMetrics(); // update lastRunAt even on failure
        });
    }
    // private async observePendingBroadcasts(): Promise<void> {
    //   // [MISSING] replace with your actual store read:
    //   const pending = this.store.selectPendingInvoiceBroadcasts?.() as Array<{ invoice_id: string; txid: string }> | undefined;
    //   if (!pending || !pending.length) return;
    //   for (const row of pending) {
    //     try {
    //       const tx = await (this.chain as any).getTxStatus(row.txid);
    //       const s = String(tx?.tx_status || '').toLowerCase();
    //       if (s === 'abort_by_response' || s === 'failed' || s.startsWith('dropped')) {
    //         // [MISSING] store hook to annotate failure and clear pending
    //         this.store.setInvoiceBroadcastFailed?.({ invoiceId: row.invoice_id, txid: row.txid, reason: s });
    //       }
    //       if (s === 'success') {
    //         // Don’t mark paid here — let normal on-chain reads/events flip state.
    //         // Just clear pending so UI can show “mining/confirming”.
    //         this.store.clearInvoiceBroadcastPending?.({ invoiceId: row.invoice_id, txid: row.txid });
    //       }
    //       // if s === 'pending' → do nothing
    //     } catch {
    //       // swallow transient reader errors
    //     }
    //   }
    // }
    async startPoller() {
        const saved = this.store.getPollerCursor() ??
            null;
        if (saved) {
            this.cursor = {
                lastHeight: saved.lastHeight,
                lastTxId: saved.lastTxId,
                lastBlockHash: saved.lastBlockHash,
            };
        }
        else {
            const tip = await this.chain.getTip();
            const { minConfirmations } = this.cfg.getPollingConfig();
            this.cursor = {
                lastHeight: Math.max(0, tip.height - Math.max(1, Number(minConfirmations || 1))),
                lastTxId: undefined,
                lastBlockHash: tip.blockHash,
            };
        }
        const pollSecs = this.cfg.getPollingConfig().pollIntervalSecs;
        this.currentIntervalMs = Math.max(5, pollSecs) * 1000;
        if (this.pollHandle) {
            clearInterval(this.pollHandle);
            this.pollHandle = null;
        }
        this.pollHandle = setInterval(() => void this.timerCallback(), this.currentIntervalMs);
        this.metrics = {
            running: false,
            lastRunAt: undefined,
            lastHeight: this.cursor.lastHeight,
            lastTxId: this.cursor.lastTxId,
            lastBlockHash: this.cursor.lastBlockHash,
            lagBlocks: 0,
        };
        void this.timerCallback();
    }
    async pollTick() {
        if (!this.guardReentrancy())
            return;
        let tipHeight = 0;
        try {
            const { tipHeight: th, tipBlockHash, cursorRef } = await this.readChainTip();
            const { contractAddress, contractName } = this.cfg.getContractId();
            console.debug('[POLLER:TICK]', {
                from: this.rewindToHeight !== undefined ? this.rewindToHeight : (this.cursor.lastHeight + 1),
                cursorLastHeight: this.cursor.lastHeight,
                tipHeight,
                contract: `${contractAddress}.${contractName}`,
            });
            tipHeight = th;
            const fromHeight = this.rewindToHeight !== undefined ? this.rewindToHeight : cursorRef.lastHeight + 1;
            const batch = await this.fetchAndFilterEvents(fromHeight);
            console.debug('[POLLER:BATCH]', { count: batch.length, sample: batch.slice(0, 3) });
            const { minConfirmations } = this.cfg.getPollingConfig();
            await this.processSubscriptionEvents(batch, tipHeight, minConfirmations);
            for (const e of batch) {
                await this.processEvent(e, tipHeight, minConfirmations);
            }
            const unpaidStatuses = ['unpaid'];
            const unpaidRows = this.store.selectAdminInvoices(unpaidStatuses);
            const candidateHexes = unpaidRows.map((r) => r.id_hex);
            // await this.observePendingBroadcasts();
            await this.expirations.sweepOnchainStatuses(candidateHexes, {
                store: this.store,
                chain: this.chain,
                dispatcher: this.dispatcher,
            });
            await this.sweepOnchainPaid(unpaidRows.slice(0, MAX_UNPAID_CHECKS_PER_TICK), tipHeight, minConfirmations);
            await this.sweepOnchainRefunds(tipHeight, minConfirmations);
            const reorg = await this.detectReorg(fromHeight, tipHeight);
            if (reorg) {
                this.planRewindWindow();
                return;
            }
            const lastTxId = batch.length ? batch[batch.length - 1].tx_id : undefined;
            // console.debug(`[tick:done] ${batch.length} evts, ${fromHeight}, ${tipHeight}`);
            await this.updateCursorState({ height: tipHeight, blockHash: tipBlockHash, parentHash: '' }, lastTxId, tipHeight);
            this.rewindToHeight = undefined;
        }
        finally {
            this.refreshMetrics({ tipHeight });
        }
    }
    async sweepOnchainPaid(unpaidRows, tipHeight, minConfirmations) {
        if (!unpaidRows.length)
            return;
        for (const row of unpaidRows) {
            const idHex = this.normHex64(row.id_hex);
            if (!idHex)
                continue;
            const inv = await this.readOnchainInvoice(idHex);
            const status = String(inv?.status ?? '').toLowerCase();
            const paidLike = status === 'paid' ||
                status === 'settled' ||
                status === 'paid_confirmed' ||
                status.startsWith('paid-') ||
                status.startsWith('settled-');
            if (!paidLike)
                continue;
            const paidAtHeight = typeof inv?.paidAtHeight === 'number'
                ? inv.paidAtHeight
                : (typeof inv?.lastChangeHeight === 'number' ? inv.lastChangeHeight : undefined);
            const confirmations = typeof paidAtHeight === 'number'
                ? (tipHeight - paidAtHeight + 1)
                : Number.MAX_SAFE_INTEGER;
            if (confirmations < minConfirmations)
                continue;
            const cur = String(row.status || '').toLowerCase();
            if (cur === 'paid' || cur === 'partially_refunded' || cur === 'refunded')
                continue;
            const latestStatus = this.store.getInvoiceStatusByHex(idHex);
            if (latestStatus && latestStatus.toLowerCase() !== 'unpaid')
                continue;
            const ev = {
                type: 'invoice-paid',
                idHex,
                merchantPrincipal: row.merchant_principal,
                amountSats: Number(row.amount_sats ?? 0),
                tx_id: inv?.lastTxId ?? '',
                block_height: typeof paidAtHeight === 'number' ? paidAtHeight : tipHeight,
                sender: inv?.payer ?? undefined,
            };
            await this.invoiceApplier.handlePaid(ev);
        }
    }
    // src/services/PaymentPoller.ts
    async sweepOnchainRefunds(tipHeight, minConfirmations) {
        const rows = this.store.selectInvoicesByStatuses(['paid', 'partially_refunded'], MAX_REFUND_CHECKS_PER_TICK
        // , optionalStoreId
        );
        if (!rows.length)
            return;
        // Hardened converter: handles bigint | number | "u…" string | CV JSON object
        const toNumU = (x) => {
            if (x === null || x === undefined)
                return NaN;
            if (typeof x === 'number')
                return x;
            if (typeof x === 'bigint')
                return Number(x);
            if (typeof x === 'string')
                return Number(x.startsWith('u') ? x.slice(1) : x);
            if (typeof x === 'object') {
                // Peel common CV JSON shapes: {value}, {repr}, nested
                if ('value' in x)
                    return toNumU(x.value);
                if ('repr' in x)
                    return toNumU(x.repr);
                // last-ditch: try first enumerable field
                const k = Object.keys(x)[0];
                if (k)
                    return toNumU(x[k]);
                return NaN;
            }
            return NaN;
        };
        for (const row of rows) {
            const idHex = this.normHex64(row.id_hex);
            if (!idHex)
                continue;
            const inv = await this.readOnchainInvoice(idHex);
            // console.debug('[SWEEP:R]', { idHex, invKeys: inv ? Object.keys(inv) : [], inv });
            if (!inv)
                continue;
            const onchainRefundRaw = inv.refundAmount;
            if (onchainRefundRaw === undefined || onchainRefundRaw === null) {
                // console.debug('[SWEEP:R] skip (no refundAmount on-chain)', { idHex });
                continue;
            }
            const onchainRefund = toNumU(onchainRefundRaw);
            const localRefund = Number(row.refund_amount ?? 0);
            const preview = typeof onchainRefundRaw === 'string'
                ? onchainRefundRaw.slice(0, 64)
                : (typeof onchainRefundRaw === 'object' ? Object.keys(onchainRefundRaw).slice(0, 5) : onchainRefundRaw);
            // console.debug('[SWEEP:R] types', { typeofOnchain: typeof onchainRefundRaw, preview, onchainRefund });
            if (!Number.isFinite(onchainRefund)) {
                // console.debug('[SWEEP:R] skip (refundAmount not numeric after normalize)', { idHex });
                continue;
            }
            const delta = onchainRefund - localRefund;
            // confirmations
            let h = typeof inv.lastChangeHeight === 'number' ? inv.lastChangeHeight : undefined;
            const conf = typeof h === 'number' ? (tipHeight - h + 1) : Number.MAX_SAFE_INTEGER;
            // console.debug('[SWEEP:R] decide', { idHex, onchainRefund, localRefund, delta, h, conf, minConfirmations });
            if (!(delta > 0))
                continue;
            if (conf < minConfirmations) {
                // console.debug('[SWEEP:R] wait (confirmations)', { idHex, conf, minConfirmations });
                continue;
            }
            // Fallback block height if none surfaced
            if (h === undefined)
                h = tipHeight;
            const ev = {
                type: 'refund-invoice',
                idHex,
                merchantPrincipal: row.merchant_principal,
                amountSats: delta,
                tx_id: inv.lastTxId ?? '',
                block_height: h,
            };
            // console.debug('[SWEEP:R] APPLY', { idHex, delta, tx_id: ev.tx_id });
            await this.invoiceApplier.handleRefund(ev);
        }
    }
    guardReentrancy() {
        if (this.metrics.running)
            return false;
        this.metrics.running = true;
        return true;
    }
    async readChainTip() {
        const cursorRef = { ...this.cursor };
        const { height, blockHash } = await this.chain.getTip();
        return { tipHeight: height, tipBlockHash: blockHash, cursorRef };
    }
    async fetchAndFilterEvents(fromHeight) {
        return this.eventNormalizer.fetchAndFilterEvents(fromHeight, this.chain, this.store);
    }
    async processSubscriptionEvents(eventBatch, tipHeight, minConfirmations) {
        await this.subscriptionProcessor.processBatch(eventBatch, tipHeight, minConfirmations);
    }
    async processEvent(e, tipHeight, minConfirmations) {
        const confirmations = tipHeight - e.block_height + 1;
        console.debug('[EVT:PROC]', { type: e.type, idHex: e.idHex, block: e.block_height, tipHeight, confirmations, minConfirmations });
        if (confirmations < minConfirmations) {
            console.debug('[EVT:PROC] defer (insufficient conf)', { type: e.type, idHex: e.idHex, confirmations, minConfirmations });
            return;
        }
        if (e.type === 'invoice-paid') {
            e.idHex = this.normHex64(e.idHex);
            console.debug('[EVT:PROC] APPLY paid', { idHex: e.idHex });
            await this.onInvoicePaidConfirmed(e);
            return;
        }
        if (e.type === 'refund-invoice') {
            console.debug('[EVT:PROC] APPLY refund', { idHex: e.idHex, amountSats: e.amountSats, tx: e.tx_id });
            await this.onRefundConfirmed(e);
            return;
        }
        if (e.type === 'invoice-canceled') {
            console.debug('[EVT:PROC] APPLY canceled', { idHex: e.idHex });
            await this.invoiceApplier.handleCanceled(e);
            return;
        }
    }
    async detectReorg(firstBlockToProcessHeight, tipHeight) {
        try {
            return this.reorgGuard.detectReorg(firstBlockToProcessHeight, tipHeight, { lastHeight: this.cursor.lastHeight, lastBlockHash: this.cursor.lastBlockHash }, this.chain);
        }
        catch {
            return false;
        }
    }
    planRewindWindow() {
        const { reorgWindowBlocks } = this.cfg.getPollingConfig();
        const target = this.reorgGuard.computeRewindTarget({ lastHeight: this.cursor.lastHeight, lastBlockHash: this.cursor.lastBlockHash }, reorgWindowBlocks);
        this.planRewind(target);
    }
    planRewind(targetHeight) {
        this.rewindToHeight = targetHeight;
    }
    async updateCursorState(processedBlockHeader, lastTxId, tipHeightKnown) {
        this.cursor = {
            lastHeight: processedBlockHeader.height,
            lastTxId,
            lastBlockHash: processedBlockHeader.blockHash,
        };
        const now = Math.floor(Date.now() / 1000);
        this.store.savePollerCursor({
            lastRunAt: now,
            lastHeight: this.cursor.lastHeight,
            lastTxId: this.cursor.lastTxId,
            lastBlockHash: this.cursor.lastBlockHash,
        });
        const tipHeight = typeof tipHeightKnown === 'number'
            ? tipHeightKnown
            : (await this.chain.getTip()).height;
        this.metrics.lastHeight = this.cursor.lastHeight;
        this.metrics.lastTxId = this.cursor.lastTxId;
        this.metrics.lastBlockHash = this.cursor.lastBlockHash;
        this.metrics.lagBlocks = Math.max(0, tipHeight - this.cursor.lastHeight);
    }
    async onInvoicePaidConfirmed(event) {
        await this.invoiceApplier.handlePaid(event);
    }
    async onRefundConfirmed(event) {
        await this.invoiceApplier.handleRefund(event);
    }
    async onSubscriptionCreated(event, tipHeight, minConfirmations) {
        const confirmations = tipHeight - event.block_height + 1;
        if (confirmations < minConfirmations)
            return;
        if (!/^[0-9A-Fa-f]{64}$/.test(event.idHex))
            return;
        const storeId = this.store.getStoreIdByPrincipal(String(event.merchantPrincipal));
        if (!storeId)
            return;
        this.store.upsertSubscriptionByHex({
            idHex: event.idHex,
            storeId,
            merchantPrincipal: String(event.merchantPrincipal),
            subscriber: String(event.subscriber),
            amountSats: Number(event.amountSats),
            intervalBlocks: Number(event.intervalBlocks),
            active: 1,
        });
        const onchain = await this.chain.readSubscription(event.idHex);
        const nextDue = onchain?.nextDue !== undefined ? Number(onchain.nextDue) : tipHeight + Number(event.intervalBlocks ?? 0);
        const rawBody = JSON.stringify({
            subscriptionId: event.idHex,
            merchant: String(event.merchantPrincipal),
            subscriber: String(event.subscriber),
            amountSats: Number(event.amountSats),
            intervalBlocks: Number(event.intervalBlocks),
            nextDue,
        });
        await this.dispatcher.dispatch({
            storeId,
            subscriptionId: event.idHex,
            eventType: 'subscription-created',
            rawBody,
        });
    }
    async onSubscriptionPaid(event, tipHeight, minConfirmations) {
        const confirmations = tipHeight - event.block_height + 1;
        if (confirmations < minConfirmations)
            return;
        const onchain = await this.chain.readSubscription(event.idHex);
        const amountSats = onchain ? Number(onchain.amountSats) : 0;
        const nextDue = onchain ? Number(onchain.nextDue) : tipHeight + Number(event.intervalBlocks ?? 0);
        const merchant = onchain?.merchant;
        const storeId = merchant ? this.store.getStoreIdByPrincipal(merchant) : undefined;
        if (!storeId)
            return;
        this.store.updateSubscriptionLastPaid({ subscriptionId: event.idHex, lastPaidInvoiceId: '' });
        const rawBody = JSON.stringify({
            subscriptionId: event.idHex,
            subscriber: String(event.sender),
            amountSats,
            txId: event.tx_id,
            nextDue,
        });
        await this.dispatcher.dispatch({
            storeId,
            subscriptionId: event.idHex,
            eventType: 'subscription-paid',
            rawBody,
        });
    }
    async onSubscriptionCanceled(event, tipHeight, minConfirmations) {
        const confirmations = tipHeight - event.block_height + 1;
        if (confirmations < minConfirmations)
            return;
        this.store.setSubscriptionActive({ idHex: event.idHex, active: 0 });
        const onchain = await this.chain.readSubscription(event.idHex);
        const storeId = onchain ? this.store.getStoreIdByPrincipal(onchain.merchant) : undefined;
        if (!storeId)
            return;
        const rawBody = JSON.stringify({ subscriptionId: event.idHex });
        await this.dispatcher.dispatch({
            storeId,
            subscriptionId: event.idHex,
            eventType: 'subscription-canceled',
            rawBody,
        });
    }
    refreshMetrics(snapshot) {
        this.metrics.running = false;
        this.metrics.lastRunAt = Math.floor(Date.now() / 1000);
        this.metrics.lastHeight = this.cursor.lastHeight;
        this.metrics.lastTxId = this.cursor.lastTxId;
        this.metrics.lastBlockHash = this.cursor.lastBlockHash;
        if (typeof snapshot?.tipHeight === 'number') {
            this.metrics.lagBlocks = Math.max(0, snapshot.tipHeight - this.cursor.lastHeight);
        }
    }
    restartPoller() {
        if (this.pollHandle) {
            clearInterval(this.pollHandle);
            this.pollHandle = null;
        }
        this.metrics.running = false;
        const ms = this.currentIntervalMs ||
            this.cfg.getPollingConfig().pollIntervalSecs * 1000;
        this.currentIntervalMs = ms;
        this.pollHandle = setInterval(() => void this.timerCallback(), ms);
        return { running: !!this.pollHandle };
    }
    getState() {
        return { ...this.metrics };
    }
}
exports.PaymentPoller = PaymentPoller;
//# sourceMappingURL=PaymentPoller.js.map