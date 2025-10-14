"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvoiceStatusResolver = void 0;
function isChainInvoice(x) {
    return typeof x === 'object' && x !== null;
}
class InvoiceStatusResolver {
    constructor(chain, // duck-type at runtime
    idGuard) {
        this.chain = chain;
        this.idGuard = idGuard;
    }
    withTimeout(p, ms = 6000) {
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('read_timeout')), ms);
            p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
        });
    }
    async readFromChain(idHex) {
        const anyChain = this.chain;
        try {
            if (typeof anyChain.readInvoiceStatus === 'function') {
                const s = (await this.withTimeout(anyChain.readInvoiceStatus(idHex), 6000)).toLowerCase();
                if (s === 'paid' || s === 'canceled' || s === 'expired' || s === 'unpaid')
                    return s;
                return 'not-found';
            }
            if (typeof anyChain.readInvoice === 'function') {
                const inv = await this.withTimeout(anyChain.readInvoice(idHex), 6000);
                if (isChainInvoice(inv)) {
                    const s = String(inv.status ?? 'not-found').toLowerCase();
                    if (s === 'paid' || s === 'canceled' || s === 'expired' || s === 'unpaid')
                        return s;
                }
                return 'not-found';
            }
            return 'not-found';
        }
        catch {
            return 'not-found';
        }
    }
    async readOnchainStatus(idHex) {
        this.idGuard.validateHexIdOrThrow(idHex);
        return this.readFromChain(idHex);
    }
    computeDisplayStatus(row, onchain, nowMs) {
        if (onchain === 'paid')
            return 'paid';
        if (onchain === 'canceled')
            return 'canceled';
        if (nowMs > row.quote_expires_at || onchain === 'expired')
            return 'expired';
        // If chain doesn’t know it yet, honor the DB (tests expect “unpaid” not “pending”)
        return row.status === 'pending' ? 'unpaid' : row.status;
    }
}
exports.InvoiceStatusResolver = InvoiceStatusResolver;
//# sourceMappingURL=InvoiceStatusResolver.js.map