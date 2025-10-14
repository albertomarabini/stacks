// src/clients/StacksChainClient.ts
import axios, { AxiosInstance } from 'axios';
import {
  makeContractCall,
  broadcastTransaction,
  AnchorMode,
  PostConditionMode,
  Pc,
  contractPrincipalCV,
  bufferCV,
  uintCV,
  someCV,
  noneCV,
  trueCV,
  falseCV,
  cvToJSON,
  cvToHex,
  hexToCV,
  standardPrincipalCV,
  tupleCV,
  makeUnsignedContractCall,
  Cl,
} from '@stacks/transactions';
import * as stacksNetworkPkg from '@stacks/network';
import type { ClarityValue } from '@stacks/transactions';


const Net = (stacksNetworkPkg as any).default ?? stacksNetworkPkg;
const { networkFromName } = Net;

import type { IStacksChainClient, IConfigService } from '../contracts/interfaces';
import type { AnchorCase, NetworkName, OnChainSubscription } from '../contracts/domain';
import http from 'node:http';
import https from 'node:https';

/** Two-entry coalescer (per stream) */
class DuoCoalescer {
  private last?: { key: string; line: string; count: number };
  private prev?: { key: string; line: string; count: number };
  constructor(private emit: (line: string) => void) {}
  push(key: string, line: string) {
    if (this.last?.key === key) { this.last.count++; return; }
    if (this.prev?.key === key) { this.flushOne(this.last); this.last = { key, line: this.prev.line, count: this.prev.count + 1 }; this.prev = undefined; return; }
    if (this.prev) this.flushOne(this.prev);
    this.prev = this.last;
    this.last = { key, line, count: 1 };
  }
  flushAll() { this.flushOne(this.prev); this.flushOne(this.last); this.prev = this.last = undefined; }
  private flushOne(e?: { key: string; line: string; count: number }) {
    if (!e) return;
    if (e.count <= 1) this.emit(e.line);
    else this.emit(`${e.line} … called x ${e.count} times`);
  }
}

export class StacksChainClient implements IStacksChainClient {
  private network!: NetworkName;
  private baseUrl!: string;
  private http!: AxiosInstance;

  private contractAddress!: string;
  private contractName!: string;

  //DEBUG: DO NOT TOUCH THIS!
  private debug = String(process.env.GLOBAL_DEBUGGING || '') === '1';
  private dlog = (..._a: any[]) => { return; };

  // Independent fold streams: HTTP vs CHAIN
  private foldHTTP = new DuoCoalescer(line => this.dlog(line));
  private foldCHAIN = new DuoCoalescer(line => this.dlog(line));

  constructor(cfg: IConfigService) {
    this.initializeNetwork(cfg);
    this.probeExtendedApi().catch(() => {});
  }

  private short(hexLike: string | undefined, n = 8): string {
    const s = String(hexLike || '').replace(/^0x/, '');
    return s.slice(0, n);
  }
  private pathOnly(u?: string): string {
    if (!u) return '';
    if (u.startsWith('/')) return u;
    try { const url = new URL(u, this.baseUrl); return url.pathname + (url.search || ''); } catch { return u; }
  }

  private cvFromTyped(a: any): ClarityValue {
    if (!a || typeof a !== 'object') throw new Error('cvFromTyped: bad arg');
    const t = String(a.type || '').toLowerCase();

    if (t === 'uint')   return uintCV(BigInt(a.value));
    if (t === 'buffer') {
      const hex = String(a.value ?? '').replace(/^0x/i, '');
      return bufferCV(Buffer.from(hex, 'hex'));
    }
    if (t === 'contract') {
      const s = String(a.value || '');
      const [addr, name] = s.split('.', 2);
      return contractPrincipalCV(addr, name);
    }
    if (t === 'some')   return someCV(this.cvFromTyped(a.value));
    if (t === 'none')   return noneCV();
    if (t === 'true')   return trueCV();
    if (t === 'false')  return falseCV();
    if (t === 'address') return standardPrincipalCV(String(a.value));

    // Already CV-shaped? pass through
    if ('value' in a && 'type' in a) return a as any;

    throw new Error(`cvFromTyped: unsupported type ${t}`);
  }

  // Map string -> enum for AnchorMode/PostConditionMode
  private toAnchorMode(s?: string) {
    const t = String(s || '').toLowerCase();
    if (t === 'on_chain_only' || t === 'onchain' || t === 'onchainonly') return AnchorMode.OnChainOnly;
    if (t === 'off_chain_only' || t === 'offchain' || t === 'offchainonly') return AnchorMode.OffChainOnly;
    return AnchorMode.Any; // default
  }
  private toPostConditionMode(s?: string) {
    return String(s || '').toLowerCase() === 'allow' ? PostConditionMode.Allow : PostConditionMode.Deny;
  }

  // Add near other helpers
  async getTxStatus(txid: string): Promise<{
    tx_id: string;
    tx_status: 'pending'|'success'|'abort_by_response'|'failed'|'dropped_replace_by_fee'|string;
    block_height?: number;
    receipt_time?: number;
    tx_result?: any;
  }> {
    const id = String(txid || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(id)) throw new Error('bad txid');
    return await this.getWithRetry(`/extended/v1/tx/${id}`);
  }

  // Parse "ST...contract::asset" -> { addr, name, asset }
  private parseFtAsset(fq: string): { addr: string; name: string; asset: string } {
    const [left, right] = String(fq).split('.', 2);
    const [name, asset] = String(right || '').split('::', 2);
    if (!left || !name || !asset) throw new Error(`bad FT asset identifier: ${fq}`);
    return { addr: left, name, asset };
  }

  // Convert builder-shaped PCs to v7 Pc instances (TS-safe)
  private pcsFromUnsigned(unsigned: any): any[] {
    const raw = unsigned?.postConditions || unsigned?.post_conditions || [];
    const out: any[] = [];
    for (const pc of raw) {
      if (!pc || typeof pc !== 'object') continue;
      const cond = String(pc.condition || '').toLowerCase();
      const amt  = BigInt(String(pc.amount ?? 0));
      const who  = String(pc.address || '');

      const codeStage = ((principal) => {
        switch (cond) {
          case 'eq':  return principal.willSendEq(amt);
          case 'gt':  return principal.willSendGt(amt);
          case 'gte': return principal.willSendGte(amt);
          case 'lt':  return principal.willSendLt(amt);
          case 'lte':
          default:    return principal.willSendLte(amt);
        }
      })(Pc.principal(who));

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



  async signAndBroadcast(
    unsigned: {
      contractAddress: string;
      contractName: string;
      functionName: string;
      functionArgs?: any[];
      postConditions?: any[];
      post_conditions?: any[];
      postConditionMode?: 'allow' | 'deny';
      post_condition_mode?: 'allow' | 'deny';
      anchorMode?: AnchorCase; // ignored by wallet
      network?: NetworkName;
    },
    merchantAddress: string,
  ): Promise<{ txid: string }> {
    // 0) Hard block server/SSR. If this throws at startup, this file is imported on the server.
    if (typeof window === 'undefined') {
      throw new Error('signAndBroadcast must run in the browser (wallet required). Move this call to client-only code.');
    }

    // 1) Dynamic import (ESM-safe). Prevents Node from require()-ing ESM on startup.
    const { request } = await import('@stacks/connect');

    // 2) Encode your existing args, then append merchant principal
    const baseArgs: ClarityValue[] = (unsigned.functionArgs || []).map((x: any) => (this as any).cvFromTyped(x));
    const argsWithMerchant: ClarityValue[] = [...baseArgs, Cl.principal(merchantAddress)]; // address, not private key

    // 3) Normalize post-conditions + mode (camel/snake)
    const postConditions = (unsigned.postConditions ?? (unsigned as any).post_conditions) || undefined;
    const postConditionMode = (unsigned.postConditionMode ?? (unsigned as any).post_condition_mode ?? 'deny');

    // (Optional) You can build payer-safety post-conditions with Pc.* if needed. :contentReference[oaicite:5]{index=5}

    // 4) Ask wallet to sign + broadcast
    const res: any = await request('stx_callContract', {
      contract: `${unsigned.contractAddress}.${unsigned.contractName}`,
      functionName: unsigned.functionName,
      functionArgs: argsWithMerchant,
      ...(postConditions ? { postConditions } : {}),
      postConditionMode,               // 'allow' | 'deny'
      network: unsigned.network ?? 'mainnet'
    });

    // 5) Normalize result and return
    const txid = String(res?.txid ?? res?.txId ?? res);
    if (!txid) throw new Error(`wallet did not return txid: ${JSON.stringify(res)}`);
    return { txid };
  }




  // ────────────────────────────────────────────────────────────────────────────
  // Transport resiliency
  // ────────────────────────────────────────────────────────────────────────────
  private transientErr(e: any): boolean {
    const code = e?.code || e?.response?.status;
    const msg = String(e?.message || '').toLowerCase();
    return (
      code === 'ECONNRESET' ||
      code === 'EPIPE' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNABORTED' ||
      msg.includes('timeout') ||
      msg.includes('socket hang up')
    );
  }

  private async getWithRetry<T = any>(path: string, opts: { params?: any } = {}, retries = 4): Promise<T> {
    let lastErr: any;
    const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
    for (let i = 0; i <= retries; i++) {
      try {
        const r = await this.http.get(path, opts);
        return r.data as T;
      } catch (e: any) {
        lastErr = e;
        const status = e?.response?.status;
        const hdrs = e?.response?.headers || {};
        if (status === 429) {
          // Prefer server-provided hints
          const retryAfter = Number(hdrs['retry-after']);                 // seconds
          const resetIn = Number(hdrs['x-ratelimit-reset']);              // seconds
          const waitMs = Number.isFinite(retryAfter)
            ? retryAfter * 1000
            : Number.isFinite(resetIn)
              ? resetIn * 1000
              : 500 * Math.pow(2, i); // fallback exponential
          await sleep(waitMs);
          continue;
        }
        if (!this.transientErr(e) || i === retries) throw e;
        const backoff = 150 * Math.pow(2, i) + Math.floor(Math.random() * 200);
        await sleep(backoff);
      }
    }
    throw lastErr;
  }

  private async postWithRetry<T = any>(path: string, body: any, retries = 4): Promise<T> {
    let lastErr: any;
    const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
    for (let i = 0; i <= retries; i++) {
      try {
        const r = await this.http.post(path, body, { headers: { 'Content-Type': 'application/json' } });
        return r.data as T;
      } catch (e: any) {
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
        if (!this.transientErr(e) || i === retries) throw e;
        const backoff = 150 * Math.pow(2, i) + Math.floor(Math.random() * 200);
        await sleep(backoff);
      }
    }
    throw lastErr;
  }


  // 2a) Fallback for contracts that use get-invoice-status-v2 { id: (buff 32) }
  private async readInvoiceStatusV2Fallback(idHex: string): Promise<'not-found' | 'paid' | 'canceled' | 'expired' | 'unpaid'> {
    const clean = idHex.toLowerCase().replace(/^0x/, '');
    const key = tupleCV({ id: bufferCV(Buffer.from(clean, 'hex')) });
    const cv = await this.callReadOnly('get-invoice-status-v2', [key]);
    const j: any = cvToJSON(cv);
    const val = String(j?.value ?? '').toLowerCase();
    return (val || 'not-found') as any;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Init
  // ────────────────────────────────────────────────────────────────────────────
  initializeNetwork(cfg: IConfigService): void {
    const net = (cfg.getNetwork() as NetworkName) ?? 'testnet';
    const customApiUrl = (net === 'mainnet'
        ? 'https://api.hiro.so'
        : net === 'testnet'
          ? 'https://api.testnet.hiro.so'
          : 'http://localhost:3999');
    console.log(`[ChainClient] initialized on ${net} ${customApiUrl}`);
    const apiKey = cfg.getHiroAPIKey()

    this.network = net;
    this.baseUrl = String(customApiUrl).replace(/\/+$/, '');

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: 20_000,
      httpAgent: new http.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16 }),
      httpsAgent: new https.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 16 }),
      maxRedirects: 5,
      proxy: false,
      headers: apiKey ? { 'x-api-key': apiKey } : undefined,
    });

    this.http.interceptors.request.use(cfg => {
      (cfg as any)._t = Date.now();
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
        (cfg as any)._t = Date.now();
        const m = (cfg.method || 'GET').toUpperCase();
        const p = this.pathOnly(cfg.url || '');
        this.foldHTTP.push(`REQ:${m}:${p}`, `→ ${m} ${p}`);
        return cfg;
      });
      this.http.interceptors.response.use(
        res => {
          const dt = Date.now() - ((res.config as any)._t || Date.now());
          const m = (res.config.method || 'GET').toUpperCase();
          const p = this.pathOnly(res.config.url || '');
          this.foldHTTP.push(`RES:${m}:${p}:${res.status}`, `← ${res.status} ${m} ${p} ${dt}ms`);
          return res;
        },
        err => {
          const cfg = err.config || {};
          const dt = Date.now() - ((cfg as any)._t || Date.now());
          const m = (cfg.method || 'GET').toUpperCase();
          const p = this.pathOnly(cfg.url || '');
          const st = err.response?.status || err.code || 'ERR';
          this.foldHTTP.push(`ERR:${m}:${p}:${st}`, `✗ ${st} ${m} ${p} ${dt}ms`);
          return Promise.reject(err);
        }
      );
      process.once('beforeExit', () => { this.foldHTTP.flushAll(); this.foldCHAIN.flushAll(); });
    }

    const { contractAddress, contractName } = cfg.getContractId();
    this.contractAddress = contractAddress;
    this.contractName = contractName;
  }

  private async probeExtendedApi() {
    const url = '/extended/v1/info';
    try {
      await this.getWithRetry(url, {}, 0);
      if (this.debug) this.foldCHAIN.push('EXT:ok', '[EXT] extended API present');
    } catch {
      if (this.debug) this.foldCHAIN.push('EXT:miss', '[EXT] extended API missing; poller will degrade gracefully');
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Read-only helpers (ABI-aligned)
  // ────────────────────────────────────────────────────────────────────────────

  async readAdminPrincipal() {
    const cv = await this.callReadOnly('get-admin', []);
    const j: any = cvToJSON(cv);
    return (j?.type === 'optional' && j.value) ? String(j.value) : undefined;
  }

  async callReadOnly(functionName: string, functionArgs: ClarityValue[]): Promise<ClarityValue> {
    const argsHex = (functionArgs ?? []).map(cv => cvToHex(cv));
    const url = `/v2/contracts/call-read/${this.contractAddress}/${this.contractName}/${functionName}?proof=0`;
    const body = { sender: this.contractAddress, arguments: argsHex };
    const resp: any = await this.postWithRetry(url, body);
    const resultHex: string = String(resp?.result ?? '');
    if (!resultHex.startsWith('0x')) throw new Error(`callReadOnly: bad result for ${functionName}`);
    return hexToCV(resultHex);
  }

  /**
   * Decode (optional (tuple …)) from `get-invoice`.
   */
  async readInvoice(idHex: string) {
    const clean = String(idHex || '').replace(/^0x/i, '').toLowerCase();
    if (clean.length !== 64 || /[^0-9a-f]/i.test(clean)) return undefined;

    const toNumU = (x: any): number => {
      if (x === null || x === undefined) return NaN;
      if (typeof x === 'number') return x;
      if (typeof x === 'bigint') return Number(x);
      if (typeof x === 'string') return Number(x.startsWith('u') ? x.slice(1) : x);
      if (typeof x === 'object') {
        if ('value' in x) return toNumU((x as any).value);
        if ('repr'  in x) return toNumU((x as any).repr);
        const k = Object.keys(x)[0];
        return k ? toNumU((x as any)[k]) : NaN;
      }
      return NaN;
    };

    const isKind = (j: any, kind: 'response' | 'optional' | 'tuple') => {
      const t = j?.type;
      if (!t) return false;
      return t === kind || (typeof t === 'string' && t.toLowerCase().includes(kind));
    };

    const unwrap = (j0: any) => {
      let j = j0;
      if (isKind(j, 'response')) j = j.value ?? j.ok ?? j.err ?? j;
      if (isKind(j, 'optional')) {
        if (!('value' in j) || j.value == null) return undefined;
        j = j.value;
      }
      if (isKind(j, 'tuple')) return j;
      if (isKind(j?.value, 'tuple')) return j.value;
      return j;
    };

    const asFields = (tupleNode: any): Array<{ name: string; value: any }> => {
      const v = tupleNode?.value ?? tupleNode;
      if (Array.isArray(v)) return v;
      if (v && typeof v === 'object') {
        return Object.entries(v).map(([name, value]) => ({ name, value }));
      }
      return [];
    };

    const get = (fields: Array<{ name: string; value: any }>, k: string) =>
      fields.find((x) => (x?.name ?? (x as any)?.key) === k)?.value;

    try {
      const cv = await this.callReadOnly('get-invoice', [bufferCV(Buffer.from(clean, 'hex'))]);
      const tupleNode = unwrap(cvToJSON(cv));
      if (!tupleNode) return undefined;

      const f = asFields(tupleNode);

      const amountCV = get(f, 'amount') ?? get(f, 'amount-sats') ?? get(f, 'amount_sats') ?? get(f, 'amountSats');
      const refundCV = get(f, 'refund-amount') ?? get(f, 'refund_amount') ?? get(f, 'refundAmount');

      const paidCV     = get(f, 'paid');
      const canceledCV = get(f, 'canceled');
      const expiredCV  = get(f, 'expired');

      const truthy = (x: any) => {
        const v = (x && typeof x === 'object' && 'value' in x) ? (x as any).value : x;
        return v === true || v === 'true' || v === 'True' || v === 1 || v === '1';
      };

      const amountSats  = toNumU(amountCV);
      const refundAmount = refundCV == null ? 0 : toNumU(refundCV);

      let status: 'paid' | 'canceled' | 'expired' | 'unpaid' = 'unpaid';
      if (truthy(paidCV)) status = 'paid'; else if (truthy(canceledCV)) status = 'canceled'; else if (truthy(expiredCV)) status = 'expired';

      const payerCV = get(f, 'payer');
      let payer: string | undefined;
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
    } catch { /* fall back */ }

    try {
      const j = await this.readInvoiceDirectMap(clean);
      if (!j) return undefined;
      const f = asFields(j);

      const amountCV = get(f, 'amount') ?? get(f, 'amount-sats') ?? get(f, 'amount_sats') ?? get(f, 'amountSats');
      const refundCV = get(f, 'refund-amount') ?? get(f, 'refund_amount') ?? get(f, 'refundAmount');

      const paidCV     = get(f, 'paid');
      const canceledCV = get(f, 'canceled');
      const expiredCV  = get(f, 'expired');

      const truthy = (x: any) => {
        const v = (x && typeof x === 'object' && 'value' in x) ? (x as any).value : x;
        return v === true || v === 'true' || v === 'True' || v === 1 || v === '1';
      };

      const amountSats   = toNumU(amountCV);
      const refundAmount = refundCV == null ? 0 : toNumU(refundCV);

      let status: 'paid' | 'canceled' | 'expired' | 'unpaid' = 'unpaid';
      if (truthy(paidCV)) status = 'paid'; else if (truthy(canceledCV)) status = 'canceled'; else if (truthy(expiredCV)) status = 'expired';

      return {
        status,
        paidAtHeight: undefined,
        lastChangeHeight: undefined,
        lastTxId: undefined,
        refundAmount,
        amountSats,
        payer: undefined,
      };
    } catch {
      return undefined;
    }
  }

  async readInvoiceStatus(idHex: string): Promise<'not-found' | 'paid' | 'canceled' | 'expired' | 'unpaid'> {
    const clean = idHex.toLowerCase().replace(/^0x/, '');
    if (!/^[0-9a-f]{64}$/.test(clean)) return 'not-found';
    try {
      const cv = await this.callReadOnly('get-invoice-status', [bufferCV(Buffer.from(clean, 'hex'))]);
      const j: any = cvToJSON(cv);
      const val = String(j?.value ?? '').toLowerCase();
      if (val) return val as any;
    } catch { /* fall through */ }
    try {
      const v2 = await this.readInvoiceStatusV2Fallback(clean);
      if (v2 !== 'not-found') return v2;
    } catch { /* ignore */ }
    return 'not-found';
  }

  async readInvoiceDirectMap(idHex: string): Promise<any | undefined> {
    const clean = idHex.toLowerCase().replace(/^0x/, '');
    if (!/^[0-9a-f]{64}$/.test(clean)) return undefined;
    const keyCv = tupleCV({ id: bufferCV(Buffer.from(clean, 'hex')) });
    const keyHex = cvToHex(keyCv);
    const path = `/v2/map_entry/${this.contractAddress}/${this.contractName}/invoices?proof=0`;
    const out: any = await this.postWithRetry(path, JSON.stringify(keyHex));
    if (!out?.data) return undefined;
    const cv = hexToCV(String(out.data));
    const j: any = cvToJSON(cv);
    return j?.value || j;
  }

  async getStxBalance(principal: string): Promise<bigint> {
    const resp: any = await this.getWithRetry(`/extended/v1/address/${encodeURIComponent(principal)}/balances`);
    const stx = resp?.stx?.balance ?? '0';
    return BigInt(String(stx));
  }

  async readSbtcToken() {
    const cv = await this.callReadOnly('get-sbtc', []);
    const j: any = cvToJSON(cv);
    const p = (j && j.type === 'optional' && j.value) ? String(j.value) : '';
    if (!p.includes('.')) return undefined;
    const [contractAddress, contractName] = p.split('.', 2);
    return { contractAddress, contractName };
  }

  async readSubscription(idHex: string): Promise<OnChainSubscription | undefined> {
    const clean = idHex.toLowerCase().replace(/^0x/, '');
    if (!/^[0-9a-f]{64}$/.test(clean)) return undefined;

    const cv = await this.callReadOnly('get-subscription', [
      bufferCV(Buffer.from(clean, 'hex')),
    ]);

    const j: any = cvToJSON(cv);
    if (!j || j.type !== 'optional' || !j.value) return undefined;

    const tup = j.value.value ?? j.value;
    return {
      idHex,
      merchant: String(tup?.merchant?.value || ''),
      subscriber: String(tup?.subscriber?.value || ''),
      amountSats: BigInt(String(tup?.amount?.value ?? '0')),
      intervalBlocks: BigInt(String(tup?.['interval']?.value ?? tup?.['interval-blocks']?.value ?? '0')),
      nextDue: BigInt(String(tup?.['next-due']?.value ?? '0')),
      active: !!tup?.active?.value,
      lastPaid:
        tup?.['last-paid']?.type === 'optional' && tup['last-paid'].value
          ? BigInt(String(tup['last-paid'].value.value ?? tup['last-paid'].value))
          : undefined,
    };
  }

  // Tip helpers
  async getTip(): Promise<{ height: number; blockHash: string }> {
    const fetchLatestFromList = async () => {
      const list = await this.getWithRetry<{ results?: any[] }>(
        '/extended/v1/block',
        { params: { limit: 1, offset: 0 } }
      );
      const first = Array.isArray(list?.results) ? list.results[0] : undefined;
      if (!first) throw new Error('getTip: empty block list');
      return { height: Number(first.height), blockHash: String(first.hash) };
    };

    // wrap the initial /v2/info call
    let info: { stacks_tip_height?: number } | undefined;
    try {
      info = await this.getWithRetry<{ stacks_tip_height?: number }>('/v2/info');
    } catch {
      return await fetchLatestFromList();
    }

    const height = Number(info?.stacks_tip_height);
    if (!Number.isFinite(height) || height <= 0) {
      return await fetchLatestFromList();
    }

    try {
      const blk = await this.getWithRetry(`/extended/v1/block/by_height/${height}`);
      const blockHash = String((blk as any)?.hash ?? (blk as any)?.data?.hash);
      if (!blockHash) return await fetchLatestFromList();
      return { height, blockHash };
    } catch (e: any) {
      if (e?.response?.status === 404 || this.transientErr(e)) {
        return await fetchLatestFromList();
      }
      throw e;
    }
  }

  async getTipHeight(): Promise<number> {
    const tip = await this.getTip();
    return tip.height;
  }

  async getFungibleBalance(assetContract: { contractAddress: string; contractName: string }, principal: string) {
    const resp: any = await this.getWithRetry(`/extended/v1/address/${encodeURIComponent(principal)}/balances`);
    const tokens: Record<string, any> = resp?.fungible_tokens ?? {};
    const fqPrefix = `${assetContract.contractAddress}.${assetContract.contractName}::`;
    let balanceStr = '0';
    for (const [key, entry] of Object.entries(tokens)) {
      if (key.startsWith(fqPrefix)) { balanceStr = String((entry as any)?.balance ?? '0'); break; }
    }
    return BigInt(balanceStr);
  }

  async getContractCallEvents(params: { fromHeight: number; limit?: number; maxPages?: number }): Promise<any[]> {
    const contractId = `${this.contractAddress}.${this.contractName}`;
    const basePath = `/extended/v1/contract/${contractId}/events`;

    const pageLimit = Math.max(1, Math.min(200, params.limit ?? 50));
    const maxPages = Math.max(1, params.maxPages ?? 10);

    const out: any[] = [];
    let offset = 0;

    for (let page = 0; page < maxPages; page++) {
      const resp = await this.http.get(basePath, { params: { limit: pageLimit, offset } });
      const rows: any[] = Array.isArray(resp.data?.results) ? resp.data.results : [];

      if (!rows.length) break;

      for (const ev of rows) {
        const h = Number(ev?.block_height ?? ev?.tx?.block_height ?? NaN);
        if (!Number.isFinite(h) || h < params.fromHeight) continue;
        out.push(ev);
      }

      offset += rows.length;
      if (rows.length < pageLimit) break;
    }

    return out;
  }

  async getBlockHeader(height: number): Promise<{ parent_block_hash: string; block_hash: string }> {
    const resp: any = await this.getWithRetry(`/extended/v1/block/by_height/${height}`);
    return {
      parent_block_hash: String(resp?.parent_block_hash ?? resp?.data?.parent_block_hash ?? ''),
      block_hash: String(resp?.hash ?? resp?.data?.hash ?? ''),
    };
  }

  // Planner wants this; returning false keeps registration in the plan (harmless).
  async isMerchantRegisteredOnChain(_principal: string): Promise<boolean> {
    return false;
  }
}

export default StacksChainClient;
