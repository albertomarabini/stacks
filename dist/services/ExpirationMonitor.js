"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExpirationMonitor = void 0;
const rules_1 = require("../validation/rules");
class ExpirationMonitor {
    async getInvoiceStatus(chain, idHex) {
        const maybe = chain;
        try {
            if (typeof maybe.readInvoiceStatus === 'function') {
                return await maybe.readInvoiceStatus(idHex);
            }
            if (typeof maybe.readInvoice === 'function') {
                const inv = await maybe.readInvoice(idHex);
                const s = inv?.status;
                return s ? String(s) : 'unknown';
            }
        }
        catch { }
        return 'unknown';
    }
    async emitInvoiceExpiredWebhook(invoiceId, storeId, deps) {
        if (!invoiceId || !storeId)
            throw new Error('invalid_args');
        const already = deps.store.existsSuccessfulDeliveryFor({
            storeId: String(storeId),
            invoiceId: String(invoiceId),
            eventType: 'invoice-expired',
        });
        if (already)
            return false;
        const rawBody = JSON.stringify({ invoiceId, status: 'expired' });
        await deps.dispatcher.dispatch({
            storeId, invoiceId, eventType: 'invoice-expired', rawBody,
        });
        return true;
    }
    // src/services/ExpirationMonitor.ts
    async sweepOnchainStatuses(candidateIdHexes, deps) {
        // 0) Load all invoices once; we'll filter twice (on-chain + time-based).
        const allRows = deps.store.selectAdminInvoices();
        // 1) ON-CHAIN sweep (existing behavior)
        const valid = Array.from(new Set(candidateIdHexes.filter((h) => typeof h === 'string' && rules_1.Validation.idHex64.test(h))));
        const expiredHexSet = new Set();
        for (const idHex of valid) {
            const status = (await this.getInvoiceStatus(deps.chain, idHex)).toLowerCase();
            if (status === 'expired')
                expiredHexSet.add(idHex);
        }
        const onchainExpiredIds = Array.from(expiredHexSet);
        // Build eligible rows for on-chain expired
        const onchainEligible = allRows.filter((r) => expiredHexSet.has(r.id_hex) &&
            r.status !== 'paid' &&
            r.status !== 'canceled' &&
            Number(r.expired) === 0);
        // 2) TIME-BASED sweep (NEW): DTO quote has expired, regardless of chain status
        const nowMs = Date.now();
        const timeExpiredEligible = allRows.filter((r) => r.status === 'unpaid' &&
            Number(r.expired) === 0 &&
            typeof r.quote_expires_at === 'number' &&
            nowMs > Number(r.quote_expires_at));
        // 3) Combine both sets, dedupe by id_raw
        const combinedByIdRaw = new Map();
        for (const row of [...onchainEligible, ...timeExpiredEligible]) {
            combinedByIdRaw.set(row.id_raw, row);
        }
        const toMark = Array.from(combinedByIdRaw.values());
        if (toMark.length === 0) {
            return { expiredIds: onchainExpiredIds, updated: 0 };
        }
        // 4) Persist + emit webhooks
        const idRawList = toMark.map((r) => r.id_raw);
        const updated = deps.store.bulkMarkExpired(idRawList);
        // Emit per row (exactly-once safeguard remains in emitInvoiceExpiredWebhook)
        for (const row of toMark) {
            // eslint-disable-next-line no-await-in-loop
            await this.emitInvoiceExpiredWebhook(row.id_raw, row.store_id, {
                store: deps.store,
                dispatcher: deps.dispatcher,
            });
        }
        return { expiredIds: onchainExpiredIds, updated };
    }
}
exports.ExpirationMonitor = ExpirationMonitor;
//# sourceMappingURL=ExpirationMonitor.js.map