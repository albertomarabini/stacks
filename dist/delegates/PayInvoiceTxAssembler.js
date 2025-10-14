"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PayInvoiceTxAssembler = exports.HttpError = void 0;
const rules_1 = require("../validation/rules");
class HttpError extends Error {
    constructor(status, code, message) {
        super(message ?? code);
        this.status = status;
        this.code = code;
    }
}
exports.HttpError = HttpError;
class PayInvoiceTxAssembler {
    constructor(builder, aif, cfg, chain, idGuard, nonPayableStatuses) {
        this.builder = builder;
        this.aif = aif;
        this.cfg = cfg;
        this.chain = chain;
        this.idGuard = idGuard;
        this.nonPayableStatuses = nonPayableStatuses;
        void rules_1.Validation; // imported per spec; no runtime use here
    }
    async buildUnsignedPayInvoice(row, payerPrincipal) {
        const isActive = (typeof row.store.active === 'boolean') ? row.store.active : row.store.active === 1;
        if (!isActive)
            throw new HttpError(422, 'merchant-inactive');
        this.idGuard.validateHexIdOrThrow(row.id_hex);
        const tokenId = this.cfg.getSbtcContractId();
        if (!tokenId)
            throw new HttpError(422, 'missing-token');
        this.aif.getSbtcAssetInfo(); // surface misconfig
        // TTL + mirror status checks only (no on-chain call here)
        const ttlExpired = Date.now() > row.quote_expires_at;
        if (ttlExpired)
            throw new HttpError(409, 'expired');
        if (this.nonPayableStatuses.has(row.status)) {
            throw new HttpError(409, 'invalid-state');
        }
        const effectivePayer = (typeof payerPrincipal === 'string' && payerPrincipal.length > 0)
            ? payerPrincipal
            : row.merchant_principal;
        return this.builder.buildPayInvoice({
            idHex: row.id_hex,
            amountSats: row.amount_sats,
            payerPrincipal: effectivePayer,
            merchantPrincipal: row.merchant_principal,
        });
    }
}
exports.PayInvoiceTxAssembler = PayInvoiceTxAssembler;
//# sourceMappingURL=PayInvoiceTxAssembler.js.map