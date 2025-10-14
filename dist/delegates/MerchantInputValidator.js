"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MerchantInputValidator = void 0;
// src/delegates/MerchantInputValidator.ts
const rules_1 = require("../validation/rules");
class MerchantInputValidator {
    validateCreateInvoiceBody(body) {
        const amountSats = Number(body?.amount_sats);
        const ttlSeconds = Number(body?.ttl_seconds);
        if (!Number.isInteger(amountSats) || amountSats <= 0) {
            throw new TypeError('amount_sats must be positive int');
        }
        if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
            throw new TypeError('ttl_seconds must be positive int');
        }
        let memo;
        if (body?.memo !== undefined && body.memo !== null) {
            const str = String(body.memo);
            const buf = Buffer.from(str, 'utf8').subarray(0, rules_1.Validation.createInvoice.memoMaxUtf8Bytes);
            memo = buf.toString('utf8');
        }
        let webhookUrl;
        if (body?.webhook_url) {
            const url = String(body.webhook_url);
            if (!rules_1.Validation.url.test(url)) {
                throw new TypeError('invalid webhook_url');
            }
            webhookUrl = url;
        }
        return { amountSats, ttlSeconds, memo, webhookUrl };
    }
    validateRefundBody(body) {
        const b = body || {};
        // accept snake_case or camelCase
        const invoiceId = String(b.invoice_id ?? b.invoiceId ?? '').trim();
        const amountSatsRaw = b.amount_sats ?? b.amountSats;
        const amountSats = Number(amountSatsRaw);
        // same memo handling (limit per Steroids)
        const memoMax = rules_1.Validation.refund.memoMaxUtf8Bytes;
        let memo;
        if (typeof b.memo === 'string') {
            const enc = new TextEncoder().encode(b.memo);
            memo = new TextDecoder().decode(enc.subarray(0, memoMax));
        }
        // current project uses regexes on Validation, not methods
        if (!invoiceId || !rules_1.Validation.uuid.test(invoiceId)) {
            throw new TypeError('invalid invoice_id');
        }
        if (!Number.isInteger(amountSats) || amountSats <= 0) {
            throw new TypeError('invalid amount_sats');
        }
        // NOTICE: return **camelCase** (controller expects this)
        return { invoiceId, amountSats, memo };
    }
    assertStacksPrincipal(p) {
        if (!rules_1.Validation.stacksPrincipal.test(p)) {
            throw new TypeError('invalid principal');
        }
    }
    assertPositiveInt(n, name) {
        if (!Number.isInteger(n) || n <= 0) {
            throw new TypeError(`${name} must be positive integer`);
        }
    }
}
exports.MerchantInputValidator = MerchantInputValidator;
//# sourceMappingURL=MerchantInputValidator.js.map