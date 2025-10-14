"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvoiceEventApplier = void 0;
class InvoiceEventApplier {
    constructor(store, dispatcher) {
        this.store = store;
        this.dispatcher = dispatcher;
    }
    async handlePaid(e) {
        this.store.markInvoicePaid(e.idHex, e.sender ?? 'unknown', e.tx_id ?? '');
        const all = this.store.selectAdminInvoices();
        const row = all.find((r) => r.id_hex === e.idHex) ??
            (this.store.selectAdminInvoices(['paid'])).find((r) => r.id_hex === e.idHex);
        const rawBody = JSON.stringify({
            invoiceId: row.id_raw,
            status: 'paid',
            txId: e.tx_id ?? null,
            payer: e.sender ?? null,
            amountSats: row.amount_sats,
        });
        await this.dispatcher.dispatch({
            storeId: row.store_id,
            invoiceId: row.id_raw,
            eventType: 'paid',
            rawBody,
        });
    }
    async handleRefund(e) {
        const n = (v) => Number(v ?? 0);
        const refundAmount = n(e.refundAmountSats ?? e.amountSats);
        if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
            // nothing to apply (defensive guard)
            return;
        }
        this.store.upsertInvoiceRefund(e.idHex, refundAmount, e.tx_id);
        const rows = this.store.selectAdminInvoices(['refunded', 'partially_refunded', 'paid']);
        const row = rows.find((r) => r.id_hex === e.idHex);
        const rawBody = JSON.stringify({
            invoiceId: row.id_raw,
            status: refundAmount >= Number(row.amount_sats) ? 'refunded' : 'refunded',
            refundTxId: e.tx_id,
            refundAmount,
        });
        await this.dispatcher.dispatch({
            storeId: row.store_id,
            invoiceId: row.id_raw,
            eventType: 'refunded',
            rawBody,
        });
    }
    async handleCanceled(e) {
        this.store.markInvoiceCanceled(e.idHex);
        const rows = this.store.selectAdminInvoices(['canceled']);
        const row = rows.find((r) => r.id_hex === e.idHex);
        const rawBody = JSON.stringify({ invoiceId: row.id_raw });
        await this.dispatcher.dispatch({
            storeId: row.store_id,
            invoiceId: row.id_raw,
            eventType: 'invoice-canceled',
            rawBody,
        });
    }
}
exports.InvoiceEventApplier = InvoiceEventApplier;
//# sourceMappingURL=InvoiceEventApplier.js.map