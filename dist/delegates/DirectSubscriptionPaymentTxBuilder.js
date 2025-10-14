"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DirectSubscriptionPaymentTxBuilder = void 0;
class DirectSubscriptionPaymentTxBuilder {
    constructor(chain, builder, codec) {
        this.chain = chain;
        this.builder = builder;
        this.codec = codec;
    }
    async assemble(sub, payerPrincipal, merchantPrincipal) {
        if (sub.active !== 1 || sub.mode !== 'direct') {
            const e = new Error('Subscription not payable in direct mode');
            e.code = 'bad_status';
            throw e;
        }
        this.codec.assertHex64(sub.id_hex);
        if (payerPrincipal !== sub.subscriber) {
            const e = new Error('Payer must equal subscriber');
            e.code = 'invalid_payer';
            throw e;
        }
        const tip = await this.chain.getTip();
        if (tip.height < sub.next_invoice_at) {
            const e = new Error('Current height below next invoice at');
            e.code = 'too_early';
            throw e;
        }
        const token = await this.chain.readSbtcToken();
        if (!token) {
            const e = new Error('sBTC token not set');
            e.code = 'missing_token';
            throw e;
        }
        return this.builder.buildPaySubscription({
            idHex: sub.id_hex,
            amountSats: sub.amount_sats,
            subscriber: payerPrincipal,
            merchant: merchantPrincipal,
        });
    }
}
exports.DirectSubscriptionPaymentTxBuilder = DirectSubscriptionPaymentTxBuilder;
//# sourceMappingURL=DirectSubscriptionPaymentTxBuilder.js.map