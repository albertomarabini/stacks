"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminApiController = void 0;
const node_crypto_1 = require("node:crypto");
const AdminParamGuard_1 = require("../delegates/AdminParamGuard");
const AdminDtoProjector_1 = require("../delegates/AdminDtoProjector");
const MerchantKeyRotationService_1 = require("../delegates/MerchantKeyRotationService");
const MerchantOnchainSyncPlanner_1 = require("../delegates/MerchantOnchainSyncPlanner");
const WebhookAdminRetryService_1 = require("../delegates/WebhookAdminRetryService");
const MerchantCreationService_1 = require("../delegates/MerchantCreationService");
class AdminApiController {
    constructor() {
        this.paramGuard = new AdminParamGuard_1.AdminParamGuard();
        this.projector = new AdminDtoProjector_1.AdminDtoProjector();
        this.keyRotation = new MerchantKeyRotationService_1.MerchantKeyRotationService();
        this.syncPlanner = new MerchantOnchainSyncPlanner_1.MerchantOnchainSyncPlanner();
        this.webhookRetry = new WebhookAdminRetryService_1.WebhookAdminRetryService();
        this.merchantCreation = new MerchantCreationService_1.MerchantCreationService();
        // ───────────────────────────────────────────────────────────────────────────
        // JSON-safe, contract-aligned unsigned-call normalization
        // ───────────────────────────────────────────────────────────────────────────
        this.toTypedArg = (a) => {
            if (a == null)
                return a;
            // Already typed (sanitize nested)
            if (typeof a === 'object' && typeof a.type === 'string' && 'value' in a) {
                const t = a.type.toLowerCase();
                if (t === 'uint' || t === 'int')
                    return { type: t, value: String(a.value) };
                if (t === 'buffer') {
                    const v = a.value;
                    if (typeof v === 'string')
                        return { type: 'buffer', value: v.replace(/^0x/i, '') };
                    if (v instanceof Uint8Array)
                        return { type: 'buffer', value: Buffer.from(v).toString('hex') };
                    if (Buffer.isBuffer?.(v))
                        return { type: 'buffer', value: v.toString('hex') };
                    return { type: 'buffer', value: String(v) };
                }
                if (t === 'contract')
                    return { type: 'contract', value: String(a.value) };
                if (t === 'some')
                    return { type: 'some', value: this.toTypedArg(a.value) };
                if (t === 'none')
                    return { type: 'none' };
                if (t === 'true' || t === 'false')
                    return { type: t };
                return { type: String(a.type), value: a.value };
            }
            // Raw bigint/number → uint typed arg (contract uses uints for amount/height)
            if (typeof a === 'bigint')
                return { type: 'uint', value: a.toString() };
            if (typeof a === 'number')
                return { type: 'uint', value: String(a) };
            // Buffers → buffer typed arg
            if (Buffer.isBuffer?.(a))
                return { type: 'buffer', value: a.toString('hex') };
            if (a instanceof Uint8Array)
                return { type: 'buffer', value: Buffer.from(a).toString('hex') };
            // Contract principal via fields
            if (typeof a === 'object') {
                const addr = a?.contractAddress ?? a?.address;
                const name = a?.contractName ?? a?.name;
                if (addr && name)
                    return { type: 'contract', value: `${addr}.${name}` };
            }
            // 64-hex → treat as buffer (invoice id)
            if (typeof a === 'string' && /^[0-9a-fA-F]{64}$/.test(a.replace(/^0x/i, ''))) {
                return { type: 'buffer', value: a.replace(/^0x/i, '').toLowerCase() };
            }
            // Otherwise leave as-is (string memo, etc.) — callers should prefer typed form.
            return a;
        };
        this.toPostCondition = (pc) => ({
            type: 'ft-postcondition',
            address: String(pc?.address ?? ''),
            condition: String(pc?.condition ?? 'gte'),
            amount: String(pc?.amount ?? ''),
            asset: String(pc?.asset ?? ''), // "ADDR.contract::sbtc"
        });
        this.normalizeUnsignedCall = (raw) => ({
            contractAddress: String(raw.contractAddress ?? raw.address ?? ''),
            contractName: String(raw.contractName ?? raw.name ?? ''),
            functionName: String(raw.functionName ?? raw.fn ?? ''),
            functionArgs: Array.isArray(raw.functionArgs ?? raw.args)
                ? (raw.functionArgs ?? raw.args).map(this.toTypedArg)
                : [],
            network: String(raw.network ?? this.chain?.networkName ?? ''), // "devnet"/"testnet"/"mainnet"
            anchorMode: 'any',
            postConditionMode: 'deny',
            postConditions: Array.isArray(raw.postConditions ?? raw.pcs)
                ? (raw.postConditions ?? raw.pcs).map(this.toPostCondition)
                : [],
        });
    }
    bindDependencies(deps) {
        this.store = deps.store;
        this.chain = deps.chain;
        this.builder = deps.builder;
        this.dispatcher = deps.dispatcher;
        this.pollerBridge = deps.pollerBridge;
    }
    async bootstrapAdmin(req, res) {
        const callRaw = this.builder.buildBootstrapAdmin(); // add this builder if missing
        const call = this.normalizeUnsignedCall(callRaw);
        res.json({ call });
    }
    async createStore(req, res) {
        try {
            const body = (req.body && typeof req.body === 'object') ? req.body : {};
            const principal = String(body.principal ?? '').trim();
            if (!principal) {
                res.status(400).json({ error: 'principal-required' });
                return;
            }
            try {
                this.paramGuard.assertStacksPrincipal(principal); // format check (SP… or ST…)
            }
            catch {
                res.status(400).json({ error: 'principal-invalid' });
                return;
            }
            const result = await this.merchantCreation.create(this.store, { ...body, principal });
            if (result.status === 'conflict') {
                res.status(409).end();
                return;
            }
            res.status(201).json(result.dto);
        }
        catch (err) {
            const msg = String(err?.message || "");
            if (err?.code === "SQLITE_CONSTRAINT_UNIQUE" && msg.includes("merchants.principal")) {
                res.status(409).json({ error: "principal-already-exists" });
                return;
            }
            throw err;
        }
    }
    async listStores(_req, res) {
        const rows = this.store.listMerchantsProjection();
        res.json(rows.map((r) => this.projector.merchantToDto(r)));
    }
    // POST /api/admin/stores/:storeId/rotate-keys
    async rotateKeys(req, res) {
        const storeId = String(req.params.storeId ?? '');
        const m = this.store.getMerchantById(storeId);
        if (!m) {
            res.status(404).json({ error: 'store-not-found' });
            return;
        }
        const now = Math.floor(Date.now() / 1000);
        const lastRotated = m.keys_last_rotated_at ?? 0;
        if (now - lastRotated < 60) {
            res.status(409).json({ error: 'already-rotated' });
            return;
        }
        const apiKey = (0, node_crypto_1.randomBytes)(32).toString('hex');
        const hmacSecret = (0, node_crypto_1.randomBytes)(32).toString('hex');
        const version = this.store.rotateKeysPersist(storeId, apiKey, hmacSecret, now);
        const marked = this.store.markKeysRevealedOnce(storeId, version, now);
        if (!marked) {
            res.status(409).json({ error: 'already-revealed' });
            return;
        }
        res.status(200).json({ apiKey, hmacSecret });
    }
    // Normalize calls before JSON to avoid BigInt and match typed-arg shape.
    async syncOnchain(req, res) {
        const storeId = String(req.params.storeId);
        this.paramGuard.assertUuid(storeId);
        const result = await this.syncPlanner.planForStore(this.store, this.chain, this.builder, storeId);
        if ('notFound' in result) {
            res.status(404).end();
            return;
        }
        const calls = Array.isArray(result.calls)
            ? result.calls.map((c) => this.normalizeUnsignedCall(c))
            : [];
        res.json({ calls });
    }
    async setSbtcToken(req, res) {
        const body = (req.body || {});
        const contractAddress = String(body.contractAddress ?? '');
        const contractName = String(body.contractName ?? '');
        this.paramGuard.assertStacksPrincipal(contractAddress);
        if (!contractName) {
            res.status(400).end();
            return;
        }
        const callRaw = this.builder.buildSetSbtcToken({ contractAddress, contractName });
        const call = this.normalizeUnsignedCall(callRaw);
        res.json({ call });
    }
    async cancelInvoice(req, res) {
        const invoiceId = String(req.params.invoiceId);
        this.paramGuard.assertUuid(invoiceId);
        const row = this.store.getInvoiceById(invoiceId);
        if (!row) {
            res.status(404).end();
            return;
        }
        if (row.status === 'paid') {
            res.status(400).json({ error: 'already_paid' });
            return;
        }
        this.store.updateInvoiceStatus(invoiceId, 'canceled');
        res.json({ canceled: true, invoiceId });
    }
    async activateStore(req, res) {
        const storeId = String(req.params.storeId);
        this.paramGuard.assertUuid(storeId);
        const active = !!(req.body && req.body.active);
        this.store.updateMerchantActive(storeId, active);
        const rows = this.store.listMerchantsProjection();
        const m = rows.find((r) => r.id === storeId);
        res.json(m ? this.projector.merchantToDto(m) : undefined);
    }
    async listAdminInvoices(req, res) {
        const statuses = this.paramGuard.parseInvoiceStatuses(req.query.status);
        const storeId = req.query.storeId ? String(req.query.storeId) : undefined;
        if (storeId)
            this.paramGuard.assertUuid(storeId);
        const rows = this.store.selectAdminInvoices(statuses.length ? statuses : undefined, storeId);
        res.json(rows.map((r) => this.projector.invoiceToDto(r)));
    }
    async retryWebhook(req, res) {
        const body = (req.body || {});
        const webhookLogId = String(body.webhookLogId ?? '');
        this.paramGuard.assertUuid(webhookLogId);
        const outcome = await this.webhookRetry.retry(this.store, this.dispatcher, webhookLogId);
        if (outcome.type === 'not-found') {
            res.status(404).end();
            return;
        }
        if (outcome.type === 'already-delivered') {
            res.status(200).json({ alreadyDelivered: true });
            return;
        }
        res.status(202).json({ enqueued: outcome.enqueued });
    }
    async getPoller(_req, res) {
        const s = this.pollerBridge.getState();
        res.json({
            running: this.pollerBridge.isActive(),
            lastRunAt: s.lastRunAt ?? null,
            lastHeight: s.lastHeight ?? 0,
            lastTxId: s.lastTxId ?? null,
            lagBlocks: s.lagBlocks ?? null,
        });
    }
    async restartPoller(_req, res) {
        const out = this.pollerBridge.restart();
        res.json(out);
    }
    async listWebhooks(req, res) {
        const q = (req.query || {});
        const storeId = q.storeId ? String(q.storeId) : undefined;
        if (storeId)
            this.paramGuard.assertUuid(storeId);
        const failedOnly = String(q.status ?? 'all') === 'failed';
        const rows = this.store.listAdminWebhooks(storeId, failedOnly);
        res.json(rows.map((w) => this.projector.webhookToDto(w)));
    }
    async listInvoices(req, res) {
        const storeId = String((req.query || {}).storeId ?? '');
        if (!storeId) {
            res.json([]);
            return;
        }
        this.paramGuard.assertUuid(storeId);
        const rawStatus = String((req.query || {}).status ?? '').trim();
        const status = (rawStatus ? rawStatus : undefined);
        const rows = this.store.listInvoicesByStore(storeId, {
            status,
            orderByCreatedDesc: true,
        });
        res.json(rows.map(r => this.projector.invoiceToDto(r)));
    }
}
exports.AdminApiController = AdminApiController;
//# sourceMappingURL=AdminApiController.js.map