"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MerchantApiController = void 0;
const crypto_1 = __importDefault(require("crypto"));
const ApiCaseAndDtoMapper_1 = require("../delegates/ApiCaseAndDtoMapper");
const MerchantInputValidator_1 = require("../delegates/MerchantInputValidator");
const RefundPolicyGuard_1 = require("../delegates/RefundPolicyGuard");
const DirectSubscriptionPaymentTxBuilder_1 = require("../delegates/DirectSubscriptionPaymentTxBuilder");
const rules_1 = require("../validation/rules");
const InvoiceIdGuard_1 = require("../delegates/InvoiceIdGuard");
const PayInvoiceTxAssembler_1 = require("../delegates/PayInvoiceTxAssembler");
const stacks_pay_1 = require("stacks-pay");
const json_safe_1 = require("../utils/json-safe");
class BroadcastFailed extends Error {
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.status = 502;
        this.code = 'broadcast_failed';
    }
}
class MerchantApiController {
    jsonSafe(obj) {
        if (obj === undefined)
            return undefined;
        return JSON.parse(JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
    }
    // MerchantApiController.ts (inside class)
    async ensureInvoiceOnChain(rowWithStore, store) {
        const idHex = String(rowWithStore?.id_hex || rowWithStore?.invoice_id_hex || '').toLowerCase();
        if (!idHex)
            throw new BroadcastFailed('missing_invoice_id_hex');
        // Fast path: if it exists already, no-op
        const status = await this.chain.readInvoiceStatus(idHex).catch(() => 'not-found');
        if (status !== 'not-found')
            return {};
        // Build a minimal create-invoice call (contract enforces everything else)
        const unsignedCreate = this.builder.buildCreateInvoice({
            idHex,
            amountSats: Number(rowWithStore?.amount_sats ?? rowWithStore?.amountSats ?? rowWithStore?.amount),
            memo: rowWithStore?.memo ?? undefined,
            // expiresAt optional – if you track a block-height, pass it here
        });
        const { txid } = await this.mustBroadcast(unsignedCreate, store);
        return { created: true, txid };
    }
    async mustBroadcast(unsigned, store) {
        // hard gate
        if (!this.cfg.isAutoBroadcastOnChainEnabled()) {
            throw new BroadcastFailed('autobroadcast_disabled');
        }
        const signer = store.stx_private_key || process.env.SIGNER_PRIVATE_KEY || '';
        if (!signer) {
            throw new BroadcastFailed('missing_signer_key');
        }
        try {
            const { txid } = await this.chain.signAndBroadcast(unsigned, signer);
            if (!txid)
                throw new BroadcastFailed('no_txid_returned');
            return { txid };
        }
        catch (e) {
            // surface precise reason; do not swallow
            const detail = e?.message ||
                e?.result?.reason ||
                e?.result?.error ||
                'unknown_broadcast_error';
            // (Optionally log)
            console.warn('[autobroadcast_failed]', { detail, result: e?.result });
            throw new BroadcastFailed(`broadcast_failed: ${detail}`, e);
        }
    }
    bindDependencies(deps) {
        this.store = deps.store;
        this.chain = deps.chain;
        this.builder = deps.builder;
        this.pricing = deps.pricing;
        this.cfg = deps.cfg;
        this.codec = deps.codec;
        this.subs = deps.subs;
        this.inv = deps.inv;
        this.refund = deps.refund;
        this.aif = deps.aif;
        this.dtoMapper = new ApiCaseAndDtoMapper_1.ApiCaseAndDtoMapper();
        this.inputValidator = new MerchantInputValidator_1.MerchantInputValidator();
        this.refundPolicy = new RefundPolicyGuard_1.RefundPolicyGuard(this.codec, this.refund);
        this.directSubPayBuilder = new DirectSubscriptionPaymentTxBuilder_1.DirectSubscriptionPaymentTxBuilder(this.chain, this.builder, this.codec);
        // ← new (same wiring as PublicApiController)
        this.idGuard = new InvoiceIdGuard_1.InvoiceIdGuard(this.codec);
        const NonPayableStatuses = new Set(['paid', 'canceled', 'cancelled', 'expired', 'refunded', 'partially_refunded']);
        this.payTxAsm = new PayInvoiceTxAssembler_1.PayInvoiceTxAssembler(this.builder, this.aif, this.cfg, this.chain, this.idGuard, NonPayableStatuses);
    }
    // Base64url-encode a UTF-8 string (no padding)
    b64url(s) {
        return Buffer.from(s, 'utf8').toString('base64')
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    }
    // HMAC SHA-256 of data with the store secret, base64url encoded
    hmacB64url(secret, data) {
        return crypto_1.default.createHmac('sha256', secret).update(data).digest('base64')
            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    }
    // Normalize builder output so the checkout page can use it directly with @stacks/connect
    normalizeUnsigned(unsigned) {
        const contractId = unsigned?.contractId ??
            (unsigned?.contractAddress && unsigned?.contractName
                ? `${unsigned.contractAddress}.${unsigned.contractName}`
                : String(unsigned?.contract || ''));
        return {
            contractId,
            function: String(unsigned?.function ?? unsigned?.functionName ?? 'pay-invoice'),
            args: Array.isArray(unsigned?.functionArgs) ? unsigned.functionArgs : [],
            postConditions: unsigned?.postConditions ?? [],
            postConditionMode: String(unsigned?.postConditionMode ?? 'deny'),
            network: unsigned?.network ?? this.cfg.getNetwork(),
        };
    }
    async getInvoice(req, res) {
        const sreq = req;
        const idRaw = String(req.params.invoiceId);
        const row = this.store.invoices.findByStoreAndIdRaw(sreq.store.id, idRaw);
        if (!row) {
            res.status(404).end();
            return;
        }
        const dto = this.dtoMapper.invoiceToPublicDto(row);
        res.json(dto);
    }
    async listInvoices(req, res) {
        // guard: missing auth should be a clean 401 (prevents "fetch failed")
        if (!req.store) {
            res.status(401).json({ error: 'missing-api-key' });
            return;
        }
        const sreq = req;
        const statusQ = req.query.status ? String(req.query.status) : undefined;
        const allowed = [
            'unpaid',
            'paid',
            'partially_refunded',
            'refunded',
            'canceled',
            'expired',
        ];
        if (statusQ && !allowed.includes(statusQ)) {
            res.status(400).json({ error: 'bad_status' });
            return;
        }
        const rows = this.store.listInvoicesByStore(sreq.store.id, {
            status: statusQ,
            orderByCreatedDesc: true,
        });
        res.json(rows.map((r) => this.dtoMapper.invoiceToPublicDto(r)));
    }
    // ─────────────────────────────────────────────────────────────────────────────
    // CANCEL (builder): returns unsigned call (used first by the test)
    // Route: POST /api/v1/stores/:storeId/invoices/:invoiceId/cancel/create-tx
    // ─────────────────────────────────────────────────────────────────────────────
    async cancelInvoiceCreateTx(req, res) {
        const sreq = req;
        const idRaw = String(req.params.invoiceId);
        const invRow = this.store.invoices.findByStoreAndIdRaw(sreq.store.id, idRaw);
        if (!invRow) {
            res.status(404).end();
            return;
        }
        // Only unpaid & not expired are cancellable via builder/action
        if (invRow.status !== 'unpaid' || Number(invRow.expired ?? 0) === 1) {
            res.status(409).json({ error: 'not_cancellable' });
            return;
        }
        // Build unsigned on-chain cancel call
        this.codec.assertHex64(invRow.id_hex);
        const unsignedCall = this.builder.buildCancelInvoice({ idHex: invRow.id_hex });
        // If autobroadcast is enforced, broadcast and fail hard on errors
        try {
            const { txid } = await this.mustBroadcast(unsignedCall, sreq.store);
            // Only flip mirror *after* broadcast success
            this.store.markInvoiceCanceled(invRow.id_hex);
            const after = this.store.invoices.findByStoreAndIdRaw(sreq.store.id, idRaw);
            if (!after || after.status !== 'canceled') {
                res.status(409).json({ error: 'not_cancellable' });
                return;
            }
            res.json({ canceled: true, txid, unsignedCall });
        }
        catch (e) {
            if (e instanceof BroadcastFailed) {
                res.status(e.status).json({ error: e.code, detail: e.message });
                return;
            }
            throw e;
        }
    }
    // ─────────────────────────────────────────────────────────────────────────────
    // CANCEL (action): flips mirror row to canceled (fallback path in the test)
    // Route: POST /api/v1/stores/:storeId/invoices/:invoiceId/cancel
    // NOTE: store.markInvoiceCanceled(idHex) returns void -> re-read to verify
    // ─────────────────────────────────────────────────────────────────────────────
    async cancelInvoice(req, res) {
        const sreq = req;
        const idRaw = String(req.params.invoiceId);
        const invRow = this.store.invoices.findByStoreAndIdRaw(sreq.store.id, idRaw);
        if (!invRow) {
            res.status(404).end();
            return;
        }
        // Only unpaid & not expired are cancellable
        if (invRow.status !== 'unpaid' || Number(invRow.expired ?? 0) === 1) {
            res.status(409).json({ error: 'not_cancellable' });
            return;
        }
        // Perform DB-side cancel (void return -> cannot test truthiness)
        this.codec.assertHex64(invRow.id_hex);
        this.store.markInvoiceCanceled(invRow.id_hex);
        // Re-read row to confirm outcome; if not canceled, report conflict
        const after = this.store.invoices.findByStoreAndIdRaw(sreq.store.id, idRaw);
        if (!after || after.status !== 'canceled') {
            res.status(409).json({ error: 'not_cancellable' });
            return;
        }
        res.json({ canceled: true, invoiceId: idRaw });
    }
    // async getStoreProfile(req: Request, res: Response): Promise<void> {
    //   const sreq = req as AuthedRequest;
    //   const dto = this.dtoMapper.storeToPrivateProfile(sreq.store);
    //   res.json({
    //     ...dto,
    //     apiKey: sreq.store.stx_private_key ?? null,
    //     hmacSecret: sreq.store.hmac_secret ?? null,
    //   });
    // }
    // src/controllers/MerchantApiController.ts
    // src/controllers/MerchantApiController.ts
    async getStoreProfile(req, res) {
        // If the route is public (no auth), req.store is undefined.
        const storeId = String(req.params.storeId || '');
        const authed = !!req.store;
        // If authed, use the authenticated store (enjoy mask guarantees)
        if (authed) {
            const sreq = req;
            const dto = this.dtoMapper.storeToPrivateProfile(sreq.store);
            res.json({
                ...dto,
                stxPrivateKey: sreq.store.stx_private_key ?? null,
                hmacSecret: sreq.store.hmac_secret ?? null,
            });
            return;
        }
        // Public path: fetch from DB and emit a PUBLIC profile
        const row = this.store.getMerchantById(storeId);
        if (!row) {
            res.status(404).end();
            return;
        }
        // Use the public/profile-shape mapper (no secrets)
        const publicDto = this.dtoMapper.storeToPrivateProfile(row);
        res.json(publicDto);
    }
    async updateStoreProfile(req, res) {
        const sreq = req;
        const inb = (req.body ?? {});
        // accept both snake_case and camelCase
        const map = {
            name: 'name',
            display_name: 'display_name', displayName: 'display_name',
            logo_url: 'logo_url', logoUrl: 'logo_url',
            brand_color: 'brand_color', brandColor: 'brand_color',
            webhook_url: 'webhook_url', webhookUrl: 'webhook_url',
            support_email: 'support_email', supportEmail: 'support_email',
            support_url: 'support_url', supportUrl: 'support_url',
            allowed_origins: 'allowed_origins', allowedOrigins: 'allowed_origins',
            principal: 'principal'
        };
        const patch = {};
        for (const [k, v] of Object.entries(map)) {
            if (Object.prototype.hasOwnProperty.call(inb, k) && !(v in patch)) {
                patch[v] = inb[k];
            }
        }
        if (patch['brand_color'] !== undefined) {
            const color = String(patch['brand_color']);
            if (!rules_1.Validation.colorHex.test(color)) {
                res.status(400).json({ error: 'validation_error' });
                return;
            }
        }
        this.store.updateMerchantProfile(sreq.store.id, patch);
        if (inb["stx_private_key"]) {
            this.store.updateStxPrivateKey(sreq.store.id, inb["stx_private_key"]);
        }
        const updated = this.store.getMerchantById(sreq.store.id);
        const dto = this.dtoMapper.storeToPrivateProfile(updated);
        // include secrets in PATCH response too (test expects them)
        res.json({
            ...dto,
            apiKey: updated?.stx_private_key ?? null,
            hmacSecret: updated?.hmac_secret ?? null,
        });
    }
    async createInvoice(req, res) {
        try {
            const sreq = req;
            // inactive store should be blocked cleanly
            if (!(sreq.store?.active === 1 || sreq.store?.active === true)) {
                res.status(403).json({ error: 'inactive' });
                return;
            }
            const normalized = this.validateCreateInvoiceBody(req.body);
            // Service may return either a DB row or a ready PublicInvoiceDTO
            const out = await this.inv.createInvoice({ id: sreq.store.id, principal: sreq.store.principal }, normalized);
            // If service already returned a PublicInvoiceDTO, just return it (ensure magicLink)
            if (out && typeof out === 'object' && 'invoiceId' in out) {
                const resp = out.magicLink ? out : { ...out, magicLink: `/i/${out.invoiceId}` };
                res.json(this.jsonSafe(resp));
                return;
            }
            // Otherwise it's a DB row: map to DTO and synthesize magicLink
            const dto = this.dtoMapper.invoiceToPublicDto(out);
            const magicLink = `/i/${dto.invoiceId}`;
            res.json(this.jsonSafe({ ...dto, magicLink }));
        }
        catch (e) {
            if (e && (e.code === 'SQLITE_CONSTRAINT' || e.errno === 19)) {
                res.status(409).json({ error: 'conflict' });
                return;
            }
            if (e instanceof TypeError) {
                res.status(400).json({ error: 'validation_error' });
                return;
            }
            res.status(400).json({ error: 'validation_error' });
        }
    }
    validateCreateInvoiceBody(body) {
        const amountSats = Number(body?.amount_sats ?? body?.amountSats);
        const ttlSeconds = Number(body?.ttl_seconds ?? body?.ttlSeconds ?? 900);
        const memo = body?.memo !== undefined && body?.memo !== null ? String(body.memo) : undefined;
        const webhookUrl = body?.webhook_url !== undefined && body?.webhook_url !== null
            ? String(body.webhook_url)
            : undefined;
        this.inputValidator.assertPositiveInt(amountSats, 'amount_sats');
        this.inputValidator.assertPositiveInt(ttlSeconds, 'ttl_seconds');
        if (memo) {
            const bytes = Buffer.from(memo, 'utf8');
            if (bytes.length > 34)
                throw new TypeError('memo-too-long');
        }
        if (webhookUrl && !rules_1.Validation.url.test(webhookUrl)) {
            throw new TypeError('bad-webhook');
        }
        return { amountSats, ttlSeconds, memo, webhookUrl };
    }
    async buildRefund(req, res) {
        try {
            const sreq = req;
            const { invoiceId, amountSats, memo } = this.inputValidator.validateRefundBody(req.body);
            const invRow = this.store.invoices.findByStoreAndIdRaw(sreq.store.id, invoiceId);
            if (!invRow) {
                res.status(404).end();
                return;
            }
            try {
                const payload = await this.refundPolicy.enforceAndBuild(sreq.store, invRow, amountSats, memo);
                res.json(this.jsonSafe(payload));
            }
            catch (err) {
                const code = err?.code;
                if (code === 'bad_status' || code === 'cap_violation') {
                    res.status(409).json({ error: 'bad_status' });
                    return;
                }
                if (code === 'insufficient_balance') {
                    res.status(400).json({ error: 'insufficient_balance' });
                    return;
                }
                res.status(400).json({ error: 'validation_error' });
            }
        }
        catch {
            res.status(400).json({ error: 'validation_error' });
        }
    }
    // POST /api/v1/stores/:storeId/refunds/create-tx
    async buildRefundTx(req, res) {
        try {
            const sreq = req;
            const { invoiceId, amountSats, memo } = this.validateRefundBody((req.body ?? {}));
            const invRow = this.store.invoices.findByStoreAndIdRaw(sreq.store.id, invoiceId);
            if (!invRow) {
                res.status(404).json({ error: 'not_found' });
                return;
            }
            // Only already-paid (or partially_refunded) invoices are refundable
            const status = String(invRow.status ?? '').toLowerCase();
            if (!(status === 'paid' || status === 'partially_refunded')) {
                res.status(409).json({ error: 'invalid_state' });
                return;
            }
            // The RefundService already enforces refund cap and requires merchantPrincipal
            const unsigned = await this.refund.buildRefundPayload(sreq.store, invRow, amountSats, memo);
            // Enforce autobroadcast when enabled
            try {
                const { txid } = await this.mustBroadcast(unsigned, sreq.store);
                res.json(this.jsonSafe({ txid, unsignedCall: unsigned }));
            }
            catch (e) {
                if (e instanceof BroadcastFailed) {
                    res.status(e.status).json({ error: e.code, detail: e.message });
                    return;
                }
                throw e;
            }
        }
        catch {
            // Validation-style failures → 400 per Steroids
            res.status(400).json({ error: 'validation_error' });
        }
    }
    // Accept snake_case or camelCase via the validator; keep camelCase in the controller.
    validateRefundBody(body) {
        return this.inputValidator.validateRefundBody(body);
    }
    async updateStxPrivateKey(req, res) {
        const sreq = req;
        const { apiKey, hmacSecret } = this.generateSecrets();
        this.store.updateStxPrivateKey(sreq.store.id, apiKey);
        res.json({ apiKey, hmacSecret });
    }
    generateSecrets() {
        return {
            apiKey: crypto_1.default.randomBytes(32).toString('hex'),
            hmacSecret: crypto_1.default.randomBytes(32).toString('hex'),
        };
    }
    async buildDirectSubscriptionPaymentTx(req, res) {
        const sreq = req;
        const id = String(req.params.id);
        const sub = this.store.getSubscriptionByIdForStore(id, sreq.store.id);
        if (!sub) {
            res.status(404).end();
            return;
        }
        const payerPrincipal = String((req.body ?? {}).payerPrincipal ?? '');
        try {
            const payload = await this.directSubPayBuilder.assemble(sub, payerPrincipal, sreq.store.principal);
            res.json(this.jsonSafe(payload));
        }
        catch (err) {
            const code = err?.code;
            if (code === 'bad_status' || code === 'invalid_payer' || code === 'too_early') {
                res.status(409).json({ error: 'bad_status' });
                return;
            }
            if (code === 'missing_token') {
                res.status(422).json({ error: 'missingSbtcToken' });
                return;
            }
            res.status(400).json({ error: 'validation_error' });
        }
    }
    async createSubscription(req, res) {
        try {
            const sreq = req;
            const body = (req.body ?? {});
            const subscriber = String(body.subscriber ?? '');
            const amountSats = Number(body.amount_sats ?? body.amountSats);
            const intervalBlocks = Number(body.interval_blocks ?? body.intervalBlocks);
            const mode = body.mode ? String(body.mode) : undefined;
            if (!subscriber.trim()) {
                res.status(400).json({ error: 'validation_error' });
                return;
            }
            this.inputValidator.assertPositiveInt(amountSats, 'amount_sats');
            this.inputValidator.assertPositiveInt(intervalBlocks, 'interval_blocks');
            if (mode && !['invoice', 'direct'].includes(mode)) {
                res.status(400).json({ error: 'validation_error' });
                return;
            }
            const { row, unsignedCall } = await this.subs.createSubscription({ id: sreq.store.id, principal: sreq.store.principal }, { subscriber, amountSats, intervalBlocks, mode });
            const resp = {
                id: row.id,
                idHex: row.id_hex,
                storeId: row.store_id,
                merchantPrincipal: row.merchant_principal,
                subscriber: row.subscriber,
                amountSats: row.amount_sats,
                intervalBlocks: row.interval_blocks,
                active: row.active === 1,
                createdAt: row.created_at,
                lastBilledAt: row.last_billed_at,
                nextInvoiceAt: row.next_invoice_at,
                lastPaidInvoiceId: row.last_paid_invoice_id,
                mode: row.mode,
            };
            if (!unsignedCall) {
                res.json(resp);
                return;
            }
            // When autobroadcast is enabled, publish and return txid
            try {
                const { txid } = await this.mustBroadcast(unsignedCall, sreq.store);
                resp.txid = txid;
                resp.unsignedCall = this.jsonSafe(unsignedCall);
                res.json(resp);
            }
            catch (e) {
                if (e instanceof BroadcastFailed) {
                    res.status(e.status).json({ error: e.code, detail: e.message });
                    return;
                }
                throw e;
            }
        }
        catch {
            res.status(400).json({ error: 'validation_error' });
        }
    }
    async genSubscriptionInvoice(req, res) {
        try {
            const sreq = req;
            const id = String(req.params.id);
            const sub = this.store.getSubscriptionByIdForStore(id, sreq.store.id);
            if (!sub) {
                res.status(404).end();
                return;
            }
            if (!(sub.active === 1 && sub.mode === 'invoice')) {
                res.status(409).json({ error: 'bad_status' });
                return;
            }
            const body = (req.body ?? {});
            const ttlSeconds = Number(body.ttl_seconds ?? body.ttlSeconds ?? 900);
            const memo = body.memo !== undefined && body.memo !== null ? String(body.memo) : undefined;
            const webhookUrl = body.webhook_url !== undefined && body.webhook_url !== null
                ? String(body.webhook_url)
                : body.webhookUrl !== undefined && body.webhookUrl !== null
                    ? String(body.webhookUrl)
                    : undefined;
            if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
                res.status(400).json({ error: 'validation_error' });
                return;
            }
            if (memo) {
                const bytes = Buffer.from(memo, 'utf8');
                if (bytes.length > 34) {
                    res.status(400).json({ error: 'validation_error' });
                    return;
                }
            }
            if (webhookUrl && !rules_1.Validation.url.test(webhookUrl)) {
                res.status(400).json({ error: 'validation_error' });
                return;
            }
            const { invoice, unsignedCall } = await this.subs.generateInvoiceForSubscription(sub, {
                storeId: sreq.store.id,
                merchantPrincipal: sreq.store.principal,
                ttlSeconds,
                memo,
                webhookUrl,
            });
            try {
                // If your `invoice` object doesn’t carry id_hex, compute it from invoiceId (already hex).
                const invRow = this.store.getInvoiceWithStore(invoice.invoiceId);
                if (!invRow) {
                    return void res.status(404).json({ error: 'not_found' });
                }
                await this.ensureInvoiceOnChain(invRow, sreq.store);
            }
            catch (e) {
                if (e instanceof BroadcastFailed) {
                    return void res.status(e.status).json({ error: e.code, detail: e.message });
                }
                throw e;
            }
            const magicLink = `/i/${invoice.invoiceId}`;
            res.json({ invoice, magicLink, unsignedCall: this.jsonSafe(unsignedCall) });
        }
        catch (err) {
            const sreq = req;
            const id = String(req.params.id);
            const sub = this.store.getSubscriptionByIdForStore(id, sreq.store.id);
            const code = err?.code || err?.cause?.code;
            // Graceful degradation: if price is down, still create the invoice via InvoiceService
            if (code === 'price_unavailable') {
                try {
                    const created = await this.inv.createInvoice({ id: sreq.store.id, principal: sreq.store.principal }, {
                        amountSats: sub.amount_sats,
                        ttlSeconds: Number((req.body ?? {}).ttl_seconds ?? (req.body ?? {}).ttlSeconds ?? 900),
                        memo: (req.body ?? {}).memo,
                        webhookUrl: (req.body ?? {}).webhook_url ??
                            (req.body ?? {}).webhookUrl ??
                            undefined,
                    });
                    const magicLink = `/i/${created.invoiceId}`;
                    // Map InvoiceService's unsignedTx to the expected unsignedCall shape
                    res.json({
                        invoice: created,
                        magicLink,
                        unsignedCall: created.unsignedTx ?? undefined,
                    });
                    return;
                }
                catch {
                    // fall through to generic error if the fallback itself fails
                }
            }
            if (code === 'ETIMEDOUT') {
                res.status(502).json({ error: 'timeout' });
                return;
            }
            res.status(500).json({ error: 'server_error' });
        }
    }
    async setSubscriptionMode(req, res) {
        const sreq = req;
        const id = String(req.params.id);
        const sub = this.store.getSubscriptionByIdForStore(id, sreq.store.id);
        if (!sub) {
            res.status(404).end();
            return;
        }
        const body = (req.body ?? {});
        const mode = String(body.mode ?? '');
        if (!(mode === 'invoice' || mode === 'direct')) {
            res.status(400).json({ error: 'validation_error' });
            return;
        }
        const out = await this.subs.setMode(sub, mode);
        const resp = { id: out.row.id, mode: out.row.mode };
        if (!out.unsignedCall) {
            res.json(resp);
            return;
        }
        try {
            const { txid } = await this.mustBroadcast(out.unsignedCall, sreq.store);
            resp.txid = txid;
            resp.unsignedCall = this.jsonSafe(out.unsignedCall);
            res.json(resp);
        }
        catch (e) {
            if (e instanceof BroadcastFailed) {
                res.status(e.status).json({ error: e.code, detail: e.message });
                return;
            }
            throw e;
        }
    }
    async cancelSubscription(req, res) {
        const sreq = req;
        const id = String(req.params.id);
        const sub = this.store.getActiveSubscription(id, sreq.store.id);
        if (!sub) {
            res.status(404).end();
            return;
        }
        const out = await this.subs.cancel(sub);
        try {
            const { txid } = await this.mustBroadcast(out.unsignedCall, sreq.store);
            res.json({ txid, unsignedCall: this.jsonSafe(out.unsignedCall) });
        }
        catch (e) {
            if (e instanceof BroadcastFailed) {
                res.status(e.status).json({ error: e.code, detail: e.message });
                return;
            }
            throw e;
        }
    }
    async listWebhooks(req, res) {
        // guard: missing auth should be clean 401
        if (!req.store) {
            res.status(401).json({ error: 'missing-api-key' });
            return;
        }
        const sreq = req;
        const rows = this.store.listWebhooksForStore(sreq.store.id);
        res.json(rows.map((w) => this.dtoMapper.webhookToDto(w)));
    }
    /**
     * POST /api/v1/stores/:storeId/prepare-invoice
     * Body: { amount_sats, ttl_seconds, memo?, webhook_url?, payerPrincipal? }
     * Returns: { invoice, magicLink, unsignedCall, stacksPayURI }
     *
     * One-call “prepare”: create DTO invoice, build unsigned pay-invoice (with PCs), and StacksPay deeplink.
     */
    async prepareInvoice(req, res) {
        try {
            const sreq = req;
            // Block inactive merchants (spec behavior)
            if (!(sreq.store?.active === 1 || sreq.store?.active === true)) {
                res.status(403).json({ error: 'inactive' });
                return;
            }
            // Validate create-invoice body (amount/ttl/memo/webhook)
            const normalized = this.validateCreateInvoiceBody(req.body);
            // Optional: who will sign (used to scope post-conditions)
            const payerPrincipal = (req.body && req.body.payerPrincipal)
                ? String(req.body.payerPrincipal)
                : undefined;
            // 1) Create the invoice (DTO or DB row); keep public DTO + magicLink
            const out = await this.inv.createInvoice({ id: sreq.store.id, principal: sreq.store.principal }, normalized);
            const dto = 'invoiceId' in out
                ? out
                : this.dtoMapper.invoiceToPublicDto(out);
            // Get full row+store for builder
            const row = this.store.getInvoiceWithStore(dto.invoiceId);
            if (!row) {
                res.status(404).json({ error: 'not_found' });
                return;
            }
            // if (this.cfg.isAutoBroadcastOnChainEnabled()) {
            //   try {
            //     await this.ensureInvoiceOnChain(row, sreq.store);
            //   } catch (e) {
            //     if (e instanceof BroadcastFailed) {
            //       return void res.status(e.status).json({ error: e.code, detail: e.message });
            //     }
            //     throw e;
            //   }
            // }
            // 2) Build unsigned pay-invoice call (with fungible PCs)
            //    Harden: block when sBTC token isn't configured (422 like other builders)
            if (!this.cfg.getSbtcContractId()) {
                res.status(422).json({ error: 'missingSbtcToken' });
                return;
            }
            let unsignedCall;
            try {
                unsignedCall = await this.payTxAsm.buildUnsignedPayInvoice(row, payerPrincipal);
            }
            catch (e) {
                if (e instanceof PayInvoiceTxAssembler_1.HttpError) {
                    if (e.code === 'merchant-inactive') {
                        res.status(e.status).json({ error: 'invalidState' });
                        return;
                    }
                    if (e.code === 'expired') {
                        res.status(e.status).json({ error: 'expired' });
                        return;
                    }
                    if (e.code === 'missing-token') {
                        res.status(e.status).json({ error: 'missingSbtcToken' });
                        return;
                    }
                    if (e.code === 'invalid-id') {
                        res.status(e.status).json({ error: 'invalidId' });
                        return;
                    }
                }
                res.status(409).json({ error: 'invalidState' });
                return;
            }
            // 3) Build StacksPay deeplink (wallet-first QR)
            const appC = this.cfg.getContractId();
            const sbtc = this.cfg.getSbtcContractId();
            const tokenId = `${sbtc.contractAddress}.${sbtc.contractName}`;
            // For StacksPay "invoice", do NOT include contract fields.
            // Required: recipient, token, amount. Optional: description, expiresAt.
            const stacksPayURI = (0, stacks_pay_1.encodeStacksPayURL)({
                operation: 'invoice',
                recipient: String(row.store.principal ?? row.merchant_principal),
                token: tokenId,
                amount: String(dto.amountSats),
                description: dto.memo ?? undefined,
                expiresAt: new Date(dto.quoteExpiresAt).toISOString(),
            });
            // 4) Build signed `u` payload for the magic-link (short-lived)
            const expUnix = Math.floor(new Date(dto.quoteExpiresAt).getTime() / 1000); // TTL from created invoice
            const unsignedNorm = this.normalizeUnsigned(unsignedCall);
            // Guard: require per-store HMAC secret to sign `u`
            if (!sreq.store.hmac_secret) {
                res.status(422).json({ error: 'missingHmacSecret' });
                return;
            }
            const uPayload = {
                v: 1,
                storeId: String(sreq.store.id),
                invoiceId: String(dto.invoiceId),
                unsignedCall: {
                    contractId: unsignedNorm.contractId,
                    function: unsignedNorm.function,
                    args: unsignedNorm.args,
                    postConditions: unsignedNorm.postConditions,
                    postConditionMode: unsignedNorm.postConditionMode,
                    network: unsignedNorm.network,
                },
                exp: expUnix,
            };
            // Sign + embed signature (tamper-evidence); page will at least enforce exp
            const json = JSON.stringify(uPayload);
            const sig = this.hmacB64url(String(sreq.store.hmac_secret), json);
            const u = this.b64url(JSON.stringify({ ...uPayload, sig }));
            // Canonical magic-link: /w/<storeId>/<invoiceId>?u=...
            const base = `/w/${encodeURIComponent(String(sreq.store.id))}/${encodeURIComponent(String(dto.invoiceId))}`;
            const retParam = (req.body && req.body.return) ? `&return=${encodeURIComponent(String(req.body.return))}` : '';
            const magicLink = `${base}?u=${encodeURIComponent(u)}${retParam}`;
            // Response: everything the ecommerce/POS needs in one shot
            const payload = {
                invoice: dto,
                magicLink,
                unsignedCall: unsignedNorm, // JSON-safe: no BigInt; exact same fields
                stacksPayURI, // expose wallet-first deeplink
            };
            res.json((0, json_safe_1.toJsonSafe)(payload));
        }
        catch (err) {
            res.status(400).json({ error: 'validation_error' });
        }
    }
}
exports.MerchantApiController = MerchantApiController;
//# sourceMappingURL=MerchantApiController.js.map