"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClarityCvAdapter = void 0;
const transactions_1 = require("@stacks/transactions");
class ClarityCvAdapter {
    guardHex32(idHex) {
        if (typeof idHex !== 'string' || idHex.length !== 64) {
            throw new Error('idHex must be 64 hex chars');
        }
        const buf = Buffer.from(idHex, 'hex');
        if (buf.length !== 32 || buf.toString('hex') !== idHex.toLowerCase()) {
            throw new Error('idHex must decode to 32 bytes and round-trip');
        }
        return buf;
    }
    decodeOptionalInvoiceTuple(cv, idHex) {
        const j = (0, transactions_1.cvToJSON)(cv);
        // Optional response: either `(none)` or `(some (tuple ...))`
        if (j?.type === 'none')
            return undefined;
        const t = j?.value;
        if (!t || typeof t !== 'object')
            return undefined;
        // Common field names (tolerate minor variations)
        const status = String(t.status ?? t['status'] ?? '').toLowerCase() || undefined;
        // Heights (some contracts expose only one of these)
        const paidAtHeight = Number.isFinite(Number(t['paid-at-height'])) ? Number(t['paid-at-height'])
            : Number.isFinite(Number(t['paidAtHeight'])) ? Number(t['paidAtHeight'])
                : undefined;
        const lastChangeHeight = Number.isFinite(Number(t['last-change-height'])) ? Number(t['last-change-height'])
            : Number.isFinite(Number(t['lastChangeHeight'])) ? Number(t['lastChangeHeight'])
                : undefined;
        const lastTxId = t['last-txid'] ?? t['lastTxId'] ?? t['txid'] ?? undefined;
        // Amounts – keep as number|string|bigint so poller can coerce
        const amountSats = t['amount'] ?? t['amount-sats'] ?? t['amountSats'];
        const refundAmount = t['refund'] ?? t['refund-amount'] ?? t['refundAmount'];
        // Payer / sender principal
        const payer = t['payer'] ?? t['sender'] ?? undefined;
        return {
            status,
            paidAtHeight,
            lastChangeHeight,
            lastTxId: typeof lastTxId === 'string' && lastTxId ? String(lastTxId) : undefined,
            refundAmount,
            amountSats,
            payer: payer ? String(payer) : undefined,
        };
    }
    decodeOptionalContractPrincipal(cv) {
        const asString = (0, transactions_1.cvToString)(cv);
        if (asString === 'none' || asString === '(none)')
            return undefined;
        const m = asString.match(/\(some\s+([A-Z0-9]{1,}\.[a-zA-Z0-9\-_]+)\)/);
        if (m && m[1]) {
            const [contractAddress, contractName] = m[1].split('.');
            return { contractAddress, contractName };
        }
        const j = (0, transactions_1.cvToJSON)(cv);
        if (j?.type === 'some' && j?.value) {
            const inner = j.value;
            const contractAddress = inner.address ?? inner.contractAddress;
            const contractName = inner.contractName ?? inner.name;
            if (contractAddress && contractName)
                return { contractAddress, contractName };
        }
        throw new Error(`Unexpected optional contract-principal shape: ${asString}`);
    }
    decodeOptionalSubscriptionTuple(cv, idHex) {
        const j = (0, transactions_1.cvToJSON)(cv);
        if (j.type === 'none')
            return undefined;
        const t = j.value;
        const merchant = String(t['merchant']);
        const subscriber = String(t['subscriber']);
        const amountSats = BigInt(t['amount']);
        const intervalBlocks = BigInt(t['interval']);
        const active = Boolean(t['active']);
        const nextDue = BigInt(t['next-due']);
        return { idHex, merchant, subscriber, amountSats, intervalBlocks, active, nextDue };
    }
}
exports.ClarityCvAdapter = ClarityCvAdapter;
exports.default = ClarityCvAdapter;
//# sourceMappingURL=ClarityCvAdapter.js.map