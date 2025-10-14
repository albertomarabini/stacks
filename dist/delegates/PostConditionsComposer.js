"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostConditionsComposer = void 0;
class PostConditionsComposer {
    constructor(aif, pcf) {
        this.aif = aif;
        this.pcf = pcf;
    }
    forRefund(merchantPrincipal, amountSats) {
        const asset = this.aif.getSbtcAssetInfo();
        const postConditions = this.pcf.forRefund(merchantPrincipal, amountSats, asset);
        return {
            postConditionMode: 'deny',
            postConditions,
        };
    }
    forPay(payerPrincipal, merchantPrincipal, amountSats) {
        const asset = this.aif.getSbtcAssetInfo();
        const postConditions = this.pcf.forPayInvoice(payerPrincipal, merchantPrincipal, amountSats, asset);
        return {
            postConditionMode: 'deny',
            postConditions,
        };
    }
}
exports.PostConditionsComposer = PostConditionsComposer;
//# sourceMappingURL=PostConditionsComposer.js.map