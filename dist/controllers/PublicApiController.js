"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PublicApiController = void 0;
const InvoiceIdGuard_1 = require("../delegates/InvoiceIdGuard");
const InvoiceStatusResolver_1 = require("../delegates/InvoiceStatusResolver");
const StorePublicProfileProjector_1 = require("../delegates/StorePublicProfileProjector");
const PayInvoiceTxAssembler_1 = require("../delegates/PayInvoiceTxAssembler");
const HttpStatusMap = {
    invalidPayload: 400,
    notFound: 404,
    conflict: 409,
    unprocessable: 422,
    upgradeRequired: 426,
};
const PublicErrors = {
    notFound: { error: 'notFound' },
    invalidId: { error: 'invalidId' },
    expired: { error: 'expired' },
    invalidState: { error: 'invalidState' },
    missingIdentifier: { error: 'missingIdentifier' },
    missingSbtcToken: { error: 'missingSbtcToken' },
};
// ✳️ include "cancelled" defensively, though canonical is "canceled" in DB/specs
const NonPayableStatuses = new Set([
    'paid',
    'canceled',
    'cancelled',
    'expired',
    'refunded',
    'partially_refunded',
]);
class PublicApiController {
    // Best-effort CORS header setter in case route middleware didn't run.
    // If the store (or row.store) has an allow-list, reflect the Origin when allowed,
    // otherwise fall back to "*". Also sets Vary: Origin when reflecting.
    setCorsIfMissing(req, res, allowListCsv) {
        // already set by middleware? leave it alone
        if (res.getHeader('Access-Control-Allow-Origin'))
            return;
        const origin = String(req.headers.origin || '');
        const list = (allowListCsv || '')
            .split(',')
            .map(s => s.trim())
            .filter(Boolean);
        // reflect when explicitly allowed; otherwise use "*"
        const allow = (origin && list.length && list.includes(origin)) ? origin : '*';
        res.setHeader('Access-Control-Allow-Origin', allow);
        if (allow !== '*') {
            // ensure caches don’t coalesce different origins
            const prevVary = String(res.getHeader('Vary') || '').trim();
            res.setHeader('Vary', prevVary ? `${prevVary}, Origin` : 'Origin');
        }
    }
    bindDependencies(deps) {
        this.store = deps.store;
        this.chain = deps.chain;
        this.builder = deps.builder;
        this.aif = deps.aif;
        this.cfg = deps.cfg;
        this.codec = deps.codec;
        this.idGuard = new InvoiceIdGuard_1.InvoiceIdGuard(this.codec);
        // ✅ pass chain + idGuard only; resolver will duck-type the chain
        this.statusResolver = new InvoiceStatusResolver_1.InvoiceStatusResolver(this.chain, this.idGuard);
        this.profileProjector = new StorePublicProfileProjector_1.StorePublicProfileProjector();
        this.txAssembler = new PayInvoiceTxAssembler_1.PayInvoiceTxAssembler(this.builder, this.aif, this.cfg, this.chain, this.idGuard, NonPayableStatuses);
    }
    bindCorsPolicy(corsMwFactory) {
        this.cors = corsMwFactory;
    }
    async getInvoice(req, res) {
        const idRaw = req.params.invoiceId;
        const row = this.store.getInvoiceWithStore(idRaw);
        if (!row) {
            res.status(HttpStatusMap.notFound).json(PublicErrors.notFound);
            return;
        }
        try {
            this.idGuard.validateHexIdOrThrow(row.id_hex);
        }
        catch {
            res.status(HttpStatusMap.invalidPayload).json(PublicErrors.invalidId);
            return;
        }
        const onchain = await this.statusResolver.readOnchainStatus(row.id_hex);
        const status = this.statusResolver.computeDisplayStatus({ id_hex: row.id_hex, status: row.status, quote_expires_at: row.quote_expires_at }, onchain, Date.now());
        const storeProfile = this.profileProjector.project(row.store);
        const dto = {
            invoiceId: row.id_raw,
            idHex: row.id_hex,
            storeId: row.store_id,
            amountSats: row.amount_sats,
            usdAtCreate: row.usd_at_create,
            quoteExpiresAt: row.quote_expires_at,
            merchantPrincipal: row.merchant_principal,
            status: status,
            payer: row.payer ?? undefined,
            txId: row.txid ?? undefined,
            memo: row.memo ?? undefined,
            subscriptionId: row.subscription_id ?? undefined,
            createdAt: row.created_at,
            refundAmount: row.refund_amount ? row.refund_amount : undefined,
            refundTxId: row.refund_txid ?? undefined,
            store: storeProfile,
        };
        // ensure CORS header for public GET (browser won't preflight)
        const allowed = row.store?.allowed_origins || row.store?.allowedOrigins;
        this.setCorsIfMissing(req, res, allowed);
        res.json(dto);
    }
    async createTx(req, res) {
        const body = req.body || {};
        const invoiceId = body.invoiceId ? String(body.invoiceId) : '';
        const payerPrincipal = body.payerPrincipal ? String(body.payerPrincipal) : undefined;
        if (!invoiceId) {
            this.setCorsIfMissing(req, res); // no store context yet
            res.status(400).json(PublicErrors.missingIdentifier);
            return;
        }
        const row = this.store.getInvoiceWithStore(invoiceId);
        const allowFromRow = row ? (row.store?.allowed_origins || row.store?.allowedOrigins) : undefined;
        if (!row) {
            this.setCorsIfMissing(req, res);
            res.status(404).json(PublicErrors.notFound);
            return;
        }
        // ✳️ Harden: compute effective status (DB + on-chain) before building.
        let effectiveStatus = String(row.status || '').toLowerCase();
        try {
            // Validate that the stored id_hex is sane; if invalid, we will surface invalidId below
            this.idGuard.validateHexIdOrThrow(row.id_hex);
            const onchain = await this.statusResolver.readOnchainStatus(row.id_hex);
            effectiveStatus = this.statusResolver.computeDisplayStatus({ id_hex: row.id_hex, status: effectiveStatus, quote_expires_at: row.quote_expires_at }, onchain, Date.now()).toLowerCase();
        }
        catch (e) {
            // If id invalid, map to 400; otherwise continue with DB status.
            if (e instanceof Error && /invalid/i.test(e.message)) {
                this.setCorsIfMissing(req, res, allowFromRow);
                res.status(HttpStatusMap.invalidPayload).json(PublicErrors.invalidId);
                return;
            }
        }
        if (NonPayableStatuses.has(effectiveStatus)) {
            this.setCorsIfMissing(req, res, allowFromRow);
            // small debug hint for ops (status reason)
            res.setHeader('X-Blocked-Reason', `status=${effectiveStatus}`);
            res.status(409).json(PublicErrors.invalidState);
            return;
        }
        try {
            const payload = await this.txAssembler.buildUnsignedPayInvoice(row, payerPrincipal);
            this.setCorsIfMissing(req, res, allowFromRow);
            res.json(payload);
        }
        catch (e) {
            if (e instanceof PayInvoiceTxAssembler_1.HttpError) {
                this.setCorsIfMissing(req, res, allowFromRow);
                if (e.code === 'merchant-inactive') {
                    res.status(e.status).json(PublicErrors.invalidState);
                    return;
                }
                else if (e.code === 'expired') {
                    res.status(e.status).json(PublicErrors.expired);
                    return;
                }
                else if (e.code === 'missing-token') {
                    res.status(e.status).json(PublicErrors.missingSbtcToken);
                    return;
                }
                else if (e.code === 'invalid-id') {
                    res.status(e.status).json(PublicErrors.invalidId);
                    return;
                }
                else {
                    res.status(HttpStatusMap.conflict).json(PublicErrors.invalidState);
                    return;
                }
            }
            this.setCorsIfMissing(req, res, allowFromRow);
            res.status(HttpStatusMap.conflict).json(PublicErrors.invalidState);
        }
    }
    async getStorePublicProfile(req, res) {
        const storeId = req.params.storeId;
        const rows = this.store.listMerchantsProjection();
        const m = rows.find((r) => r.id === storeId);
        if (!m) {
            res.status(HttpStatusMap.notFound).json(PublicErrors.notFound);
            return;
        }
        const profile = this.profileProjector.project(m);
        // ensure CORS header on simple GET
        this.setCorsIfMissing(req, res, m.allowed_origins || m.allowedOrigins);
        res.json(profile);
    }
}
exports.PublicApiController = PublicApiController;
//# sourceMappingURL=PublicApiController.js.map