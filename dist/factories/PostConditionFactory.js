"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PostConditionFactory = void 0;
// src/factories/PostConditionFactory.ts
const transactions_1 = require("@stacks/transactions");
class PostConditionFactory {
    /**
     * Build post-conditions for paying an invoice.
     * NOTE: Post-conditions constrain the *sender* only. Recipient guarantees are enforced in Clarity.
     */
    forPayInvoice(payer, merchant, amountSats, asset) {
        if (typeof payer !== 'string' || payer.length === 0)
            throw new Error('invalid_payer_principal');
        if (typeof merchant !== 'string' || merchant.length === 0)
            throw new Error('invalid_merchant_principal');
        if (typeof asset?.contractAddress !== 'string' || asset.contractAddress.length === 0)
            throw new Error('invalid_contract_address');
        if (typeof asset?.contractName !== 'string' || asset.contractName.length === 0)
            throw new Error('invalid_contract_name');
        if (typeof asset?.assetName !== 'string' || asset.assetName.length === 0)
            throw new Error('invalid_asset_name');
        const amt = BigInt(amountSats);
        if (amt <= 0n)
            throw new Error('invalid_amount');
        const contractId = `${asset.contractAddress}.${asset.contractName}`;
        // Payer must send >= amount of the FT (sBTC)
        const payerSendsGte = transactions_1.Pc.principal(payer).willSendGte(amt).ft(contractId, asset.assetName);
        // extra guard: merchant does not send any sBTC in this tx
        const merchantSendsLte0 = transactions_1.Pc.principal(merchant).willSendLte(0n).ft(contractId, asset.assetName);
        return [payerSendsGte, merchantSendsLte0];
    }
    /**
     * Build post-conditions for a refund (cap merchant outflow).
     */
    forRefund(merchant, amountSats, asset) {
        if (typeof merchant !== 'string' || merchant.length === 0)
            throw new Error('invalid_merchant_principal');
        if (typeof asset?.contractAddress !== 'string' || asset.contractAddress.length === 0)
            throw new Error('invalid_contract_address');
        if (typeof asset?.contractName !== 'string' || asset.contractName.length === 0)
            throw new Error('invalid_contract_name');
        if (typeof asset?.assetName !== 'string' || asset.assetName.length === 0)
            throw new Error('invalid_asset_name');
        const amt = BigInt(amountSats);
        if (amt <= 0n)
            throw new Error('invalid_amount');
        const contractId = `${asset.contractAddress}.${asset.contractName}`;
        // Merchant will send <= amount of the FT (sBTC)
        const capOutflow = transactions_1.Pc.principal(merchant).willSendLte(amt).ft(contractId, asset.assetName);
        return [capOutflow];
    }
}
exports.PostConditionFactory = PostConditionFactory;
exports.default = PostConditionFactory;
//# sourceMappingURL=PostConditionFactory.js.map