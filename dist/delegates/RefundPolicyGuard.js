"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RefundPolicyGuard = void 0;
class RefundPolicyGuard {
    constructor(codec, refund) {
        this.codec = codec;
        this.refund = refund;
    }
    async enforceAndBuild(store, invRow, amountSats, memo) {
        if (invRow.status !== 'paid' && invRow.status !== 'partially_refunded') {
            const e = new Error('Invoice not refundable in current status');
            e.code = 'bad_status';
            throw e;
        }
        this.codec.assertHex64(invRow.id_hex);
        const alreadyRefunded = invRow.refund_amount ?? 0;
        const proposed = alreadyRefunded + amountSats;
        if (proposed > invRow.amount_sats) {
            const e = new Error('Refund cap exceeded');
            e.code = 'cap_violation';
            throw e;
        }
        const hasBalance = await this.refund.precheckBalance(store.principal, amountSats);
        if (!hasBalance) {
            const e = new Error('Insufficient sBTC balance');
            e.code = 'insufficient_balance';
            throw e;
        }
        return this.refund.buildRefundPayload(store, invRow, amountSats, memo);
    }
}
exports.RefundPolicyGuard = RefundPolicyGuard;
//# sourceMappingURL=RefundPolicyGuard.js.map