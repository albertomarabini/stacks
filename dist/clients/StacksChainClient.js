"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StacksChainClient = void 0;
// src/clients/StacksChainClient.ts
const axios_1 = __importDefault(require("axios"));
const transactions_1 = require("@stacks/transactions");
const stacksNetworkPkg = __importStar(require("@stacks/network"));
const Net = stacksNetworkPkg.default ?? stacksNetworkPkg;
const { networkFromName } = Net;
const node_http_1 = __importDefault(require("node:http"));
const node_https_1 = __importDefault(require("node:https"));
/** Two-entry coalescer (per stream) */
class DuoCoalescer {
    constructor(emit) {
        this.emit = emit;
    }
    push(key, line) {
        if (this.last?.key === key) {
            this.last.count++;
            return;
        }
        if (this.prev?.key === key) {
            this.flushOne(this.last);
            this.last = { key, line: this.prev.line, count: this.prev.count + 1 };
            this.prev = undefined;
            return;
        }
        if (this.prev)
            this.flushOne(this.prev);
        this.prev = this.last;
        this.last = { key, line, count: 1 };
    }
    flushAll() { this.flushOne(this.prev); this.flushOne(this.last); this.prev = this.last = undefined; }
    flushOne(e) {
        if (!e)
            return;
        if (e.count <= 1)
            this.emit(e.line);
        else
            this.emit(`${e.line} … called x ${e.count} times`);
    }
}
class StacksChainClient {
    constructor(cfg) {
        //DEBUG: DO NOT TOUCH THIS!
        this.debug = String(process.env.GLOBAL_DEBUGGING || '') === '1';
        this.dlog = (..._a) => { return; };
        // Independent fold streams: HTTP vs CHAIN
        this.foldHTTP = new DuoCoalescer(line => this.dlog(line));
        this.foldCHAIN = new DuoCoalescer(line => this.dlog(line));
        this.initializeNetwork(cfg);
        this.probeExtendedApi().catch(() => { });
    }
    short(hexLike, n = 8) {
        const s = String(hexLike || '').replace(/^0x/, '');
        return s.slice(0, n);
    }
    pathOnly(u) {
        if (!u)
            return '';
        if (u.startsWith('/'))
            return u;
        try {
            const url = new URL(u, this.baseUrl);
            return url.pathname + (url.search || '');
        }
        catch {
            return u;
        }
    }
    cvFromTyped(a) {
        if (!a || typeof a !== 'object')
            throw new Error('cvFromTyped: bad arg');
        const t = String(a.type || '').toLowerCase();
        if (t === 'uint')
            return (0, transactions_1.uintCV)(BigInt(a.value));
        if (t === 'buffer') {
            const hex = String(a.value ?? '').replace(/^0x/i, '');
            return (0, transactions_1.bufferCV)(Buffer.from(hex, 'hex'));
        }
        if (t === 'contract') {
            const s = String(a.value || '');
            const [addr, name] = s.split('.', 2);
            return (0, transactions_1.contractPrincipalCV)(addr, name);
        }
        if (t === 'some')
            return (0, transactions_1.someCV)(this.cvFromTyped(a.value));
        if (t === 'none')
            return (0, transactions_1.noneCV)();
        if (t === 'true')
            return (0, transactions_1.trueCV)();
        if (t === 'false')
            return (0, transactions_1.falseCV)();
        if (t === 'address')
            return (0, transactions_1.standardPrincipalCV)(String(a.value));
        // Already CV-shaped? pass through
        if ('value' in a && 'type' in a)
            return a;
        throw new Error(`cvFromTyped: unsupported type ${t}`);
    }
    // Map string -> enum for AnchorMode/PostConditionMode
    toAnchorMode(s) {
        const t = String(s || '').toLowerCase();
        if (t === 'on_chain_only' || t === 'onchain' || t === 'onchainonly')
            return transactions_1.AnchorMode.OnChainOnly;
        if (t === 'off_chain_only' || t === 'offchain' || t === 'offchainonly')
            return transactions_1.AnchorMode.OffChainOnly;
        return transactions_1.AnchorMode.Any; // default
    }
    toPostConditionMode(s) {
        return String(s || '').toLowerCase() === 'allow' ? transactions_1.PostConditionMode.Allow : transactions_1.PostConditionMode.Deny;
    }
    // Add near other helpers
    async getTxStatus(txid) {
        const id = String(txid || '').toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(id))
            throw new Error('bad txid');
        return await this.getWithRetry(`/extended/v1/tx/${id}`);
    }
    // Parse "ST...contract::asset" -> { addr, name, asset }
    parseFtAsset(fq) {
        const [left, right] = String(fq).split('.', 2);
        const [name, asset] = String(right || '').split('::', 2);
        if (!left || !name || !asset)
            throw new Error(`bad FT asset identifier: ${fq}`);
        return { addr: left, name, asset };
    }
    // Convert builder-shaped PCs to v7 Pc instances (TS-safe)
    pcsFromUnsigned(unsigned) {
        const raw = unsigned?.postConditions || unsigned?.post_conditions || [];
        const out = [];
        for (const pc of raw) {
            if (!pc || typeof pc !== 'object')
                continue;
            const cond = String(pc.condition || '').toLowerCase();
            const amt = BigInt(String(pc.amount ?? 0));
            const who = String(pc.address || '');
            const codeStage = ((principal) => {
                switch (cond) {
                    case 'eq': return principal.willSendEq(amt);
                    case 'gt': return principal.willSendGt(amt);
                    case 'gte': return principal.willSendGte(amt);
                    case 'lt': return principal.willSendLt(amt);
                    case 'lte':
                    default: return principal.willSendLte(amt);
                }
            })(transactions_1.Pc.principal(who));
            if (pc.type === 'stx-postcondition') {
                out.push(codeStage.ustx());
                continue;
            }
            if (pc.type === 'ft-postcondition') {
                const { addr, name, asset } = this.parseFtAsset(String(pc.asset || ''));
                out.push(codeStage.ft(`${addr}.${name}`, asset));
                continue;
            }
            // (nft PCs etc. — add as needed)
        }
        return out;
    }
    // Sign + broadcast a contract call (honors PCs/network)
    // async signAndBroadcast(
    //   unsigned: {
    //     contractAddress: string;
    //     contractName: string;
    //     functionName: string;
    //     functionArgs?: any[];
    //     postConditions?: any[];
    //     post_conditions?: any[];
    //     postConditionMode?: 'allow' | 'deny';
    //     post_condition_mode?: 'allow' | 'deny';
    //     anchorMode?: AnchorCase;
    //     network?: NetworkName;
    //   },
    //   senderKeyHex: string,
    // ): Promise<{ txid: string }> {
    //   const args: ClarityValue[] = (unsigned.functionArgs || []).map(x => this.cvFromTyped(x));
    //   // pick network from unsigned if present; fallback to client default
    //   const netName = (unsigned.network as any) || this.network;
    //   const net = (Net as any).networkFromName ? (Net as any).networkFromName(netName) : networkFromName(netName);
    //   (net as any).client = (net as any).client ?? {};
    //   (net as any).client.baseUrl = this.baseUrl;
    //   if (this.debug) this.foldCHAIN.push('NET', `[NET] baseUrl=${(net as any).client.baseUrl}`);
    //   const postConditions = this.pcsFromUnsigned(unsigned);
    //   const postConditionMode =
    //     this.toPostConditionMode(unsigned.postConditionMode || (unsigned as any).post_condition_mode);
    //   // Accept both camel & snake; convert once here
    //   const anchorModeNorm = String(unsigned.anchorMode || 'any').toLowerCase();
    //   const anchorMode =
    //     anchorModeNorm === 'on_chain_only' || anchorModeNorm === 'onchainonly' || anchorModeNorm === 'onchain'
    //       ? AnchorMode.OnChainOnly
    //       : anchorModeNorm === 'off_chain_only' || anchorModeNorm === 'offchainonly' || anchorModeNorm === 'offchain'
    //       ? AnchorMode.OffChainOnly
    //       : AnchorMode.Any;
    //   const tx = await makeContractCall({
    //     contractAddress: unsigned.contractAddress,
    //     contractName: unsigned.contractName,
    //     functionName: unsigned.functionName,
    //     functionArgs: args,
    //     senderKey: senderKeyHex.replace(/^0x/i, '').slice(0, 64),
    //     network: net,
    //     postConditions,
    //     postConditionMode,
    //     // anchorMode is optional; omit unless you really require OffChainOnly/OnChainOnly
    //   });
    //   const res: any = await broadcastTransaction({ transaction: tx, network: net });
    //   if (res?.error || res?.reason) {
    //     const reason = res.reason || res.error;
    //     throw Object.assign(
    //       new Error(`broadcast failed: ${typeof reason === 'string' ? reason : JSON.stringify(res)}`),
    //       { result: res }
    //     );
    //   }
    //   const txid = String(res?.txid ?? res);
    //   return { txid };
    // }
    // DO NOT import '@stacks/connect' at top-level (will break SSR/CJS)
    // This file must only be imported in the browser (no ts-node/SSR).
    async signAndBroadcast(unsigned, merchantAddress) {
        // 0) Hard block server/SSR. If this throws at startup, this file is imported on the server.
        if (typeof window === 'undefined') {
            throw new Error('signAndBroadcast must run in the browser (wallet required). Move this call to client-only code.');
        }
        // 1) Dynamic import (ESM-safe). Prevents Node from require()-ing ESM on startup.
        const { request } = await Promise.resolve().then(() => __importStar(require('@stacks/connect')));
        // 2) Encode your existing args, then append merchant principal
        const baseArgs = (unsigned.functionArgs || []).map((x) => this.cvFromTyped(x));
        const argsWithMerchant = [...baseArgs, transactions_1.Cl.principal(merchantAddress)]; // address, not private key
        // 3) Normalize post-conditions + mode (camel/snake)
        const postConditions = (unsigned.postConditions ?? unsigned.post_conditions) || undefined;
        const postConditionMode = (unsigned.postConditionMode ?? unsigned.post_condition_mode ?? 'deny');
        // (Optional) You can build payer-safety post-conditions with Pc.* if needed. :contentReference[oaicite:5]{index=5}
        // 4) Ask wallet to sign + broadcast
        const res = await request('stx_callContract', {
            contract: `${unsigned.contractAddress}.${unsigned.contractName}`,
            functionName: unsigned.functionName,
            functionArgs: argsWithMerchant,
            ...(postConditions ? { postConditions } : {}),
            postConditionMode, // 'allow' | 'deny'
            network: unsigned.network ?? 'mainnet'
        });
        // 5) Normalize result and return
        const txid = String(res?.txid ?? res?.txId ?? res);
        if (!txid)
            throw new Error(`wallet did not return txid: ${JSON.stringify(res)}`);
        return { txid };
    }
    // ────────────────────────────────────────────────────────────────────────────
    // Transport resiliency
    // ────────────────────────────────────────────────────────────────────────────
    transientErr(e) {
        const code = e?.code || e?.response?.status;
        const msg = String(e?.message || '').toLowerCase();
        return (code === 'ECONNRESET' ||
            code === 'EPIPE' ||
            code === 'ETIMEDOUT' ||
            code === 'ECONNABORTED' ||
            msg.includes('timeout') ||
            msg.includes('socket hang up'));
    }
    async getWithRetry(path, opts = {}, retries = 4) {
        let lastErr;
        const sleep = (ms) => new Promise(res => setTimeout(res, ms));
        for (let i = 0; i <= retries; i++) {
            try {
                const r = await this.http.get(path, opts);
                return r.data;
            }
            catch (e) {
                lastErr = e;
                const status = e?.response?.status;
                const hdrs = e?.response?.headers || {};
                if (status === 429) {
                    // Prefer server-provided hints
                    const retryAfter = Number(hdrs['retry-after']); // seconds
                    const resetIn = Number(hdrs['x-ratelimit-reset']); // seconds
                    const waitMs = Number.isFinite(retryAfter)
                        ? retryAfter * 1000
                        : Number.isFinite(resetIn)
                            ? resetIn * 1000
                            : 500 * Math.pow(2, i); // fallback exponential
                    await sleep(waitMs);
                    continue;
                }
                if (!this.transientErr(e) || i === retries)
                    throw e;
                const backoff = 150 * Math.pow(2, i) + Math.floor(Math.random() * 200);
                await sleep(backoff);
            }
        }
        throw lastErr;
    }
    async postWithRetry(path, body, retries = 4) {
        let lastErr;
        const sleep = (ms) => new Promise(res => setTimeout(res, ms));
        for (let i = 0; i <= retries; i++) {
            try {
                const r = await this.http.post(path, body, { headers: { 'Content-Type': 'application/json' } });
                return r.data;
            }
            catch (e) {
                lastErr = e;
                const status = e?.response?.status;
                const hdrs = e?.response?.headers || {};
                if (status === 429) {
                    const retryAfter = Number(hdrs['retry-after']);
                    const resetIn = Number(hdrs['x-ratelimit-reset']);
                    const waitMs = Number.isFinite(retryAfter)
                        ? retryAfter * 1000
                        : Number.isFinite(resetIn)
                            ? resetIn * 1000
                            : 500 * Math.pow(2, i);
                    await sleep(waitMs);
                    continue;
                }
                if (!this.transientErr(e) || i === retries)
                    throw e;
                const backoff = 150 * Math.pow(2, i) + Math.floor(Math.random() * 200);
                await sleep(backoff);
            }
        }
        throw lastErr;
    }
    // 2a) Fallback for contracts that use get-invoice-status-v2 { id: (buff 32) }
    async readInvoiceStatusV2Fallback(idHex) {
        const clean = idHex.toLowerCase().replace(/^0x/, '');
        const key = (0, transactions_1.tupleCV)({ id: (0, transactions_1.bufferCV)(Buffer.from(clean, 'hex')) });
        const cv = await this.callReadOnly('get-invoice-status-v2', [key]);
        const j = (0, transactions_1.cvToJSON)(cv);
        const val = String(j?.value ?? '').toLowerCase();
        return (val || 'not-found');
    }
    // ────────────────────────────────────────────────────────────────────────────
    // Init
    // ────────────────────────────────────────────────────────────────────────────
    initializeNetwork(cfg) {
        const net = cfg.getNetwork() ?? 'testnet';
        const customApiUrl = (net === 'mainnet'
            ? 'https://api.hiro.so'
            : net === 'testnet'
                ? 'https://api.testnet.hiro.so'
                : 'http://localhost:3999');
        console.log(`[ChainClient] initialized on ${net} ${customApiUrl}`);
        const apiKey = cfg.getHiroAPIKey();
        this.network = net;
        this.baseUrl = String(customApiUrl).replace(/\/+$/, '');
        this.http = axios_1.default.create({
            baseURL: this.baseUrl,
            timeout: 20000,
            httpAgent: new node_http_1.default.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16 }),
            httpsAgent: new node_https_1.default.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16 }),
            maxRedirects: 5,
            proxy: false,
            headers: apiKey ? { 'x-api-key': apiKey } : undefined,
        });
        this.http.interceptors.request.use(cfg => {
            cfg._t = Date.now();
            if (this.debug) {
                const method = (cfg.method || 'GET').toUpperCase();
                const path = this.pathOnly(cfg.url || '');
                this.foldHTTP.push(`REQ:${method}:${path}`, `→ ${method} ${path}`);
            }
            return cfg;
        });
        if (this.debug) {
            this.dlog('init', { network: this.network, baseUrl: this.baseUrl });
            this.http.interceptors.request.use(cfg => {
                cfg._t = Date.now();
                const m = (cfg.method || 'GET').toUpperCase();
                const p = this.pathOnly(cfg.url || '');
                this.foldHTTP.push(`REQ:${m}:${p}`, `→ ${m} ${p}`);
                return cfg;
            });
            this.http.interceptors.response.use(res => {
                const dt = Date.now() - (res.config._t || Date.now());
                const m = (res.config.method || 'GET').toUpperCase();
                const p = this.pathOnly(res.config.url || '');
                this.foldHTTP.push(`RES:${m}:${p}:${res.status}`, `← ${res.status} ${m} ${p} ${dt}ms`);
                return res;
            }, err => {
                const cfg = err.config || {};
                const dt = Date.now() - (cfg._t || Date.now());
                const m = (cfg.method || 'GET').toUpperCase();
                const p = this.pathOnly(cfg.url || '');
                const st = err.response?.status || err.code || 'ERR';
                this.foldHTTP.push(`ERR:${m}:${p}:${st}`, `✗ ${st} ${m} ${p} ${dt}ms`);
                return Promise.reject(err);
            });
            process.once('beforeExit', () => { this.foldHTTP.flushAll(); this.foldCHAIN.flushAll(); });
        }
        const { contractAddress, contractName } = cfg.getContractId();
        this.contractAddress = contractAddress;
        this.contractName = contractName;
    }
    async probeExtendedApi() {
        const url = '/extended/v1/info';
        try {
            await this.getWithRetry(url, {}, 0);
            if (this.debug)
                this.foldCHAIN.push('EXT:ok', '[EXT] extended API present');
        }
        catch {
            if (this.debug)
                this.foldCHAIN.push('EXT:miss', '[EXT] extended API missing; poller will degrade gracefully');
        }
    }
    // ────────────────────────────────────────────────────────────────────────────
    // Read-only helpers (ABI-aligned)
    // ────────────────────────────────────────────────────────────────────────────
    async readAdminPrincipal() {
        const cv = await this.callReadOnly('get-admin', []);
        const j = (0, transactions_1.cvToJSON)(cv);
        return (j?.type === 'optional' && j.value) ? String(j.value) : undefined;
    }
    async callReadOnly(functionName, functionArgs) {
        const argsHex = (functionArgs ?? []).map(cv => (0, transactions_1.cvToHex)(cv));
        const url = `/v2/contracts/call-read/${this.contractAddress}/${this.contractName}/${functionName}?proof=0`;
        const body = { sender: this.contractAddress, arguments: argsHex };
        const resp = await this.postWithRetry(url, body);
        const resultHex = String(resp?.result ?? '');
        if (!resultHex.startsWith('0x'))
            throw new Error(`callReadOnly: bad result for ${functionName}`);
        return (0, transactions_1.hexToCV)(resultHex);
    }
    /**
     * Decode (optional (tuple …)) from `get-invoice`.
     */
    async readInvoice(idHex) {
        const clean = String(idHex || '').replace(/^0x/i, '').toLowerCase();
        if (clean.length !== 64 || /[^0-9a-f]/i.test(clean))
            return undefined;
        const toNumU = (x) => {
            if (x === null || x === undefined)
                return NaN;
            if (typeof x === 'number')
                return x;
            if (typeof x === 'bigint')
                return Number(x);
            if (typeof x === 'string')
                return Number(x.startsWith('u') ? x.slice(1) : x);
            if (typeof x === 'object') {
                if ('value' in x)
                    return toNumU(x.value);
                if ('repr' in x)
                    return toNumU(x.repr);
                const k = Object.keys(x)[0];
                return k ? toNumU(x[k]) : NaN;
            }
            return NaN;
        };
        const isKind = (j, kind) => {
            const t = j?.type;
            if (!t)
                return false;
            return t === kind || (typeof t === 'string' && t.toLowerCase().includes(kind));
        };
        const unwrap = (j0) => {
            let j = j0;
            if (isKind(j, 'response'))
                j = j.value ?? j.ok ?? j.err ?? j;
            if (isKind(j, 'optional')) {
                if (!('value' in j) || j.value == null)
                    return undefined;
                j = j.value;
            }
            if (isKind(j, 'tuple'))
                return j;
            if (isKind(j?.value, 'tuple'))
                return j.value;
            return j;
        };
        const asFields = (tupleNode) => {
            const v = tupleNode?.value ?? tupleNode;
            if (Array.isArray(v))
                return v;
            if (v && typeof v === 'object') {
                return Object.entries(v).map(([name, value]) => ({ name, value }));
            }
            return [];
        };
        const get = (fields, k) => fields.find((x) => (x?.name ?? x?.key) === k)?.value;
        try {
            const cv = await this.callReadOnly('get-invoice', [(0, transactions_1.bufferCV)(Buffer.from(clean, 'hex'))]);
            const tupleNode = unwrap((0, transactions_1.cvToJSON)(cv));
            if (!tupleNode)
                return undefined;
            const f = asFields(tupleNode);
            const amountCV = get(f, 'amount') ?? get(f, 'amount-sats') ?? get(f, 'amount_sats') ?? get(f, 'amountSats');
            const refundCV = get(f, 'refund-amount') ?? get(f, 'refund_amount') ?? get(f, 'refundAmount');
            const paidCV = get(f, 'paid');
            const canceledCV = get(f, 'canceled');
            const expiredCV = get(f, 'expired');
            const truthy = (x) => {
                const v = (x && typeof x === 'object' && 'value' in x) ? x.value : x;
                return v === true || v === 'true' || v === 'True' || v === 1 || v === '1';
            };
            const amountSats = toNumU(amountCV);
            const refundAmount = refundCV == null ? 0 : toNumU(refundCV);
            let status = 'unpaid';
            if (truthy(paidCV))
                status = 'paid';
            else if (truthy(canceledCV))
                status = 'canceled';
            else if (truthy(expiredCV))
                status = 'expired';
            const payerCV = get(f, 'payer');
            let payer;
            if (payerCV && payerCV.type === 'optional' && payerCV.value) {
                const inner = payerCV.value;
                payer = String(inner?.value ?? inner ?? '');
            }
            return {
                status,
                paidAtHeight: undefined,
                lastChangeHeight: undefined,
                lastTxId: undefined,
                refundAmount,
                amountSats,
                payer,
            };
        }
        catch { /* fall back */ }
        try {
            const j = await this.readInvoiceDirectMap(clean);
            if (!j)
                return undefined;
            const f = asFields(j);
            const amountCV = get(f, 'amount') ?? get(f, 'amount-sats') ?? get(f, 'amount_sats') ?? get(f, 'amountSats');
            const refundCV = get(f, 'refund-amount') ?? get(f, 'refund_amount') ?? get(f, 'refundAmount');
            const paidCV = get(f, 'paid');
            const canceledCV = get(f, 'canceled');
            const expiredCV = get(f, 'expired');
            const truthy = (x) => {
                const v = (x && typeof x === 'object' && 'value' in x) ? x.value : x;
                return v === true || v === 'true' || v === 'True' || v === 1 || v === '1';
            };
            const amountSats = toNumU(amountCV);
            const refundAmount = refundCV == null ? 0 : toNumU(refundCV);
            let status = 'unpaid';
            if (truthy(paidCV))
                status = 'paid';
            else if (truthy(canceledCV))
                status = 'canceled';
            else if (truthy(expiredCV))
                status = 'expired';
            return {
                status,
                paidAtHeight: undefined,
                lastChangeHeight: undefined,
                lastTxId: undefined,
                refundAmount,
                amountSats,
                payer: undefined,
            };
        }
        catch {
            return undefined;
        }
    }
    async readInvoiceStatus(idHex) {
        const clean = idHex.toLowerCase().replace(/^0x/, '');
        if (!/^[0-9a-f]{64}$/.test(clean))
            return 'not-found';
        try {
            const cv = await this.callReadOnly('get-invoice-status', [(0, transactions_1.bufferCV)(Buffer.from(clean, 'hex'))]);
            const j = (0, transactions_1.cvToJSON)(cv);
            const val = String(j?.value ?? '').toLowerCase();
            if (val)
                return val;
        }
        catch { /* fall through */ }
        try {
            const v2 = await this.readInvoiceStatusV2Fallback(clean);
            if (v2 !== 'not-found')
                return v2;
        }
        catch { /* ignore */ }
        return 'not-found';
    }
    async readInvoiceDirectMap(idHex) {
        const clean = idHex.toLowerCase().replace(/^0x/, '');
        if (!/^[0-9a-f]{64}$/.test(clean))
            return undefined;
        const keyCv = (0, transactions_1.tupleCV)({ id: (0, transactions_1.bufferCV)(Buffer.from(clean, 'hex')) });
        const keyHex = (0, transactions_1.cvToHex)(keyCv);
        const path = `/v2/map_entry/${this.contractAddress}/${this.contractName}/invoices?proof=0`;
        const out = await this.postWithRetry(path, JSON.stringify(keyHex));
        if (!out?.data)
            return undefined;
        const cv = (0, transactions_1.hexToCV)(String(out.data));
        const j = (0, transactions_1.cvToJSON)(cv);
        return j?.value || j;
    }
    async getStxBalance(principal) {
        const resp = await this.getWithRetry(`/extended/v1/address/${encodeURIComponent(principal)}/balances`);
        const stx = resp?.stx?.balance ?? '0';
        return BigInt(String(stx));
    }
    async readSbtcToken() {
        const cv = await this.callReadOnly('get-sbtc', []);
        const j = (0, transactions_1.cvToJSON)(cv);
        const p = (j && j.type === 'optional' && j.value) ? String(j.value) : '';
        if (!p.includes('.'))
            return undefined;
        const [contractAddress, contractName] = p.split('.', 2);
        return { contractAddress, contractName };
    }
    async readSubscription(idHex) {
        const clean = idHex.toLowerCase().replace(/^0x/, '');
        if (!/^[0-9a-f]{64}$/.test(clean))
            return undefined;
        const cv = await this.callReadOnly('get-subscription', [
            (0, transactions_1.bufferCV)(Buffer.from(clean, 'hex')),
        ]);
        const j = (0, transactions_1.cvToJSON)(cv);
        if (!j || j.type !== 'optional' || !j.value)
            return undefined;
        const tup = j.value.value ?? j.value;
        return {
            idHex,
            merchant: String(tup?.merchant?.value || ''),
            subscriber: String(tup?.subscriber?.value || ''),
            amountSats: BigInt(String(tup?.amount?.value ?? '0')),
            intervalBlocks: BigInt(String(tup?.['interval']?.value ?? tup?.['interval-blocks']?.value ?? '0')),
            nextDue: BigInt(String(tup?.['next-due']?.value ?? '0')),
            active: !!tup?.active?.value,
            lastPaid: tup?.['last-paid']?.type === 'optional' && tup['last-paid'].value
                ? BigInt(String(tup['last-paid'].value.value ?? tup['last-paid'].value))
                : undefined,
        };
    }
    // Tip helpers
    async getTip() {
        const fetchLatestFromList = async () => {
            const list = await this.getWithRetry('/extended/v1/block', { params: { limit: 1, offset: 0 } });
            const first = Array.isArray(list?.results) ? list.results[0] : undefined;
            if (!first)
                throw new Error('getTip: empty block list');
            return { height: Number(first.height), blockHash: String(first.hash) };
        };
        // wrap the initial /v2/info call
        let info;
        try {
            info = await this.getWithRetry('/v2/info');
        }
        catch {
            return await fetchLatestFromList();
        }
        const height = Number(info?.stacks_tip_height);
        if (!Number.isFinite(height) || height <= 0) {
            return await fetchLatestFromList();
        }
        try {
            const blk = await this.getWithRetry(`/extended/v1/block/by_height/${height}`);
            const blockHash = String(blk?.hash ?? blk?.data?.hash);
            if (!blockHash)
                return await fetchLatestFromList();
            return { height, blockHash };
        }
        catch (e) {
            if (e?.response?.status === 404 || this.transientErr(e)) {
                return await fetchLatestFromList();
            }
            throw e;
        }
    }
    async getTipHeight() {
        const tip = await this.getTip();
        return tip.height;
    }
    async getFungibleBalance(assetContract, principal) {
        const resp = await this.getWithRetry(`/extended/v1/address/${encodeURIComponent(principal)}/balances`);
        const tokens = resp?.fungible_tokens ?? {};
        const fqPrefix = `${assetContract.contractAddress}.${assetContract.contractName}::`;
        let balanceStr = '0';
        for (const [key, entry] of Object.entries(tokens)) {
            if (key.startsWith(fqPrefix)) {
                balanceStr = String(entry?.balance ?? '0');
                break;
            }
        }
        return BigInt(balanceStr);
    }
    async getContractCallEvents(params) {
        const contractId = `${this.contractAddress}.${this.contractName}`;
        const basePath = `/extended/v1/contract/${contractId}/events`;
        const pageLimit = Math.max(1, Math.min(200, params.limit ?? 50));
        const maxPages = Math.max(1, params.maxPages ?? 10);
        const out = [];
        let offset = 0;
        for (let page = 0; page < maxPages; page++) {
            const resp = await this.http.get(basePath, { params: { limit: pageLimit, offset } });
            const rows = Array.isArray(resp.data?.results) ? resp.data.results : [];
            if (!rows.length)
                break;
            for (const ev of rows) {
                const h = Number(ev?.block_height ?? ev?.tx?.block_height ?? NaN);
                if (!Number.isFinite(h) || h < params.fromHeight)
                    continue;
                out.push(ev);
            }
            offset += rows.length;
            if (rows.length < pageLimit)
                break;
        }
        return out;
    }
    async getBlockHeader(height) {
        const resp = await this.getWithRetry(`/extended/v1/block/by_height/${height}`);
        return {
            parent_block_hash: String(resp?.parent_block_hash ?? resp?.data?.parent_block_hash ?? ''),
            block_hash: String(resp?.hash ?? resp?.data?.hash ?? ''),
        };
    }
    // Planner wants this; returning false keeps registration in the plan (harmless).
    async isMerchantRegisteredOnChain(_principal) {
        return false;
    }
}
exports.StacksChainClient = StacksChainClient;
exports.default = StacksChainClient;
//# sourceMappingURL=StacksChainClient.js.map