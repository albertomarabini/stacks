"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApiCaseAndDtoMapper = void 0;
class ApiCaseAndDtoMapper {
    invoiceToPublicDto(r) {
        return {
            invoiceId: r.id_raw,
            idHex: r.id_hex,
            storeId: r.store_id,
            amountSats: r.amount_sats,
            usdAtCreate: r.usd_at_create,
            quoteExpiresAt: r.quote_expires_at,
            merchantPrincipal: r.merchant_principal,
            status: r.status,
            payer: r.payer ?? undefined,
            txId: r.txid ?? undefined,
            memo: r.memo ?? undefined,
            subscriptionId: r.subscription_id ?? undefined,
            createdAt: r.created_at,
            refundAmount: r.refund_amount ?? undefined,
            refundTxId: r.refund_txid ?? undefined,
            store: undefined,
        };
    }
    webhookToDto(w) {
        return {
            id: w.id,
            storeId: w.store_id,
            invoiceId: w.invoice_id ?? null,
            subscriptionId: w.subscription_id ?? null,
            eventType: w.event_type,
            payload: w.payload,
            statusCode: w.status_code ?? null,
            success: w.success === 1,
            attempts: w.attempts,
            lastAttemptAt: w.last_attempt_at ?? null,
        };
    }
    storeToPrivateProfile(row) {
        return {
            id: row.id,
            name: row.name ?? undefined,
            displayName: row.display_name ?? null,
            logoUrl: row.logo_url ?? null,
            brandColor: row.brand_color ?? null,
            webhookUrl: row.webhook_url ?? undefined,
            supportEmail: row.support_email ?? null,
            supportUrl: row.support_url ?? null,
            allowedOrigins: row.allowed_origins
                ? row.allowed_origins
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                : [],
            principal: row.principal,
            active: !!row.active,
        };
    }
    toCamel(input) {
        if (input === null || typeof input !== 'object')
            return input;
        if (Array.isArray(input))
            return input.map((v) => this.toCamel(v));
        const out = {};
        for (const [k, v] of Object.entries(input)) {
            const camel = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
            out[camel] = this.toCamel(v);
        }
        return out;
    }
    toSnake(input) {
        if (input === null || typeof input !== 'object')
            return input;
        if (Array.isArray(input))
            return input.map((v) => this.toSnake(v));
        const out = {};
        for (const [k, v] of Object.entries(input)) {
            const snake = k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
            out[snake] = this.toSnake(v);
        }
        return out;
    }
}
exports.ApiCaseAndDtoMapper = ApiCaseAndDtoMapper;
//# sourceMappingURL=ApiCaseAndDtoMapper.js.map