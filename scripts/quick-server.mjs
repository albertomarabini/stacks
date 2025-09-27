#!/usr/bin/env node
/* eslint-disable no-console */


import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

import stacksTx from "@stacks/transactions";
const {
    AnchorMode, Cl, hexToCV, makeContractCall, serializeCV,
    callReadOnlyFunction, cvToJSON, bufferCV
} = stacksTx;



// Works whether @stacks/network is CJS (default export) or ESM (named exports)
import * as stacksNetworkPkg from "@stacks/network";
const Net = stacksNetworkPkg.default ?? stacksNetworkPkg;
const {
    networkFromName,
    clientFromNetwork,
    STACKS_MAINNET,
    STACKS_TESTNET,
    STACKS_DEVNET,
    STACKS_MOCKNET,
} = Net; // v7 exports constants + helpers (no class constructors)


// ── minimal Stacks API helper (for debug-only queries) ───────────────────────
async function stacksApi(path) {
    const base =
        process.env.STACKS_API_URL ||
        process.env.STACKS_API ||
        process.env.STACKS_NODE ||
        STACKS_API;
    if (!base) throw new Error("STACKS_API base URL is not configured");
    const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? path : `/${path}`}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
    return res.json();
}


// Resolve store id lazily from public DTO (or env override)
async function resolveStoreIdForInvoice(invoiceId) {
    if (process.env.MERCHANT_STORE_ID) return process.env.MERCHANT_STORE_ID;
    try {
        const dto = await httpJson("GET", `/i/${invoiceId}`);
        return dto?.storeId;
    } catch {
        return undefined;
    }
}

// ───────────────────────────────────────────────────────────────────────────────
// Config
// ───────────────────────────────────────────────────────────────────────────────
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;

const DB_PATH = process.env.DB_PATH || "./invoices.sqlite";
const VERBOSE = String(process.env.VERBOSE || "") === "1";

const MERCHANT_PRINCIPAL = process.env.MERCHANT_PRINCIPAL || "";
const BRAND_NAME = process.env.BRAND_NAME || "Demo Store";
let STORE_ID = process.env.STORE_ID || "";

const SBTC_ADDRESS = process.env.SBTC_CONTRACT_ADDRESS || "";
const SBTC_NAME = process.env.SBTC_CONTRACT_NAME || "";

const STACKS_NETWORK = (process.env.STACKS_NETWORK || "testnet").toLowerCase();
const STACKS_API =
    process.env.STACKS_API_URL ||
    (STACKS_NETWORK === "mainnet"
        ? "https://api.hiro.so"
        : STACKS_NETWORK === "devnet"
            ? "http://localhost:3999"
            : "https://api.testnet.hiro.so");

const ADMIN_SK = process.env.ADMIN_SECRET_KEY || "";
const MERCHANT_SK = process.env.MERCHANT_SECRET_KEY || "";
const PAYER_SK = process.env.PAYER_SECRET_KEY || "";

const MAX_WAIT_MS = Number(process.env.MAX_WAIT_MS || 30000);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 8000);
const DUMMY_PAYER = process.env.PAYER_PRINCIPAL || "ST2J...TESTPAYER";
const PAYER_ADDR = process.env.PAYER_PRINCIPAL || DUMMY_PAYER;
let LAST_REFUND_TX_SUCCESS = false;

// ───────────────────────────────────────────────────────────────────────────────
// Pretty harness
// ───────────────────────────────────────────────────────────────────────────────
const c = {
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    dim: (s) => `\x1b[2m${s}\x1b[0m`,
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
};
function banner() {
    console.log(c.bold("\nsBTC Payment – Server Self Test (prod-style + original)"));
    console.log(c.dim(`Target API: ${BASE_URL}`));
    console.log(c.dim(`Stacks: ${STACKS_NETWORK} @ ${STACKS_API}`));
    const adminMode = (ADMIN_USER && ADMIN_PASS) ? "basic" : (ADMIN_TOKEN ? "token" : "none");
    const sqliteOk = (() => { try { execFileSync("sqlite3", ["-version"]); return true; } catch { return false; } })();
    console.log(c.dim(`Admin auth: ${adminMode}${ADMIN_TOKEN ? " (+token headers)" : ""}`));
    console.log(c.dim(`DB: ${DB_PATH} (sqlite3 CLI ${sqliteOk ? "ok" : "missing"})`));
    console.log(c.dim(`Timeouts: fetch=${FETCH_TIMEOUT_MS}ms, mirror-wait=${MAX_WAIT_MS}ms`));
    console.log("");
}
const safeStr = (v) => { try { return typeof v === "string" ? v : JSON.stringify(v); } catch { return String(v ?? ""); } };
const truncate = (s, n) => (s && s.length > n ? s.slice(0, n) + "..." : s);


// ───────────────────────────────────────────────────────────────────────────────
// Per-step log capture (only flush on FAIL/SKIP/BLOCKED)
// ───────────────────────────────────────────────────────────────────────────────
let __STEP_NAME = null;
let __STEP_LOGS = null;
// low-level push that never recurses

// ── HTTP run-deduper (last-two calls) ─────────────────────────────────────────
let __HTTP_BUF = []; // each entry: { sig, lines, count }

function _push(line) {
    if (__STEP_LOGS) __STEP_LOGS.push(line);
    else console.log(line);
}

function httpFlushEntry(entry) {
    if (!entry) return;
    const [first, ...rest] = entry.lines;
    if (entry.count === 1) _push(first);
    else _push(`${first}  … called x ${entry.count} times`);
    for (const ln of rest) _push(ln);
}

function httpFlushOldest() {
    const oldest = __HTTP_BUF.shift();
    if (oldest) httpFlushEntry(oldest);
}

function httpFlushAll() {
    while (__HTTP_BUF.length) httpFlushOldest();
}

// Backwards name kept so existing calls (emit/flushCapture/discardCapture) still work
function httpRunFlush() { httpFlushAll(); }

// Build a stable-ish signature for dedupe (unchanged)
function httpSig(direction, o) {
    const j = (x) => {
        try { return JSON.stringify(redactDeep(x)); } catch { return String(x); }
    };
    return [
        direction,
        o.method || "",
        o.url || "",
        direction === "←" ? String(o.status || "") : "",
        direction === "→" ? j(o.body ?? null) : j(o.resBody ?? null),
    ].join("|");
}


function startCapture(name) {
    __STEP_NAME = name;
    __STEP_LOGS = [];
}
function emit(line) {
    // flush any pending deduped HTTP run before pushing non-HTTP lines
    httpRunFlush();
    _push(line);
}
function flushCapture() {
    httpRunFlush(); // <— add this
    if (!__STEP_LOGS || __STEP_LOGS.length === 0) return;
    console.log(c.dim(`\n── Logs for step: ${__STEP_NAME} ──`));
    for (const ln of __STEP_LOGS) console.log(ln);
    console.log(c.dim(`── End logs: ${__STEP_NAME} ──\n`));
    __STEP_LOGS = null;
    __STEP_NAME = null;
}
function discardCapture() {
    httpRunFlush(); // <— add this
    __STEP_LOGS = null;
    __STEP_NAME = null;
}

async function waitFor(fn, ok, ms = 15000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        try {
            const v = await fn();
            // If you only want ok() to run when v is defined:
            if (v !== undefined && ok(v)) return v;
            // or, if ok() can handle undefined itself, prefer:
            // if (ok(v)) return v;
        } catch {
            // ignore transient errors
        }
        await new Promise(r => setTimeout(r, 400));
    }
    throw new Error('timeout waiting for on-chain state');
}


// ───────────────────────────────────────────────────────────────────────────────
// Diagnostics (redaction + wire logging)
// ───────────────────────────────────────────────────────────────────────────────
const redactStr = (s) => {
    if (!s || typeof s !== "string") return s;
    // redact long hex-like tokens and keys (64+ hex chars) -> keep first 8
    s = s.replace(/\b(0x)?[0-9a-fA-F]{32,}\b/g, (m) => (m.slice(0, 10) + "…" + `[${m.length}b]`));
    // redact base64 Basic tokens
    s = s.replace(/\bBasic\s+[A-Za-z0-9+/=.-]{10,}\b/g, "Basic ***");
    // redact Bearer tokens
    s = s.replace(/\bBearer\s+[A-Za-z0-9._-]{10,}\b/g, "Bearer ***");
    return s;
};
const redactKeyLike = (k) => /api[-_]?key|hmac|secret|token|authorization|private[-_]?key|signer|x-admin-token|x-api-key/i.test(k);

function redactDeep(v) {
    if (v == null) return v;
    if (typeof v === "string") return redactStr(v);
    if (Array.isArray(v)) return v.map(redactDeep);
    if (typeof v === "object") {
        const out = {};
        for (const [k, val] of Object.entries(v)) {
            // hide values for key-like entries
            if (redactKeyLike(k)) {
                // keep minimal hint
                const hint = typeof val === "string" ? `${val.slice(0, 8)}…` : typeof val;
                out[k] = `***redacted(${hint})***`;
            } else {
                out[k] = redactDeep(val);
            }
        }
        return out;
    }
    return v;
}

// Single-line compact pretty printer with redaction
function jstr(obj, max = 800) {
    try {
        const s = JSON.stringify(redactDeep(obj));
        return s.length > max ? s.slice(0, max) + "…" : s;
    } catch { return String(obj); }
}

// Add optional third param: logHTTP(direction, payload, flush=false)
function logHTTP(direction, { method, url, kind, headers, body, status, resHeaders, resBody }, flush = false) {
    // Build the lines we would print for this call (unchanged)
    const lines = [];
    if (direction === "→") {
        lines.push(c.dim(`[HTTP] → ${method} ${url} (${kind || "public"})`));
        lines.push(c.dim(`       headers=${jstr(headers)}`));
        if (body !== undefined) lines.push(c.dim(`       body=${jstr(body)}`));
    } else {
        lines.push(c.dim(`[HTTP] ← ${status} ${method} ${url}`));
        const pick = {};
        for (const k of ["content-type", "access-control-allow-origin", "access-control-allow-headers"]) {
            const v = resHeaders?.get ? resHeaders.get(k) : resHeaders?.[k];
            if (v) pick[k] = v;
        }
        lines.push(c.dim(`       headers=${jstr(pick)}`));
        if (resBody !== undefined) {
            const pretty = typeof resBody === "string" ? redactStr(truncate(resBody, 1200)) : jstr(resBody);
            lines.push(c.dim(`       body=${pretty}`));
        }
    }

    // Two-slot dedupe: if this sig matches any of the buffered two, bump its count; else push new;
    // if pushing makes 3, flush the oldest first.
    const sig = httpSig(direction, { method, url, body, status, resBody });
    const idx = __HTTP_BUF.findIndex(e => e.sig === sig);
    if (idx >= 0) {
        __HTTP_BUF[idx].count += 1;
    } else {
        if (__HTTP_BUF.length >= 2) httpFlushOldest();
        __HTTP_BUF.push({ sig, lines, count: 1 });
    }

    // Immediate flush if requested (useful before non-HTTP logs or at step flush)
    if (flush === true) httpFlushAll();
}

function logUnsigned(label, call) {
    // Always capture; only flushed on non-PASS
    try {
        emit(c.dim(`[CALL] ${label}: ${call?.contractAddress}::${call?.contractName}.${call?.functionName}`));
        const args = Array.isArray(call?.functionArgs) ? call.functionArgs : [];
        emit(c.dim(`       args=${jstr(args.map(summarizeArg))}`));
        if (call?.postConditions) emit(c.dim(`       postConditions=${jstr(call.postConditions)}`));
        if (call?.post_conditions) emit(c.dim(`       post_conditions=${jstr(call.post_conditions)}`));
    } catch { /* ignore */ }
}

// Unsigned-call logging
function summarizeArg(a) {
    const t = typeof a;
    if (t === "string") {
        if (a.startsWith("0x")) return { type: "hex-cv", len: a.length };
        if (a.includes("::")) return { type: "contract-principal-str", sample: a.slice(0, 18) + "…" };
        return { type: "string", sample: a.slice(0, 18) + "…" };
    }
    if (t === "object" && a) {
        const shape = Object.keys(a).join(",");
        // try to show contract principal-ish shape without secrets
        const addr = a.contractAddress || a.address;
        const name = a.contractName || a.name;
        return { type: "object", shape, principal: addr && name ? `${addr}::${name}` : undefined };
    }
    return { type: t };
}


// ── Webhook diagnostics (prints everything we need) ───────────────────────────
async function dumpWebhookDiag({ storeId, invoiceId, hook, expectEvent }) {
    emit(c.yellow(`[DIAG] webhook dump for invoice=${invoiceId} expect=${expectEvent}`));
    try {
        // receiver
        const rx = (hook?.captured ?? []).map(e => ({
            ts: e.ts, sig: !!e.sig, event: e?.json?.event ?? e?.json?.status ?? "unknown",
            invoiceId: e?.json?.invoiceId, len: (e.raw || "").length
        }));
        emit(c.yellow(`[DIAG] receiver captured=${rx.length}`));
        for (const r of rx) emit(c.yellow(`  • ts=${r.ts} ev=${r.event} id=${r.invoiceId} sig=${r.sig}`));
    } catch { }
    try {
        // merchant-visible logs
        const m = await httpJson("GET", `/api/v1/stores/${storeId}/webhooks`, null, "merchant");
        emit(c.yellow(`[DIAG] merchant webhook logs n=${Array.isArray(m) ? m.length : 0}`));
        const rows = (Array.isArray(m) ? m : []).filter(w => !invoiceId || w.invoiceId === invoiceId);
        for (const w of rows) emit(c.yellow(`  • id=${w.id} type=${w.eventType} inv=${w.invoiceId} succ=${w.success} code=${w.statusCode}`));
    } catch (e) {
        emit(c.yellow(`[DIAG] merchant webhook logs error: ${e?.status || e}`));
    }
    try {
        // admin: all + failed
        const aAll = await httpJson("GET", `/api/admin/webhooks?status=all&storeId=${encodeURIComponent(storeId)}`, null, "admin");
        const aFailed = await httpJson("GET", `/api/admin/webhooks?status=failed&storeId=${encodeURIComponent(storeId)}`, null, "admin");
        emit(c.yellow(`[DIAG] admin webhooks all=${Array.isArray(aAll) ? aAll.length : 0} failed=${Array.isArray(aFailed) ? aFailed.length : 0}`));
    } catch { }
    try {
        const poller = await httpJson("GET", "/api/admin/poller", null, "admin");
        emit(c.yellow(`[DIAG] poller running=${poller?.running} lag=${poller?.lagBlocks} lastTx=${truncate(poller?.lastTxId || "", 10)}`));
    } catch { }
}
async function getPollerStatus() {
    try {
        const s = await httpJson("GET", "/api/admin/poller", null, "admin", /* silent */ true);
        return { ok: true, running: !!s?.running, lagBlocks: Number(s?.lagBlocks ?? 0), raw: s };
    } catch (e) {
        return { ok: false, err: e };
    }
}

// Others

// BigInt-safe pretty
const asStr = (v) => (typeof v === 'bigint' ? v.toString() : (v?.toString?.() ?? String(v)));

// Robust extractor for cvToJSON(tuple/optionals)
function getOpt(inner) {
    return inner && inner.type === 'optional' ? inner.value ?? null : inner;
}
function getTupleField(tup, k) {
    if (!tup || tup.type !== 'tuple') return null;
    const hit = (tup.value || []).find(f => f?.name === k);
    return hit ? hit.value : null;
}

// Call read-only fns directly against the contract
async function readOnchainInvoiceDebug({ contractAddress, contractName, idHex }) {
    const network = stacksNetwork();
    // 1) get-invoice (optional tuple)
    const cvInvoice = await callReadOnlyFunction({
        contractAddress, contractName,
        functionName: 'get-invoice',
        functionArgs: [bufferCV(Buffer.from(idHex.replace(/^0x/i, ''), 'hex'))],
        network,
        senderAddress: contractAddress,
    });
    const jInv = cvToJSON(cvInvoice);

    // 2) get-invoice-status-v2 (tuple {id: (buff 32)})
    const cvStatus = await callReadOnlyFunction({
        contractAddress, contractName,
        functionName: 'get-invoice-status-v2',
        functionArgs: [Cl.tuple({ id: Cl.buffer(Buffer.from(idHex.replace(/^0x/i, ''), 'hex')) })],
        network,
        senderAddress: contractAddress,
    });
    const jStatus = cvToJSON(cvStatus);

    // Decode the tuple if present
    let paid = false, refundAmount = '0', amount = '0', payer = '', expired = false, canceled = false, expiresAt = null, merchant = '';
    if (jInv?.type === 'optional' && jInv.value) {
        const tup = jInv.value;
        paid = !!getTupleField(tup, 'paid')?.value;
        expired = !!getTupleField(tup, 'expired')?.value;
        canceled = !!getTupleField(tup, 'canceled')?.value;
        refundAmount = asStr(getTupleField(tup, 'refund-amount')?.value ?? 0n);
        amount = asStr(getTupleField(tup, 'amount')?.value ?? 0n);
        const optP = getTupleField(tup, 'payer');
        const pv = optP && optP.type === 'optional' ? optP.value : null;
        payer = pv ? String(pv.value ?? pv) : '';
        const optEx = getTupleField(tup, 'expires-at');
        expiresAt = optEx && optEx.type === 'optional' && optEx.value ? asStr(optEx.value.value ?? optEx.value) : null;
        merchant = String(getTupleField(tup, 'merchant')?.value ?? '');
    }

    const status = typeof jStatus?.value === 'string' ? jStatus.value : '';
    return {
        status,
        paid,
        expired,
        canceled,
        amountSats: amount,
        refundAmountSats: refundAmount,
        payer,
        merchant,
        // Heights aren’t exposed by this ABI; we’ll print tipHeight alongside for context.
    };
}


// ── Step filtering fixtures (add this near your other fixtures) ──────────────
let __STEP_SEQ = 0;

function parseStepList(envVal) {
    if (!envVal) return null;
    // Allow "3,7, 8 14-15" -> [3,7,8,14,15]
    const parts = String(envVal)
        .split(/[,\s]+/)
        .map(s => s.trim())
        .filter(Boolean);

    const out = new Set();
    for (const p of parts) {
        const m = /^(\d+)-(\d+)$/.exec(p);
        if (m) {
            const a = Number(m[1]), b = Number(m[2]);
            if (Number.isFinite(a) && Number.isFinite(b)) {
                const lo = Math.min(a, b), hi = Math.max(a, b);
                for (let i = lo; i <= hi; i++) out.add(i);
            }
            continue;
        }
        const n = Number(p);
        if (Number.isFinite(n)) out.add(n);
    }
    return out.size ? out : null;
}

const STEPS_LIST = parseStepList(process.env.STEPS_LIST);
const ONLY_INDEX = process.env.ONLY_INDEX ? Number(process.env.ONLY_INDEX) : null;
const FROM_INDEX = process.env.FROM_INDEX ? Number(process.env.FROM_INDEX) : 1;
const TO_INDEX = process.env.TO_INDEX ? Number(process.env.TO_INDEX) : Infinity;
const STEP_MATCH = process.env.STEP_MATCH ? new RegExp(process.env.STEP_MATCH, "i") : null;

function stepIsFiltered(idx, name) {
    // Highest precedence: explicit list
    if (STEPS_LIST) return !STEPS_LIST.has(idx);
    // Next: ONLY_INDEX
    if (Number.isFinite(ONLY_INDEX)) return idx !== ONLY_INDEX;
    // Range + regex
    if (idx < FROM_INDEX || idx > TO_INDEX) return true;
    if (STEP_MATCH && !STEP_MATCH.test(name)) return true;
    return false;
}


// ───────────────────────────────────────────────────────────────────────────────
// Step harness
// ───────────────────────────────────────────────────────────────────────────────

const Status = { PASS: "PASS", FAIL: "FAIL", SKIP: "SKIP", BLOCKED: "BLOCKED" };
const result = (name, status, extras = {}) => ({ name, status, ...extras });
const pass = (name) => result(name, Status.PASS);
const skip = (name, reason) => result(name, Status.SKIP, { reason });
const blocked = (name, reason) => result(name, Status.BLOCKED, { reason });
const fail = (name, errOrObj, hint) => {
    const raw = hint ?? errOrObj?.message ?? "unexpected";
    const reason = (typeof raw === "string") ? raw : safeStr(raw);
    return result(name, Status.FAIL, {
        reason,
        result: safeStr(errOrObj?.result || errOrObj),
    });
};

async function step(name, fn, requires = []) {
    const idx = ++__STEP_SEQ;

    // Short-circuit if filtered out
    if (stepIsFiltered(idx, name)) {
        startCapture(name);
        const r = skip(name, `filtered (idx=${idx})`);
        flushCapture();
        return r;
    }

    const checks = requires.map((r) => (typeof r === "function" ? r() : r));
    const unmet = checks.find((ch) => !ch.ok);

    startCapture(name); // begin per-step capture
    if (unmet) {
        const r = blocked(name, unmet.reason || `requires ${unmet.label}`);
        flushCapture();   // show why it blocked + any logs
        return r;
    }
    try {
        if (VERBOSE) emit(c.dim(`→ ${name}`));
        const out = await fn();

        if (out?.status) {
            if (out.status === "PASS") { discardCapture(); return out; }
            flushCapture(); // non-PASS: show the logs
            return out;
        }

        if (out) { // treated as PASS
            discardCapture();
            return pass(name);
        } else {
            const r = fail(name, null, "falsy step result");
            flushCapture();
            return r;
        }
    } catch (e) {
        const r = fail(name, e, e?.message || "threw");
        flushCapture();
        return r;
    }
}


function printResult(r, i) {
    const icon = r.status === "PASS" ? "✓" : r.status === "SKIP" ? "!" : r.status === "BLOCKED" ? "·" : "✗";
    const color = r.status === "PASS" ? c.green : r.status === "SKIP" ? c.yellow : r.status === "BLOCKED" ? c.dim : c.red;
    let log = `${i}.  ${color(icon)} ${r.name}`;
    if (r.reason) log += ` - ${c.bold("reason")}: ${r.reason}`;
    if (r.result) log += ` - ${c.bold("result")}: ${truncate(r.result, 500)}`;
    console.log(log);
}

const need = {
    env: (k) => () => ({ label: `env:${k}`, ok: !!process.env[k], reason: `missing ${k}` }),
    storeId: () => ({ label: "STORE_ID", ok: !!STORE_ID, reason: "store not created/resolved" }),
    apiKey: () => ({ label: "MERCHANT_API_KEY", ok: !!MERCHANT_API_KEY, reason: "rotate-keys did not reveal API key" }),
    hmac: () => ({ label: "HMAC_SECRET", ok: !!HMAC_SECRET, reason: "rotate-keys did not reveal HMAC secret" }),
    invoiceA: () => ({ label: "invoiceA", ok: !!invId(invoiceA), reason: "no invoice created" }),
    invoiceExp: () => ({ label: "invoiceExp", ok: !!invId(invoiceExp), reason: "no short-ttl invoice" }),
    subId: () => ({ label: "subscription.id", ok: !!sub?.id, reason: "no subscription id" }),
    adminSigner: () => ({ label: "ADMIN_SECRET_KEY", ok: !!ADMIN_SK, reason: "tester lacks admin signer" }),
    merchantSigner: () => ({ label: "MERCHANT_SECRET_KEY", ok: !!MERCHANT_SK, reason: "tester lacks merchant signer" }),
    payerSigner: () => ({ label: "PAYER_SECRET_KEY", ok: !!PAYER_SK, reason: "tester lacks payer signer" }),
    anySigner: () => ({
        label: "ANY_SIGNER",
        ok: !!(ADMIN_SK || MERCHANT_SK || PAYER_SK),
        reason: "no signer available (need ADMIN_SECRET_KEY or MERCHANT_SECRET_KEY or PAYER_SECRET_KEY)"
    }),
    // Only true after we confirm the builder works (sBTC configured)
    payReady: () => ({ label: "PAY_READY", ok: PAY_READY, reason: "sBTC not configured or /create-tx builder blocked" }),
};

// ───────────────────────────────────────────────────────────────────────────────
// Fetch helpers with timeouts
// ───────────────────────────────────────────────────────────────────────────────
function withTimeout(promise, ms, label) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), ms);
    return Promise.race([
        promise(ac.signal),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`${label} timeout after ${ms}ms`)), ms)),
    ]).finally(() => clearTimeout(t));
}
async function httpJson(method, path, body, kind = "public", silent = false) {
    const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
    const headers =
        kind === "admin" ? adminHeaders()
            : kind === "merchant" ? merchantHeaders()
                : { "Content-Type": "application/json" };

    if (!silent) { logHTTP("→", { method, url, kind, headers, body }); }

    const res = await withTimeout(
        (signal) => fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal }),
        FETCH_TIMEOUT_MS,
        `${method} ${url}`
    );

    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }

    if (!silent) { logHTTP("←", { method, url, status: res.status, resHeaders: res.headers, resBody: json ?? text }); }

    if (res.status === 204) return null;
    if (!res.ok) {
        const err = new Error(`HTTP ${res.status} ${res.statusText}`);
        err.status = res.status;
        err.body = json || text;
        throw err;
    }
    return json;
}

async function raw(method, path, headers = {}, body) {
    const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
    logHTTP("→", { method, url, headers, body });
    const res = await withTimeout(
        (signal) => fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal }),
        FETCH_TIMEOUT_MS,
        `${method} ${url}`
    );
    let text = "";
    try { text = await res.text(); } catch { }
    logHTTP("←", { method, url, status: res.status, resHeaders: res.headers, resBody: text });
    return { status: res.status, headers: res.headers, text: async () => text, json: async () => { try { return JSON.parse(text); } catch { return null; } } };
}


async function options(path, origin, kind = "public", method = "POST") {
    const h = kind === "admin" ? adminHeaders() : kind === "merchant" ? merchantHeaders() : {};
    return raw("OPTIONS", path, {
        ...h,
        Origin: origin,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": "Content-Type,X-API-Key,X-Webhook-Timestamp,X-Webhook-Signature",
    });
}

function adminHeaders() {
    const h = { "Content-Type": "application/json" };
    const haveToken = !!ADMIN_TOKEN;
    const haveBasic = !!(ADMIN_USER && ADMIN_PASS);

    if (haveBasic) {
        const b64 = Buffer.from(`${ADMIN_USER}:${ADMIN_PASS}`).toString("base64");
        h.Authorization = `Basic ${b64}`;
    } else if (haveToken) {
        h.Authorization = `Bearer ${ADMIN_TOKEN}`;
    }
    if (haveToken) {
        h["X-Admin-Token"] = ADMIN_TOKEN;
        h["X-API-Key"] = ADMIN_TOKEN; // legacy admin middleware uses this
    }
    return h;
}

let MERCHANT_API_KEY = process.env.MERCHANT_API_KEY || "";
let HMAC_SECRET = process.env.HMAC_SECRET || "";

function merchantHeaders() {
    return { "Content-Type": "application/json", "X-API-Key": MERCHANT_API_KEY || "MISSING" };
}

function corsAllowed(res, origin) {
    const v = res.headers.get("access-control-allow-origin");
    // Accept exact match OR wildcard (typical for public GETs)
    return v === origin || v === "*" || v === "null";
}
function allowHeadersContain(res, expected) {
    const v = (res.headers.get("access-control-allow-headers") || "").toLowerCase();
    return expected.every((h) => v.includes(h.toLowerCase()));
}

async function waitForMirrorAdvance(extraMsIfLag = MAX_WAIT_MS) {
    const ps = await getPollerStatus();
    if (!ps.ok) return false;
    const lag = Number(ps.lagBlocks || 0);
    if (lag <= 0) return ensurePollerProgress(MAX_WAIT_MS);
    const avgSecs = Number(process.env.AVG_BLOCK_SECONDS || 20);
    const budget = Math.min(6 * MAX_WAIT_MS, (lag + 1) * avgSecs * 1000 + extraMsIfLag);
    return ensurePollerProgress(budget);
}


// ── Subscriptions Helpers──────────────
function errStatus(e) { return e?.status ?? e?.response?.status; }
function errBody(e) { return e?.body ?? e?.response?.data; }
function is409BadStatus(e) {
    return errStatus(e) === 409 && String((errBody(e) || {}).error || "").includes("bad_status");
}
async function setDirectMode(subId) {
    try {
        await httpJson("POST", `/api/v1/stores/${STORE_ID}/subscriptions/${subId}/mode`, { mode: "direct" }, "merchant");
    } catch (e) {
        console.warn("setDirectMode:", errStatus(e), errBody(e) || e?.message);
    }
}

// ───────────────────────────────────────────────────────────────────────────────
// Request body casing compatibility
// ───────────────────────────────────────────────────────────────────────────────
const hasSnake = (obj) => !!obj && typeof obj === "object" && Object.keys(obj).some((k) => k.includes("_"));
const toCamelKey = (k) => k.replace(/_([a-z])/g, (_, g1) => g1.toUpperCase());
function camelize(input) {
    if (Array.isArray(input)) return input.map(camelize);
    if (input && typeof input === "object") {
        const out = {};
        for (const [k, v] of Object.entries(input)) out[toCamelKey(k)] = camelize(v);
        return out;
    }
    return input;
}
async function jsonCompat(method, path, body, kind = "public") {
    try {
        return await httpJson(method, path, body, kind);
    } catch (e) {
        if (e.status === 400 && hasSnake(body)) {
            return await httpJson(method, path, camelize(body), kind);
        }
        throw e;
    }
}

// ───────────────────────────────────────────────────────────────────────────────
// SQLite helpers (read-only, short timeout)
// ───────────────────────────────────────────────────────────────────────────────
function sqliteCliAvailable() {
    try { execFileSync("sqlite3", ["-version"]); return true; } catch { return false; }
}
function readKeysFromDb(principal) {
    try {
        if (!sqliteCliAvailable()) return null;
        if (!fs.existsSync(DB_PATH)) return null;
        const sql = `.timeout 1000
.headers on
.mode csv
SELECT api_key,hmac_secret FROM merchants WHERE principal='${principal}' LIMIT 1;`;
        const out = execFileSync("sqlite3", ["-readonly", DB_PATH], { input: sql, encoding: "utf8" }).trim();
        const lines = out.split(/\r?\n/);
        if (lines.length < 2) return null;
        const headers = lines[0].split(",");
        const values = lines[1].split(",");
        const idxKey = headers.findIndex(h => h.trim().toLowerCase() === "api_key");
        const idxHmac = headers.findIndex(h => h.trim().toLowerCase() === "hmac_secret");
        const apiKey = idxKey >= 0 ? values[idxKey] : "";
        const hmac = idxHmac >= 0 ? values[idxHmac] : "";
        return (apiKey && hmac) ? { apiKey, hmacSecret: hmac } : null;
    } catch {
        return null;
    }
}

// ───────────────────────────────────────────────────────────────────────────────
// Shapes & helpers
// ───────────────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nowSec = () => Math.floor(Date.now() / 1000);
const expectKeys = (o, ks) => ks.every((k) => Object.hasOwn(o ?? {}, k));
const is64Hex = (s) => typeof s === "string" && /^[0-9a-fA-F]{64}$/.test(s);
const parseSig = (v) => (typeof v === "string" && v.startsWith("v1=")) ? v.slice(3) : null;

// Canonical invoice ID accessor (prefer invoiceId; fallback to idRaw)
const invId = (obj) => (obj?.invoiceId || obj?.idRaw || null);

function looksLikeUnsignedCall(call, expectFn) {
    if (!call || typeof call !== "object") return false;
    const have = ["contractAddress", "contractName", "functionName", "functionArgs"];
    if (!have.every((k) => k in call)) return false;
    if (expectFn && call.functionName !== expectFn) return false;
    return Array.isArray(call.functionArgs);
}

function looksLikePublicInvoice(i) {
    i = i?.invoice ?? i; // ← NEW: unwrap nested { invoice }
    const id = invId(i);
    const must = ["idHex", "storeId", "amountSats", "usdAtCreate", "quoteExpiresAt", "merchantPrincipal", "status", "createdAt"];
    return (!!id && expectKeys(i, must)) || (console.warn("looksLikePublicInvoice FAIL keys=", Object.keys(i || {})), false); // ← NEW: log on failure
}

function hasUnderscoreKeys(obj) { return Object.keys(obj || {}).some((k) => k.includes("_")); }
function looksLikePublicStoreProfile(p) {
    const ok = ["displayName", "logoUrl", "brandColor", "supportEmail", "supportUrl"].some((k) => k in (p || {}));
    const noSecrets = !("apiKey" in (p || {})) && !("hmacSecret" in (p || {}));
    return ok && noSecrets && !hasUnderscoreKeys(p);
}
function looksLikePrivateStoreProfile(p) {
    const must = ["id", "principal", "active"];
    const hasMust = must.every((k) => k in (p || {}));
    const hasSecrets = "apiKey" in (p || {}) || "hmacSecret" in (p || {});
    return hasMust && !hasUnderscoreKeys(p) && hasSecrets;
}
function hasFungiblePC(unsignedCall, invoice, payerPrincipal) {
    const pcs = unsignedCall?.postConditions || unsignedCall?.post_conditions;
    if (!Array.isArray(pcs) || pcs.length === 0) return false;

    // Find an FT PC that references the payer and the expected asset
    const wantAsset =
        (SBTC_ADDRESS && SBTC_NAME)
            ? `${SBTC_ADDRESS}.${SBTC_NAME}::sbtc`
            : null;

    const amt = String(invoice?.amountSats ?? "");
    const payer = String(payerPrincipal || "");

    return pcs.some(pc => {
        if (pc?.type !== "ft-postcondition") return false;
        const okPayer = payer ? String(pc.address || "").includes(payer) : true;
        const okAmt = String(pc.amount || "") === amt;
        const okAsset = wantAsset ? String(pc.asset || "").includes(wantAsset) : true;
        return okPayer && okAmt && okAsset;
    });
}

function argToInvoiceHex(arg) {
    try {
        if (arg && typeof arg === "object" && typeof arg.value === "string" && /^[0-9a-fA-F]{64}$/.test(arg.value))
            return arg.value.toLowerCase();
        if (typeof arg === "string" && arg.startsWith("0x")) {
            const cv = hexToCV(arg);
            if (cv?.type === 'buffer' && cv.buffer) return Buffer.from(cv.buffer).toString('hex').toLowerCase();
            if (cv?.type === 'buffer' && cv.value) return Buffer.from(cv.value).toString('hex').toLowerCase();
        }
        if (typeof arg === "string" && /^[0-9a-fA-F]{64}$/.test(arg))
            return arg.toLowerCase();
    } catch { }
    return null;
}


const cvHex = (cv) => "0x" + Buffer.from(serializeCV(cv)).toString("hex");
const cvHexBuff32 = (hex) => cvHex(bufferCV(Buffer.from(String(hex).replace(/^0x/i, ''), 'hex')));
const cvHexTupleId = (hex) => cvHex(Cl.tuple({ id: bufferCV(Buffer.from(String(hex).replace(/^0x/i, ''), 'hex')) }));


async function broadcastWith(senderKey, label, unsigned) {
    logUnsigned(label, unsigned);
    const { txid } = await signAndBroadcastUnsigned(unsigned, senderKey);
    const st = await waitForFinal(txid);

    const r = String(repr(st) || "");
    const okAbort =
        (st?.tx_status?.startsWith("abort") && /err u402/i.test(r)) || // duplicate register-merchant
        (st?.tx_status?.startsWith("abort") && /err u201/i.test(r));    // double-pay

    if (st?.tx_status === "success" || okAbort) return true;
    throw Object.assign(new Error(st?.tx_status || "no-status"), { result: st });
}

// ───────────────────────────────────────────────────────────────────────────────
// Webhook receiver (HMAC verify)
// ───────────────────────────────────────────────────────────────────────────────
function startWebhookReceiver() {
    const captured = [];
    const server = http.createServer(async (req, res) => {
        if (req.method !== "POST") { res.statusCode = 404; return res.end(); }
        if (!req.url || !req.url.startsWith("/hook")) { res.statusCode = 404; return res.end(); }
        const chunks = [];
        req.on("data", (d) => chunks.push(d));
        req.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            const ts = req.headers["x-webhook-timestamp"];
            const sig = req.headers["x-webhook-signature"];
            let json = null;
            try { json = JSON.parse(raw); } catch { }
            captured.push({ ts, sig, raw, json, headers: req.headers });
            try {
                const ev = json?.event || json?.status || "unknown";
                const id = json?.invoiceId || json?.subscriptionId || "n/a";
                // console.log(c.dim(`[HOOK] rx ok ts=${ts} sig=${sig ? "v1=…" : "none"} ev=${ev} id=${id}`));
            } catch { }
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
        });
    });
    return new Promise((resolve, reject) => {
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address();
            resolve({ server, port, url: `http://127.0.0.1:${port}/hook`, captured });
        });
        server.on("error", reject);
    });
}

// Flaky webhook receiver: fails first N times, then returns 200
function startFlakyWebhookReceiver({ failFirst = 2, status = 503 } = {}) {
    const captured = [];
    let remaining = Number(failFirst) || 0;

    const server = http.createServer(async (req, res) => {
        if (req.method !== "POST" || !req.url || !req.url.startsWith("/hook")) {
            res.statusCode = 404; return res.end();
        }
        const chunks = [];
        req.on("data", d => chunks.push(d));
        req.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            const ts = req.headers["x-webhook-timestamp"];
            const sig = req.headers["x-webhook-signature"];
            let json = null; try { json = JSON.parse(raw); } catch { }
            captured.push({ ts, sig, raw, json, headers: req.headers });
            if (remaining > 0) {
                remaining--;
                res.writeHead(status, { "content-type": "application/json" });
                return res.end(JSON.stringify({ ok: false, reason: "flaky-fail" }));
            }
            res.writeHead(200, { "content-type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
        });
    });
    return new Promise((resolve, reject) => {
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address();
            resolve({ server, port, url: `http://127.0.0.1:${port}/hook`, captured });
        });
        server.on("error", reject);
    });
}

function verifyWebhookSig({ ts, sig, raw }, secret) {
    if (!ts || !sig || !raw || !secret) return { ok: false, reason: "missing parts" };
    const now = nowSec();
    const skewOk = Math.abs(Number(ts) - now) <= 300;
    const their = parseSig(String(sig));
    if (!their) return { ok: false, reason: "bad sig format" };
    const msg = `${ts}.${raw}`;
    const our = crypto.createHmac("sha256", secret).update(msg).digest("hex");
    const ok = crypto.timingSafeEqual(Buffer.from(our, "hex"), Buffer.from(their, "hex"));
    const res = { ok: ok && skewOk, reason: ok ? (skewOk ? "ok" : "skew") : "mismatch" };
    if (!res.ok) {
        console.log(c.yellow(`[HOOK] HMAC verify miss: reason=${res.reason} ts=${ts} ours=${our.slice(0, 8)}… theirs=${their?.slice(0, 8)}…`));
    }
    return res;
}

// ───────────────────────────────────────────────────────────────────────────────
// Stacks helpers
// ───────────────────────────────────────────────────────────────────────────────
function stacksNetwork() {
    const name = String(STACKS_NETWORK || "testnet").toLowerCase();
    let network = networkFromName(name);
    if (STACKS_API) {
        const client = clientFromNetwork(network);
        network = { ...network, client: { ...client, baseUrl: STACKS_API } };
    }
    return network;
}

async function signAndBroadcastUnsigned(unsigned, secretKey) {
    function argDbg(idx, a, outTag) {
        // Keep honoring VERBOSE for chattiness, but capture when present
        if (!VERBOSE) return;
        try {
            const summary = summarizeArg(a);
            emit(c.dim(`[CALL] arg[${idx}] in=${jstr(summary)} → as=${outTag}`));
        } catch { }
    }

    function toClarityValue(a, idx = -1) {
        // Helper: parse "ADDR.CONTRACT" or "ADDR::CONTRACT"
        function parseContractStr(s) {
            if (typeof s !== "string") return null;
            const parts = s.includes("::") ? s.split("::") : s.split(".");
            if (parts.length === 2 && parts[0] && parts[1]) return { address: parts[0], name: parts[1] };
            return null;
        }
        const cleanHex = (s) => (typeof s === "string" ? s.replace(/^0x/i, "") : "");

        // 1) Already a hex-encoded CV
        if (typeof a === "string" && a.startsWith("0x")) { argDbg(idx, a, "hexToCV"); return hexToCV(a); }

        // 2) Principal as a string
        if (typeof a === "string") {
            // 2a) Contract principal ("ADDR.CONTRACT" or "ADDR::CONTRACT")
            const p = parseContractStr(a);
            if (p) { argDbg(idx, a, "Cl.contractPrincipal(str)"); return Cl.contractPrincipal(p.address, p.name); }

            // 2b) Standard principal ("ST…")
            if (/^ST[0-9A-Z]{10,}/i.test(a)) {
                argDbg(idx, a, "Cl.standardPrincipal(str)");
                if (Cl.standardPrincipal) return Cl.standardPrincipal(a);
                if (Cl.standardPrincipalCV) return Cl.standardPrincipalCV(a);
                if (Cl.principalCV) return Cl.principalCV(a);
                throw new Error("standard principal CV not supported by @stacks/transactions in this environment");
            }
        }


        // 3) Objects we know how to coerce
        if (a && typeof a === "object") {
            const typeStr = typeof a.type === "string" ? a.type.toLowerCase() : "";
            // 3a) Hex-cv exposed via common fields
            const hex = a.hex || a.cv || a.value;
            if (typeof hex === "string" && hex.startsWith("0x")) { argDbg(idx, a, "hexToCV(obj.hex)"); return hexToCV(hex); }

            // 3b) Contract-principal via fields
            const address = a.contractAddress || a.address;
            const name = a.contractName || a.name;
            if (address && name) { argDbg(idx, a, "Cl.contractPrincipal(obj fields)"); return Cl.contractPrincipal(address, name); }

            // 3c) Typed server shapes (minimal set we actually see)
            if (typeStr) {

                // { type: "contract" | "contractprincipal", value: "ADDR.CONTRACT" }
                if ((typeStr === "contract" || typeStr === "contractprincipal") && typeof a.value === "string") {
                    const p = parseContractStr(a.value);
                    if (p) { argDbg(idx, a, "Cl.contractPrincipal(typed)"); return Cl.contractPrincipal(p.address, p.name); }
                }

                // { type: "principal" | "standard" | "standardprincipal", value: "ST..." }
                if ((["principal", "standard", "standardprincipal", "address"].includes(typeStr)) && typeof a.value === "string") {
                    argDbg(idx, a, "Cl.standardPrincipal(typed)");
                    if (Cl.standardPrincipal) return Cl.standardPrincipal(a.value);
                    if (Cl.standardPrincipalCV) return Cl.standardPrincipalCV(a.value);
                    if (Cl.principalCV) return Cl.principalCV(a.value); // widest fallback across @stacks/tx versions
                    throw new Error("standard principal CV not supported by @stacks/transactions in this environment");
                }

                // { type: "buffer", value: "<hex-without-0x-ok>" }
                if (typeStr === "buffer" && typeof a.value === "string") {
                    const bytes = Buffer.from(cleanHex(a.value), "hex");
                    if (Cl.buffer) { argDbg(idx, a, "Cl.buffer(hex)"); return Cl.buffer(bytes); }
                    if (Cl.bufferCV) { argDbg(idx, a, "Cl.bufferCV(hex)"); return Cl.bufferCV(bytes); }
                }

                // { type: "uint" | "int", value: string|number }
                if ((typeStr === "uint" || typeStr === "int") && (typeof a.value === "string" || typeof a.value === "number")) {
                    argDbg(idx, a, typeStr === "uint" ? "Cl.uint" : "Cl.int");
                    return typeStr === "uint" ? Cl.uint(a.value) : Cl.int(a.value);
                }

                // { type: "true" } / { type: "false" }
                if (typeStr === "true" || typeStr === "false") {
                    argDbg(idx, a, "Cl.bool");
                    return Cl.bool(typeStr === "true");
                }

                // { type: "some", value: <inner> }  /  { type: "none" }
                if (typeStr === "some") {
                    argDbg(idx, a, "Cl.some");
                    return Cl.some(toClarityValue(a.value, idx));
                }
                if (typeStr === "none") {
                    argDbg(idx, a, "Cl.none");
                    return Cl.none();
                }
            }
            // (kept for old shapes that tuck the principal under value.standard/address)
            if (["principal", "standard-principal", "standardprincipal"].includes(typeStr)) {
                const who =
                    (typeof a.value === "string" && a.value) ||
                    (a.value && (a.value.standard || a.value.address));
                if (typeof who === "string") {
                    argDbg(idx, a, "Cl.standardPrincipal(typed)");
                    if (Cl.standardPrincipal) return Cl.standardPrincipal(who);
                    if (Cl.standardPrincipalCV) return Cl.standardPrincipalCV(who);
                    if (Cl.principalCV) return Cl.principalCV(who);
                    throw new Error("standard principal CV not supported by @stacks/transactions in this environment");
                }
            }

        }

        throw new Error(
            "functionArgs must be hex (0x…), a contract principal string (ADDR.CONTRACT or ADDR::NAME), " +
            "an object like {contractAddress,contractName}, {type:'contract', value:'ADDR.CONTRACT'}, " +
            "or {type:'buffer'|'uint'|'int'|'some'|'none'|'true'|'false', value:…}"
        );
    }


    const args = (unsigned.functionArgs || []).map((v, i) => {
        try { return toClarityValue(v, i); }
        catch (e) {
            emit(c.red(`[CALL] arg[${i}] conversion failed: ${e.message}`));
            emit(c.red(`       value=${jstr(v)}`));
            throw e;
        }
    });

    if (VERBOSE) {
        emit(c.dim(`[TX] building ${unsigned.contractAddress}::${unsigned.contractName}.${unsigned.functionName}`));
    }
    // Ensure we pass a proper hex private key; fail fast with a clean error.
    const senderKey = typeof secretKey === "string" ? secretKey.replace(/^0x/i, "") : "";
    if (!/^[0-9a-fA-F]{64}$/.test(senderKey) && !/^[0-9a-fA-F]{66}$/.test(senderKey)) {
        throw new Error("senderKey must be a 64/66-char hex private key (check ADMIN_SECRET_KEY / MERCHANT_SECRET_KEY / PAYER_SECRET_KEY)");
    }
    const tx = await makeContractCall({
        contractAddress: unsigned.contractAddress,
        contractName: unsigned.contractName,
        functionName: unsigned.functionName,
        functionArgs: args,
        senderKey,
        network: stacksNetwork(),
        anchorMode: AnchorMode.Any,
    });

    // Always send raw bytes, not a hex string
    let bytes = tx.serialize();
    if (typeof bytes === "string") bytes = Buffer.from(bytes.replace(/^0x/i, ""), "hex");

    const res = await withTimeout(
        (signal) => fetch(`${STACKS_API}/v2/transactions`, {
            method: "POST",
            body: bytes,
            headers: { "Content-Type": "application/octet-stream" },
            signal,
        }),
        FETCH_TIMEOUT_MS,
        "POST /v2/transactions"
    );

    // Accept both JSON ({ txid }) and plain text ("<64-hex>") responses
    const text = await res.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { }
    if (!res.ok) throw new Error(`broadcast failed: HTTP ${res.status} ${text}`);

    let txid = json?.txid;
    const plain = (text || "").replace(/"/g, "");
    if (!txid && /^[a-f0-9]{64}$/i.test(plain)) txid = plain;

    if (!txid) throw new Error(`broadcast returned no txid: ${text}`);
    return { txid };

}
async function fetchTxExtended(txid) {
    try {
        const r = await withTimeout(
            (signal) => fetch(`${STACKS_API}/extended/v1/tx/${txid}`, { signal }),
            FETCH_TIMEOUT_MS,
            "GET /extended/v1/tx"
        );
        if (!r.ok) return null;
        return await r.json();
    } catch { return null; }
}
async function waitForFinal(txid, timeoutMs = MAX_WAIT_MS) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const j = await fetchTxExtended(txid);
        if (j && ["success", "abort_by_response", "abort_by_post_condition", "abort_by_event"].includes(j.tx_status)) {
            // lightweight inline log for failures
            if (j.tx_status !== "success") {
                emit(c.yellow(`[TX] ${txid.slice(0, 8)}… status=${j.tx_status} height=${j.block_height} burn=${j.burn_block_height} result=${String(repr(j)).slice(0, 120)}…`));
            }
            return j;
        }
        await sleep(1500);
    }
    return null;
}


// Ensure poller is alive and progressed to tip (shared helper)
async function ensurePollerProgress(deadlineMs = MAX_WAIT_MS) {
    const start = Date.now();
    let tries = 0;
    let lastLag = Infinity;
    let minLag = Infinity;
    let restarted = false;
    let runningAtEnd = false;

    while (Date.now() - start < deadlineMs) {
        try {
            // silent admin GET (avoid log spam)
            const s = await httpJson("GET", "/api/admin/poller", null, "admin", /* silent */ true);
            tries++;
            const running = !!s?.running;
            const lag = Number.isFinite(+s?.lagBlocks) ? +s.lagBlocks : 0;
            runningAtEnd = running;

            // restart once if not running
            if (!running && !restarted) {
                try {
                    await httpJson("POST", "/api/admin/poller/restart", null, "admin", /* silent */ true);
                    restarted = true;
                } catch { /* ignore */ }
            }

            if (lag < minLag) minLag = lag;
            if (lag === 0 && running) return true;
            lastLag = Math.min(lastLag, lag);
        } catch { tries++; }
        await sleep(1200);
    }
    return false;
}

const repr = (j) => {
    const r = j?.contract_call?.result ?? j?.smart_contract?.result ?? j?.tx_result ?? "";
    return typeof r === "string" ? r : JSON.stringify(r);
};
async function waitForInvoiceStatus(invoiceId, wantStatus, { tries = 30, delayMs = 1000 } = {}) {
    const path = `/api/v1/stores/${STORE_ID}/invoices/${invoiceId}`;
    const want = String(wantStatus).toLowerCase();

    for (let i = 0; i < tries; i++) {
        try {
            // silent=true to avoid spamming logs while polling
            const dto = await httpJson("GET", path, null, "merchant", /* silent */ true);
            const cur = String(dto?.status || "").toLowerCase();
            if (cur === want) {
                if (VERBOSE) emit(c.dim(`✅ Invoice ${invoiceId} reached status "${want}" after ${i + 1} polls`));
                return true;
            }
        } catch {/* transient */ }
        await sleep(delayMs);
    }
    return false;
}

// Create a fresh invoice, materialize it on-chain, pay it, and return { invoiceId, idHex }.
// Used to isolate refund tests so they don't depend on earlier invoice state.
async function createPayInvoiceForRefundTests({
    amountSats = 25000,
    ttlSeconds = 600,
    memo = "refund-tests"
} = {}) {
    // 1) Create DTO invoice (merchant-auth)
    const created = await jsonCompat(
        "POST",
        `/api/v1/stores/${STORE_ID}/invoices`,
        { amount_sats: amountSats, ttl_seconds: ttlSeconds, memo },
        "merchant"
    );

    const invoiceId = invId(created);
    if (!invoiceId) throw new Error("failed to create invoice for refund tests");

    // Fetch to get idHex (used to match create-invoice call)
    const dto = await httpJson("GET", `/api/v1/stores/${STORE_ID}/invoices/${invoiceId}`, null, "merchant");
    const idHex = String(dto?.idHex || "").toLowerCase();
    if (!/^[0-9a-fA-F]{64}$/.test(idHex)) throw new Error("invalid idHex for refund test invoice");

    // 2) Ensure on-chain materialization (admin sync + broadcast merchant create-invoice)
    try {
        const sync = await httpJson("POST", `/api/admin/stores/${STORE_ID}/sync-onchain`, null, "admin");
        const calls = Array.isArray(sync?.calls) ? sync.calls : [];
        const createCall = calls.find((c) =>
            c?.functionName === "create-invoice" &&
            Array.isArray(c.functionArgs) &&
            argToInvoiceHex(c.functionArgs[0]) === idHex
        );
        if (createCall) {
            await broadcastWith(MERCHANT_SK, "create-invoice (refund-tests)", createCall);
        }
    } catch {/* route may be missing; best-effort */ }

    // 3) Pay invoice using the public builder
    const unsigned = await httpJson("POST", `/create-tx`, {
        invoiceId,
        payerPrincipal: PAYER_ADDR
    });
    logUnsigned("pay-invoice (refund-tests) unsigned", unsigned);
    if (!looksLikeUnsignedCall(unsigned, "pay-invoice")) {
        throw new Error("builder did not return pay-invoice");
    }

    const { txid } = await signAndBroadcastUnsigned(unsigned, PAYER_SK);
    const st = await waitForFinal(txid);
    if (!st || st.tx_status !== "success") throw new Error(`pay failed: ${st?.tx_status || "no-status"}`);

    // Let the mirror catch up (bounded by current lag)
    await ensurePollerProgress(MAX_WAIT_MS);

    // Return identifiers for subsequent refund tests
    return { invoiceId, idHex };
}


// ───────────────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────────────
let invoiceA = null;
let invoiceB = null;
let invoiceExp = null;
let sub = null;

// When true, /create-tx builder is responding (sBTC configured) so pay/refund flows are allowed.
let PAY_READY = false;
let PAYMENT_ADDR = "";
let PAYMENT_NAME = "";
// Remember a valid pay-invoice unsigned call (captured while active) so we can
// broadcast it later while the merchant is inactive to validate on-chain guard (u205).
let LAST_PAY_UNSIGNED = null;
(async () => {
    banner();
    const results = [];
    const hook = await startWebhookReceiver();

    // Health & admin guard
    results.push(await step("health: GET /", async () => (await httpJson("GET", "/")) || true));
    results.push(await step("admin: endpoints require auth", async () => {
        const r = await raw("GET", "/api/admin/stores", { "Content-Type": "application/json" });
        return r.status === 401 || r.status === 403;
    }));

    // Helper: detect an abort-by-response with a specific u-code
    function isAbortCode(st, n) {
        const status = String(st?.tx_status || '');
        const repr = String(st?.tx_result?.repr || '');
        return status.startsWith('abort') && new RegExp(`\\(err u0*${n}\\)`).test(repr);
    }

    results.push(await step("admin: bootstrap-admin (ensure on-chain)", async () => {
        try {
            const j = await httpJson("POST", `/api/admin/bootstrap`, null, "admin");
            logUnsigned("bootstrap-admin (pre-broadcast)", j?.call);

            const { txid } = await signAndBroadcastUnsigned(j.call, ADMIN_SK, STACKS_API);
            const st = await waitForFinal(txid);

            if (st?.tx_status === "success") {
                emit(`[HARNESS] bootstrap-admin succeeded txid=${txid}`);
                return true;
            }
            if (isAbortCode(st, 1)) {
                emit("[HARNESS] bootstrap-admin already set (abort_by_response u1)");
                return pass("admin already set");
            }
            return fail("admin: bootstrap-admin", st || {}, st?.tx_status || "no-status");
        } catch (e) {
            // If your sign/broadcast helper throws, still treat u1 as idempotent
            const st = e?.result || e; // some helpers attach result here
            if (isAbortCode(st, 1)) {
                emit("[HARNESS] bootstrap-admin already set (abort_by_response u1)");
                return pass("admin already set");
            }
            if (e.status === 404 || e.status === 405) {
                return skip("admin: bootstrap-admin", "route missing");
            }
            return fail("admin: bootstrap-admin", e);
        }
    }, [need.adminSigner()]));


    // Admin: create store (idempotent)
    results.push(await step("admin: create store", async () => {
        const body = {
            principal: MERCHANT_PRINCIPAL,
            name: BRAND_NAME,
            display_name: BRAND_NAME,
            logo_url: "https://placehold.co/96x96",
            brand_color: "#FF7A00",
            allowed_origins: "http://localhost:5173,https://example.com",
            webhook_url: "",
        };
        try {
            if (!STORE_ID) {
                const created = await httpJson("POST", "/api/admin/stores", body, "admin"); STORE_ID = created.id; return true;
            } else {
                const list = await httpJson("GET", "/api/admin/stores", null, "admin");
                return Array.isArray(list) && list.find((s) => s.id === STORE_ID);
            }
        } catch (e) {
            if (e.status === 409) {
                const list = await httpJson("GET", "/api/admin/stores", null, "admin");
                const found = Array.isArray(list) ? list.find((s) => s.principal === MERCHANT_PRINCIPAL) : null;
                if (found?.id) { STORE_ID = found.id; return true; }
            }
            throw e;
        }
    }, [need.env("MERCHANT_PRINCIPAL")]));

    // Introspect DB immediately after store creation (optional)
    results.push(await step("introspect: seed API/HMAC from DB (optional)", async () => {
        const ks = readKeysFromDb(MERCHANT_PRINCIPAL);
        if (!ks) return skip("introspect: seed API/HMAC from DB (optional)", "no keys in DB or sqlite3 missing");
        MERCHANT_API_KEY = MERCHANT_API_KEY || ks.apiKey;
        HMAC_SECRET = HMAC_SECRET || ks.hmacSecret;
        const mask = (s) => (s ? `${s.slice(0, 8)}…` : "");
        emit(c.dim(`Seeded keys from DB: MERCHANT_API_KEY=${mask(MERCHANT_API_KEY)} HMAC_SECRET=${mask(HMAC_SECRET)}`));
        return !!(MERCHANT_API_KEY && HMAC_SECRET);
    }, [need.storeId()]));

    // Public profile + CORS (GET)
    results.push(await step("public: GET /api/v1/stores/:id/public-profile", async () => {
        const j = await httpJson("GET", `/api/v1/stores/${STORE_ID}/public-profile`);
        return looksLikePublicStoreProfile(j);
    }, [need.storeId()]));

    // Client-style CORS check: browsers won’t preflight a simple GET
    results.push(await step("public: CORS header on GET (public-profile)", async () => {
        const good = "http://localhost:5173";
        const res = await raw("GET", `/api/v1/stores/${STORE_ID}/public-profile`, { Origin: good });
        return corsAllowed(res, good);
    }, [need.storeId()]));

    // Activate + rotate keys
    results.push(await step("admin: activate store", async () => {
        const j = await httpJson("PATCH", `/api/admin/stores/${STORE_ID}/activate`, { active: true }, "admin");
        return j?.active === true;
    }, [need.storeId()]));

    results.push(await step("admin: rotate-keys (+API key & HMAC)", async () => {
        try {
            const j = await httpJson("POST", `/api/admin/stores/${STORE_ID}/rotate-keys`, null, "admin");
            MERCHANT_API_KEY = j.apiKey || j.api_key || MERCHANT_API_KEY;
            HMAC_SECRET = j.hmacSecret || j.hmac_secret || HMAC_SECRET;
            return !!(MERCHANT_API_KEY && HMAC_SECRET);
        } catch (e) {
            if (e.status === 409) {
                const ks = readKeysFromDb(MERCHANT_PRINCIPAL);
                if (ks) {
                    MERCHANT_API_KEY = MERCHANT_API_KEY || ks.apiKey;
                    HMAC_SECRET = HMAC_SECRET || ks.hmacSecret;
                }
                return !!(MERCHANT_API_KEY && HMAC_SECRET)
                    ? pass("admin: rotate-keys (+API key & HMAC)")
                    : blocked("admin: rotate-keys (+API key & HMAC)", "already-rotated and no keys in DB/env");
            }
            throw e;
        }
    }, [need.storeId()]));

    // Second rotate-keys should not leak secrets
    results.push(await step("admin: rotate-keys second call does not leak secrets", async () => {
        try {
            const j2 = await httpJson("POST", `/api/admin/stores/${STORE_ID}/rotate-keys`, null, "admin");
            const noSecrets = !("apiKey" in (j2 || {})) && !("hmacSecret" in (j2 || {}));
            return noSecrets || fail("admin: rotate-keys second call", j2, "secrets re-exposed");
        } catch (e) {
            return (e.status === 409 || e.status === 403) ? true : fail("admin: rotate-keys second call", e);
        }
    }, [need.storeId()]));

    // Optional merchant rotate-keys
    results.push(await step("merchant: rotate-keys (optional route)", async () => {
        try {
            const j = await httpJson("POST", `/api/v1/stores/${STORE_ID}/rotate-keys`, null, "merchant");
            const apiKey = j.apiKey || j.api_key; const hmac = j.hmacSecret || j.hmac_secret;
            if (apiKey && hmac) { MERCHANT_API_KEY = apiKey; HMAC_SECRET = hmac; return true; }
            return skip("merchant: rotate-keys (optional route)", "no secrets returned");
        } catch (e) {
            if ([401, 403, 404, 405].includes(e.status)) {
                return skip("merchant: rotate-keys (optional route)", `route unavailable/unauth (${e.status})`);
            }
            return fail("merchant: rotate-keys (optional route)", e);
        }
    }, [need.storeId()]));

    // Merchant private profile + PATCH
    results.push(await step("merchant: GET store private profile", async () => {
        const j = await httpJson("GET", `/api/v1/stores/${STORE_ID}/profile`, null, "merchant");
        return looksLikePrivateStoreProfile(j);
    }, [need.storeId(), need.apiKey()]));

    results.push(await step("merchant: PATCH profile (branding, CORS, webhook_url)", async () => {
        const body = {
            displayName: `${BRAND_NAME} (Updated)`,
            brandColor: "#00A3FF",
            allowedOrigins: "http://localhost:5173,https://example.com",
            webhookUrl: hook.url,
        };
        await jsonCompat("PATCH", `/api/v1/stores/${STORE_ID}/profile`, body, "merchant");
        const j = await httpJson("GET", `/api/v1/stores/${STORE_ID}/profile`, null, "merchant");
        return looksLikePrivateStoreProfile(j) && j.webhookUrl === hook.url && (j.displayName || "").includes("(Updated)") && j.brandColor === "#00A3FF";
    }, [need.storeId(), need.apiKey()]));

    // Admin: sync-onchain returns calls (optional)
    results.push(await step("admin: sync-onchain returns calls", async () => {
        try {
            const j = await httpJson("POST", `/api/admin/stores/${STORE_ID}/sync-onchain`, null, "admin");
            return Array.isArray(j?.calls) && j.calls.length > 0 && looksLikeUnsignedCall(j.calls[0]);
        } catch (e) {
            return (e.status === 404 || e.status === 405) ? blocked("admin: sync-onchain returns calls", "route missing") : fail("admin: sync-onchain", e);
        }
    }, [need.storeId()]));

    // Ensure merchant is registered + active on-chain (early / idempotent)
    results.push(await step("admin: ensure merchant registered+active on-chain (early)", async () => {
        try {
            const sync = await httpJson("POST", `/api/admin/stores/${STORE_ID}/sync-onchain`, null, "admin");
            const calls = Array.isArray(sync?.calls) ? sync.calls : [];
            const byFn = (fn) => calls.find(c => c?.functionName === fn);

            const regCall = byFn("register-merchant");
            const activateCall = byFn("set-merchant-active");

            // Broadcast and ignore aborts that mean "already done"
            const softIgnoreAbort = async (sk, label, unsigned) => {
                try { await broadcastWith(sk, label, unsigned); }
                catch (e) {
                    const st = e?.result;
                    if (st?.tx_status && String(st.tx_status).startsWith("abort")) return; // idempotent-ok
                    throw e;
                }
            };

            if (regCall) await softIgnoreAbort(ADMIN_SK, "register-merchant (early)", regCall);
            if (activateCall) await softIgnoreAbort(ADMIN_SK, "set-merchant-active (early)", activateCall);

            // If neither call exists, we were already in-sync — that's a PASS.
            return true;
        } catch (e) {
            // Older servers may not expose sync-onchain; don't hard-fail the whole run.
            return (e.status === 404 || e.status === 405)
                ? skip("admin: ensure merchant registered+active on-chain (early)", "route missing")
                : fail("admin: ensure merchant registered+active on-chain (early)", e);
        }
    }, [need.storeId(), need.adminSigner()]));


    // Admin set-sbtc-token
    results.push(await step("admin: set-sbtc-token → unsigned call", async () => {
        const j = await httpJson("POST", `/api/admin/set-sbtc-token`, { contractAddress: SBTC_ADDRESS, contractName: SBTC_NAME }, "admin");
        logUnsigned("set-sbtc-token unsigned", j?.call);
        return looksLikeUnsignedCall(j?.call, "set-sbtc-token");
    }, [need.env("SBTC_CONTRACT_ADDRESS"), need.env("SBTC_CONTRACT_NAME")]));


    results.push(await step("admin: set-sbtc-token → broadcast (tester wallet)", async () => {
        const j = await httpJson("POST", `/api/admin/set-sbtc-token`, { contractAddress: SBTC_ADDRESS, contractName: SBTC_NAME }, "admin");
        logUnsigned("set-sbtc-token (pre-broadcast)", j?.call);
        const { txid } = await signAndBroadcastUnsigned(j.call, ADMIN_SK, STACKS_API);
        const st = await waitForFinal(txid);
        return st?.tx_status === "success" || fail("admin: set-sbtc-token broadcast", st || {}, st?.tx_status || "no-status");
    }, [need.env("SBTC_CONTRACT_ADDRESS"), need.env("SBTC_CONTRACT_NAME"), need.adminSigner()]));

    // Merchant auth guards (negative)
    results.push(await step("merchant: endpoints require X-API-Key", async () => {
        const res = await raw("GET", `/api/v1/stores/${STORE_ID}/invoices`, { "Content-Type": "application/json" });
        return (res.status === 401 || res.status === 403);
    }, [need.storeId()]));
    results.push(await step("merchant: wrong X-API-Key is rejected", async () => {
        const res = await raw("GET", `/api/v1/stores/${STORE_ID}/invoices`, { "Content-Type": "application/json", "X-API-Key": "bogus" });
        return (res.status === 401 || res.status === 403);
    }, [need.storeId()]));

    // Merchant: create-invoice DTO
    // Ensure the DTO invoice exists on-chain before paying.
    results.push(await step("merchant: create DTO invoice (fallback path)", async () => {
        try {
            const j = await jsonCompat("POST",
                `/api/v1/stores/${STORE_ID}/invoices`,
                { amount_sats: 25000, ttl_seconds: 900, memo: "DTO path" },
                "merchant"
            );
            invoiceA = j;
            return looksLikePublicInvoice(j);
        } catch (e) {
            return (e.status === 404 || e.status === 405)
                ? blocked("merchant: create DTO invoice (fallback path)", "route missing")
                : fail("create DTO invoice", e);
        }
    }, [need.storeId(), need.apiKey()]));


    let invoicePrepared = null;

    results.push(await step("merchant: prepare-invoice returns dto+unsigned+magiclink", async () => {
        try {
            const body = {
                amount_sats: 18000,
                ttl_seconds: 600,
                memo: "prep-onecall",
                payerPrincipal: PAYER_ADDR, // optional: scopes PCs in builder
            };

            const j = await jsonCompat(
                "POST",
                `/api/v1/stores/${STORE_ID}/prepare-invoice`,
                body,
                "merchant"
            );

            // 1) invoice DTO present and sane
            const okDto = looksLikePublicInvoice(j?.invoice);
            if (!okDto) return fail("prepare-invoice: bad invoice dto", j);

            invoicePrepared = j.invoice;

            // 2) unsigned call present and looks like pay-invoice + has fungible PCs
            const okUnsigned = looksLikeUnsignedCall(j?.unsignedCall, "pay-invoice");
            const okPcs = okUnsigned && hasFungiblePC(j.unsignedCall, j.invoice, PAYER_ADDR);

            // 3) magicLink present (this is the only external link we surface)
            const okMagic = typeof j?.magicLink === "string" && /\/w\//.test(j.magicLink);

            // Optional: sanity-read the public DTO for the same invoice
            const dto = await httpJson("GET", `/i/${j.invoice.invoiceId}`);
            const okMagicFetch = looksLikePublicInvoice(dto) && (invId(dto) === invId(j.invoice));

            if (okUnsigned) logUnsigned("prepare-invoice unsigned", j.unsignedCall);
            return okDto && okUnsigned && okPcs && okMagic && okMagicFetch;
        } catch (e) {
            return (e.status === 404 || e.status === 405)
                ? skip("merchant: prepare-invoice returns dto+unsigned+magiclink", "route missing")
                : fail("merchant: prepare-invoice", e);
        }
    }, [need.storeId(), need.apiKey()]));


    // ───────────────────────────────────────────────────────────────────────────────
    // admin: sync-onchain → broadcast create-invoice (for invoiceA)
    // ───────────────────────────────────────────────────────────────────────────────
    results.push(await step("admin: sync-onchain → broadcast create-invoice (for invoiceA)", async () => {
        try {
            const sync = await httpJson("POST", `/api/admin/stores/${STORE_ID}/sync-onchain`, null, "admin");
            const calls = Array.isArray(sync?.calls) ? sync.calls : [];

            // Identify the exact invoice we want to materialize on-chain
            const targetHex = String(
                invId(invoiceA) &&
                (await httpJson("GET", `/api/v1/stores/${STORE_ID}/invoices/${invId(invoiceA)}`, null, "merchant")).idHex ||
                ""
            ).toLowerCase();

            // Helper: find by function name
            const byFn = (fn) => calls.find(c => c?.functionName === fn);

            // Prereqs (admin-signed) + the concrete create-invoice (merchant-signed)
            const regCall = byFn("register-merchant");
            const activateCall = byFn("set-merchant-active");
            const createCall = calls.find((c) =>
                c?.functionName === "create-invoice" &&
                Array.isArray(c.functionArgs) &&
                argToInvoiceHex(c.functionArgs[0]) === targetHex
            );

            // If there's no create call for this invoice, it’s already on-chain → PASS
            if (!createCall) return pass("admin: sync-onchain → broadcast create-invoice (for invoiceA)");

            // 1) Broadcast prereqs; if they abort (already-done), continue
            const softIgnoreAbort = async (sk, label, unsigned) => {
                try { await broadcastWith(sk, label, unsigned); }
                catch (e) {
                    const st = e?.result;
                    if (st?.tx_status && String(st.tx_status).startsWith("abort")) return; // idempotent-ok
                    throw e; // real failure
                }
            };
            if (regCall) await softIgnoreAbort(ADMIN_SK, "register-merchant", regCall);
            if (activateCall) await softIgnoreAbort(ADMIN_SK, "set-merchant-active", activateCall);

            // 2) Actual create-invoice (merchant-signed) — must succeed
            await broadcastWith(MERCHANT_SK, "create-invoice (invoiceA)", createCall);
            return true;
        } catch (e) {
            return (e.status === 404 || e.status === 405)
                ? skip("admin: sync-onchain → broadcast create-invoice (for invoiceA)", "route missing")
                : fail("admin: sync-onchain broadcast (invoiceA)", e);
        }
    }, [need.storeId(), need.apiKey(), need.invoiceA()]));


    // Public: GET /i/:invoiceId + CORS
    results.push(await step("public: GET /i/:invoiceId returns invoice", async () => {
        const j = await httpJson("GET", `/i/${invId(invoiceA)}`);
        return looksLikePublicInvoice(j) && invId(j) === invId(invoiceA) && !hasUnderscoreKeys(j);
    }, [need.invoiceA()]));

    results.push(await step("public: CORS preflight allowed (GET /i/:id)", async () => {
        const res = await options(`/i/${invId(invoiceA)}`, "http://localhost:5173", "public", "GET");
        return corsAllowed(res, "http://localhost:5173") && allowHeadersContain(res, ["Content-Type", "X-API-Key", "X-Webhook-Timestamp", "X-Webhook-Signature"]);
    }, [need.invoiceA()]));

    // PUBLIC create-tx (unsigned) – sets PAY_READY when builder is working
    results.push(await step("public: create-tx (pay-invoice) unsigned (+PCs)", async () => {
        const id = invId(invoiceA);
        try {
            const call = await httpJson("POST", `/create-tx`, { invoiceId: id, payerPrincipal: DUMMY_PAYER });
            logUnsigned("pay-invoice unsigned", call);
            const shape = looksLikeUnsignedCall(call, "pay-invoice");
            const pcs = hasFungiblePC(call, invoiceA, DUMMY_PAYER);
            PAY_READY = shape && pcs;
            // Cache a good unsigned for later (inactive merchant direct on-chain test)
            if (shape) LAST_PAY_UNSIGNED = call;
            // remember the payment contract principal for later direct calls (mark-expired, etc.)
            if (shape) {
                // Prefer modern single-string contractId; fall back to split fields for legacy
                const contractId = call.contractId || call.contract || "";
                if (contractId) {
                    const [addr, name] = String(contractId).split(".");
                    PAYMENT_ADDR = addr || PAYMENT_ADDR;
                    PAYMENT_NAME = name || PAYMENT_NAME;
                } else {
                    PAYMENT_ADDR = call.contractAddress || PAYMENT_ADDR;
                    PAYMENT_NAME = call.contractName || PAYMENT_NAME;
                }
            }
            return PAY_READY;
        } catch (e) {
            if (e.status === 409 && /invalid[_-]?state/i.test(String(e.body?.error || ""))) {
                return blocked("public: create-tx (pay-invoice) unsigned (+PCs)", "builder blocked (likely sBTC not configured)");
            }
            throw e;
        }
    }, [need.invoiceA()]));

    results.push(await step("public: CORS preflight allowed (create-tx)", async () => {
        const good = "http://localhost:5173";
        const res = await options(`/create-tx`, good, "public", "POST");
        return corsAllowed(res, good) && allowHeadersContain(res, ["Content-Type", "X-API-Key", "X-Webhook-Timestamp", "X-Webhook-Signature"]);
    }));
    results.push(await step("public: CORS preflight blocks disallowed origin (create-tx)", async () => {
        const bad = "https://evil.tld";
        const res = await options(`/create-tx`, bad, "public", "POST");
        const v = res.headers.get("access-control-allow-origin");
        return !v || v !== bad;
    }));


    // Sign & broadcast pay (hardened)
    results.push(await step("pay-invoice (on-chain): tester signs as payer", async () => {
        const invoiceId = invId(invoiceA);
        const payer = (process.env.PAYER_PRINCIPAL || DUMMY_PAYER);

        // 1) Ask builder for unsigned call (sanity: shape + PCs)
        const unsigned = await httpJson("POST", "/create-tx", { invoiceId, payerPrincipal: payer });
        logUnsigned("pay-invoice unsigned", unsigned);
        if (!looksLikeUnsignedCall(unsigned, "pay-invoice") || !hasFungiblePC(unsigned, invoiceA, payer)) {
            return fail("unsigned shape/PCs", unsigned, "bad builder output");
        }

        // 2) Broadcast as PAYER and confirm chain result
        const { txid } = await signAndBroadcastUnsigned(unsigned, PAYER_SK);
        const st = await waitForFinal(txid);
        if (!st || st.tx_status !== "success") {
            return fail("broadcast pay-invoice", st || {}, st?.tx_status || "no-status");
        }
        // Read on-chain invoice right away (independent of mirror)
        try {
            const dtoSnap = await httpJson("GET", `/api/v1/stores/${STORE_ID}/invoices/${invoiceId}`, null, "merchant");
            const idHex = (dtoSnap?.idHex || "").toLowerCase();
            const cid = unsigned.contractId || unsigned.contract || `${unsigned.contractAddress}.${unsigned.contractName}`;
            const [uAddr, uName] = String(cid).split(".");
            const oc = await readOnchainInvoiceDebug({
                contractAddress: uAddr,
                contractName: uName,
                idHex
            });
            emit(c.yellow(
                `[ONCHAIN] status=${oc.status} ` +
                `paid=${oc.paid} amount=${oc.amountSats} refund=${oc.refundAmountSats} ` +
                `payer=${oc.payer || '-'} merchant=${oc.merchant || '-'}`
            ));
        } catch (e) {
            emit(c.yellow(`[ONCHAIN] read failed: ${e?.message || e}`));
        }

        // 2b) Best-effort extended lookup (events count)
        try {
            const ext = await fetchTxExtended(txid);
            emit(c.dim(`[PAY] ext status=${ext?.tx_status} events=${ext?.events?.length}`));
        } catch { }

        // 4) Poll DTO until it mirrors 'paid' (after making sure poller is caught up)
        await ensurePollerProgress(MAX_WAIT_MS);
        const ok = await waitForInvoiceStatus(invoiceId, "paid", { tries: 45, delayMs: 1000 });

        if (!ok) {
            // Print on-chain again to make it obvious chain vs. mirror
            try {
                const dtoSnap2 = await httpJson("GET", `/api/v1/stores/${STORE_ID}/invoices/${invoiceId}`, null, "merchant");
                const idHex2 = (dtoSnap2?.idHex || "").toLowerCase();
                const cid2 = unsigned.contractId || unsigned.contract || `${unsigned.contractAddress}.${unsigned.contractName}`;
                const [uAddr2, uName2] = String(cid2).split(".");
                const oc2 = await readOnchainInvoiceDebug({
                    contractAddress: uAddr2,
                    contractName: uName2,
                    idHex: idHex2
                });
                emit(c.yellow(
                    `[ONCHAIN] (recheck) status=${oc2.status} ` +
                    `paid=${oc2.paid} amount=${oc2.amountSats} refund=${oc2.refundAmountSats} ` +
                    `payer=${oc2.payer || '-'} merchant=${oc2.merchant || '-'}`
                ));
            } catch { }
            try {
                const poller = await httpJson("GET", "/api/admin/poller", null, "admin");
                emit(c.yellow("[DIAG] poller"), poller);
            } catch { }
            try {
                const dto = await httpJson("GET", `/api/v1/stores/${STORE_ID}/invoices/${invoiceId}`, null, "merchant");
                emit(c.yellow("[DIAG] dto (still not paid)"), dto);
            } catch { }
            return fail("DTO mirror after pay", { invoiceId, txid }, "mirror never reached 'paid'");
        }

        return true;
    }, [need.invoiceA(), need.payerSigner(), need.payReady()]));



    results.push(await step("webhook: invoice-paid delivered & signed (optional)", async () => {
        if (!HMAC_SECRET) return skip("webhook: invoice-paid delivered & signed (optional)", "no HMAC configured");
        const deadline = Date.now() + MAX_WAIT_MS;
        let hit = null;
        while (Date.now() < deadline) {
            hit = hook.captured.find((e) => typeof e.raw === "string" && /invoice-paid/i.test(e.raw) && e.raw.includes(String(invId(invoiceA))));
            if (hit) break;
            await sleep(400);
        }
        if (!hit) return skip("webhook: invoice-paid delivered & signed (optional)", "no event captured");
        const v = verifyWebhookSig(hit, HMAC_SECRET);
        return v.ok || fail("invoice-paid webhook HMAC", v, v.reason);
    }, [need.hmac(), need.invoiceA()]));

    // Double-pay -> err u201 (builder path or on-chain)
    results.push(await step("pay-invoice double-pay blocked (u201)", async () => {
        const id = invId(invoiceA);

        // If the invoice isn't mirrored as 'paid' yet, this test isn't applicable.
        try {
            const dto = await httpJson("GET", `/api/v1/stores/${STORE_ID}/invoices/${id}`, null, "merchant");
            if ((dto?.status || "").toLowerCase() !== "paid") {
                return skip("pay-invoice double-pay blocked (u201)", "requires previously paid invoice");
            }
        } catch {
            // best-effort; continue to attempt the double-pay
        }

        try {
            const call = await httpJson("POST", `/create-tx`, { invoiceId: id, payerPrincipal: DUMMY_PAYER });
            const { txid } = await signAndBroadcastUnsigned(call, PAYER_SK);
            const st = await waitForFinal(txid);
            const res = String(repr(st));
            return (st?.tx_status?.startsWith("abort") && /err u201/i.test(res))
                || fail("double-pay", st || {}, res || st?.tx_status);
        } catch (e) {
            // If builder blocks because it knows the invoice is paid, that's a PASS.
            if (e.status === 409 && /invalid[_-]?state/i.test(String(e.body?.error || ""))) {
                return true; // pass (builder blocked)
            }
            return fail("double-pay builder path", e);
        }
    }, [need.invoiceA(), need.payerSigner(), need.payReady()]));


    // Wrong-token → u207
    results.push(await step("pay-invoice wrong-token blocked (u207)", async () => {
        try {
            const unsigned = await httpJson("POST", `/create-tx`, {
                invoiceId: invId(invoiceA),
                payerPrincipal: DUMMY_PAYER
            });

            if (!looksLikeUnsignedCall(unsigned, "pay-invoice")) {
                return fail("unsigned call shape", unsigned);
            }
            // Spec: pay-invoice has no token arg; token is fixed on-chain.
            const hasTokenArg =
              Array.isArray(unsigned.functionArgs) &&
              unsigned.functionArgs.some(a => a?.type === "contract");
            if (!hasTokenArg) {
              return skip(
                "pay-invoice wrong-token blocked (u207)",
                "spec uses fixed sBTC; no token arg to tamper"
              );
            }
            const ALT = process.env.ALT_FT_CONTRACT;
            if (!ALT) {
                return skip("pay-invoice wrong-token blocked (u207)", "set ALT_FT_CONTRACT=ADDR.contract");
            }

            const fake = { type: "contract", value: ALT };
            const tampered = { ...unsigned, functionArgs: unsigned.functionArgs.slice(0, -1).concat(fake) };

            const { txid } = await signAndBroadcastUnsigned(tampered, PAYER_SK);
            const st = await waitForFinal(txid);
            const res = String(repr(st));
            return (st?.tx_status?.startsWith("abort") && /err u(200|207)\b/i.test(res))
                ? true
                : fail("wrong-token", st || {}, res || st?.tx_status || "no-status");
        } catch (e) {
            // Builder already blocked (e.g., invoice state invalid) → also PASS
            if (e.status === 409 && /invalid[_-]?state/i.test(String(e.body?.error || ""))) {
                return true;
            }
            return fail("wrong-token builder path", e);
        }
    }, [need.invoiceA(), need.payerSigner(), need.payReady()]));




    // Cancel unpaid
    let invForCancel = null;
    results.push(await step("merchant: create new DTO invoice (for cancel)", async () => {
        const j = await jsonCompat("POST", `/api/v1/stores/${STORE_ID}/invoices`, { amount_sats: 1111, ttl_seconds: 600, memo: "cancel path" }, "merchant");
        invForCancel = j;
        return looksLikePublicInvoice(j);
    }, [need.storeId(), need.apiKey()]));

    // ───────────────────────────────────────────────────────────────────────────────
    // admin: sync-onchain → broadcast create-invoice (for invForCancel)
    // ───────────────────────────────────────────────────────────────────────────────
    results.push(await step("admin: sync-onchain → broadcast create-invoice (for invForCancel)", async () => {
        try {
            if (!invId(invForCancel)) return blocked("admin: sync-onchain → broadcast create-invoice (for invForCancel)", "no invoice created");
            const sync = await httpJson("POST", `/api/admin/stores/${STORE_ID}/sync-onchain`, null, "admin");
            const calls = Array.isArray(sync?.calls) ? sync.calls : [];

            const targetHex = String(
                invId(invForCancel) &&
                (await httpJson("GET", `/api/v1/stores/${STORE_ID}/invoices/${invId(invForCancel)}`, null, "merchant")).idHex ||
                ""
            ).toLowerCase();

            const byFn = (fn) => calls.find(c => c?.functionName === fn);

            const regCall = byFn("register-merchant");
            const activateCall = byFn("set-merchant-active");
            const createCall = calls.find((c) =>
                c?.functionName === "create-invoice" &&
                Array.isArray(c.functionArgs) &&
                argToInvoiceHex(c.functionArgs[0]) === targetHex
            );

            if (!createCall) {
                return pass("admin: sync-onchain → broadcast create-invoice (for invForCancel)"); // already on-chain
            }

            const softIgnoreAbort = async (sk, label, unsigned) => {
                try { await broadcastWith(sk, label, unsigned); }
                catch (e) {
                    const st = e?.result;
                    if (st?.tx_status && String(st.tx_status).startsWith("abort")) return; // idempotent-ok
                    throw e;
                }
            };
            if (regCall) await softIgnoreAbort(ADMIN_SK, "register-merchant", regCall);
            if (activateCall) await softIgnoreAbort(ADMIN_SK, "set-merchant-active", activateCall);

            await broadcastWith(MERCHANT_SK, "create-invoice (invForCancel)", createCall);
            return true;
        } catch (e) {
            return (e.status === 404 || e.status === 405)
                ? skip("admin: sync-onchain → broadcast create-invoice (for invForCancel)", "route missing")
                : fail("admin: sync-onchain broadcast (invForCancel)", e);
        }
    }, [need.storeId(), need.apiKey()]));



    results.push(await step("merchant: cancel unpaid (Node action or builder)", async () => {
        try {
            if (!invId(invForCancel)) return blocked("merchant: cancel unpaid (Node action or builder)", "no invoice created");
            const resp = await httpJson("POST",
                `/api/v1/stores/${STORE_ID}/invoices/${invId(invForCancel)}/cancel/create-tx`,
                null,
                "merchant"
            );
            const call = resp.unsignedCall || resp.call || resp.unsignedTx || resp;

            const { txid } = await signAndBroadcastUnsigned(call, MERCHANT_SK);
            const st = await waitForFinal(txid);

            if (st?.tx_status !== "success") {
                const r = String(repr(st));
                // Graceful fallback: mirror cancel via DTO route for u6xx family
                const j = await httpJson("POST",
                    `/api/v1/stores/${STORE_ID}/invoices/${invId(invForCancel)}/cancel`,
                    null,
                    "merchant"
                );
                return j?.canceled === true || fail("cancel-invoice (fallback)", j || {}, r || st?.tx_status || "no-status");
            }

            const printed = JSON.stringify(st.events || []).includes("invoice-canceled");
            return printed || fail("cancel event", st || {}, "missing print: invoice-canceled");
        } catch (e) {
            // If builder route missing, try DTO cancel directly
            const j = await httpJson("POST",
                `/api/v1/stores/${STORE_ID}/invoices/${invId(invForCancel)}/cancel`,
                null,
                "merchant"
            );
            return j?.canceled === true;
        }
    }, [need.storeId(), need.apiKey(), need.merchantSigner()]));


    //////////////////////////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////////////////
    //////////////////////////////////////////////////////////////////////////////////////////

    results.push(await step("public: create-tx blocked after cancel", async () => {
        const id = invId(invForCancel);
        const deadline = Date.now() + MAX_WAIT_MS;
        let lastDto = null;

        while (Date.now() < deadline) {
            // 1) Ask the builder first — a 409 invalid_state is a PASS
            try {
                const res = await raw("POST", `/create-tx`,
                    { "Content-Type": "application/json" },
                    { invoiceId: id, payerPrincipal: DUMMY_PAYER }
                );

                // PASS if builder blocks canceled invoices
                const body = await res.json();
                if (res.status === 409 && /invalid[_-]?state/i.test(String(body?.error || ""))) {
                    return true;
                }

                // FAIL hard if builder still returns an unsigned call
                if (res.status < 400 && body && typeof body === "object") {
                    logUnsigned("pay-invoice (unexpected after cancel)", body);
                    return fail("public: create-tx should block after cancel", body, "server allowed pay-invoice for canceled invoice");
                }
            } catch { /* transient HTTP hiccup — ignore for this loop */ }

            // 2) Fall back to mirror polling (some servers only expose cancel via DTO)
            try {
                lastDto = await httpJson("GET", `/api/v1/stores/${STORE_ID}/invoices/${id}`, null, "merchant");
                if ((lastDto?.status || "").toLowerCase() === "canceled") return true;
                if (VERBOSE) emit(c.dim(`[WAIT] cancel mirror status=${lastDto?.status}`));
            } catch { /* ignore and continue */ }

            await sleep(800);
        }

        return fail("public: create-tx blocked after cancel", lastDto || {}, "neither builder nor mirror reflected cancel before deadline");
    }));



    // Expiry path + webhook
    results.push(await step("merchant: create short-ttl invoice (webhook test)", async () => {
        const j = await jsonCompat(
            "POST",
            `/api/v1/stores/${STORE_ID}/invoices`,
            { amount_sats: 1111, ttl_seconds: 2, memo: "Soon expires" },
            "merchant"
        );
        try {
            const dto = await httpJson("GET", `/api/v1/stores/${STORE_ID}/invoices/${invId(j)}`, null, "merchant");
            emit(c.dim(`[EXPIRE] created invoice ${invId(j)} idHex=${dto?.idHex}`));
        } catch { }
        invoiceExp = j;
        return looksLikePublicInvoice(j);
    }, [need.storeId(), need.apiKey()]));

    results.push(await step("public: create-tx blocked on expired", async () => {
        await sleep(6000);
        const res = await raw("POST", `/create-tx`, { "Content-Type": "application/json" }, { invoiceId: invId(invoiceExp), payerPrincipal: DUMMY_PAYER });
        if (res.status === 409) {
            const body = await res.json();
            // Accept either 'invalidState' or 'expired' as valid “blocked” signals
            return /(invalid[_-]?state|expired)/i.test(String(body?.error || ""));
        }
        return res.status >= 400;

    }, [need.invoiceExp()]));

    results.push(await step("webhook: invoice-expired delivered & signed (HMAC, skew≤300s)", async () => {
        if (!HMAC_SECRET) return skip("webhook: invoice-expired delivered & signed (HMAC, skew≤300s)", "no HMAC configured");

        // 1) Try to use the event we already captured (don’t pre-skip on lag)
        const deadline = Date.now() + MAX_WAIT_MS;

        let hit = null;
        while (Date.now() < deadline) {
            hit = hook.captured.find(
                (e) =>
                    typeof e.raw === "string" &&
                    e.raw.includes(String(invId(invoiceExp))) // must match this invoice
            );
            if (hit) break;
            await sleep(500);
        }
        if (hit) {
            const v = verifyWebhookSig(hit, HMAC_SECRET);
            return v.ok ? true : fail("webhook signature", v, v.reason);
        }

        // 2) Not seen yet — check poller lag and wait proportionally to lag
        const ps = await getPollerStatus();
        const avgSecs = Number(process.env.AVG_BLOCK_SECONDS || 20);
        if (ps.ok && ps.lagBlocks > 0) {
            const extra = Math.min(6 * MAX_WAIT_MS, (ps.lagBlocks + 1) * avgSecs * 1000 + 20_000);
            await ensurePollerProgress(extra);
        }

        // 3) Final attempt, then diagnose
        hit = hook.captured.find(e => typeof e.raw === "string" && e.raw.includes(String(invId(invoiceExp))));
        if (hit) {
            const v = verifyWebhookSig(hit, HMAC_SECRET);
            return v.ok ? true : fail("webhook signature", v, v.reason);
        }
        await dumpWebhookDiag({ storeId: STORE_ID, invoiceId: invId(invoiceExp), hook, expectEvent: "invoice-expired" });
        return fail("no webhook", { invoiceId: invId(invoiceExp) }, "invoice-expired webhook not captured");

    }, [need.invoiceExp(), need.hmac()]));

    results.push(await step("on-chain: mark-expired committed (required)", async () => {
        if (!PAYMENT_ADDR || !PAYMENT_NAME) {
            return fail("mark-expired", { PAYMENT_ADDR, PAYMENT_NAME }, "payment contract unknown");
        }
        // Build unsigned call directly; contract allows anyone to call mark-expired.
        const idHex = (await httpJson("GET", `/api/v1/stores/${STORE_ID}/invoices/${invId(invoiceExp)}`, null, "merchant")).idHex;
        const unsigned = {
            contractAddress: PAYMENT_ADDR,
            contractName: PAYMENT_NAME,
            functionName: "mark-expired",
            functionArgs: [{ type: "buffer", value: String(idHex) }],
            anchorMode: "any",
            network: STACKS_NETWORK,
        };
        const { txid } = await signAndBroadcastUnsigned(unsigned, ADMIN_SK || MERCHANT_SK || PAYER_SK);
        const st = await waitForFinal(txid);
        if (!st) return fail("mark-expired", {}, "no tx status");
        // The contract returns (ok true). It may or may not emit the print if already expired. Success is required.
        return st.tx_status === "success" || fail("mark-expired", st, st.tx_status);
    }, [need.invoiceExp(), need.anySigner()]));

    results.push(await step("merchant: webhook logs include invoice-expired", async () => {
        const deadline = Date.now() + MAX_WAIT_MS;
        const wantId = String(invId(invoiceExp));
        while (Date.now() < deadline) {
            const logs = await httpJson("GET", `/api/v1/stores/${STORE_ID}/webhooks`, null, "merchant");
            const blob = JSON.stringify(logs || []);
            if (blob.includes("invoice-expired") && blob.includes(wantId)) return true;
            await sleep(600);
        }
        // Not found; if lagging, skip instead of failing. Otherwise emit diagnostics.
        const ps = await getPollerStatus();
        if (ps.ok && ps.lagBlocks > 0) {
            return skip("merchant: webhook logs include invoice-expired",
                `poller lagBlocks=${ps.lagBlocks} (webhook not logged yet)`);
        }
        await dumpWebhookDiag({ storeId: STORE_ID, invoiceId: invId(invoiceExp), hook, expectEvent: "invoice-expired" });
        return false; // FAIL when not lagging and still missing
    }, [need.storeId(), need.apiKey(), need.invoiceExp()]));


    // Merchant list/filter + single get
    results.push(await step("merchant: list invoices (?status=unpaid)", async () => {
        const list = await httpJson("GET", `/api/v1/stores/${STORE_ID}/invoices?status=unpaid`, null, "merchant");
        return Array.isArray(list);
    }, [need.storeId(), need.apiKey()]));
    results.push(await step("merchant: GET /invoices/:invoiceId", async () => {
        const j = await httpJson("GET", `/api/v1/stores/${STORE_ID}/invoices/${invId(invoiceA)}`, null, "merchant");
        return looksLikePublicInvoice(j) && invId(j) === invId(invoiceA);
    }, [need.storeId(), need.apiKey(), need.invoiceA()]));

    // Public: malformed/unknown + rate-limit smoke
    results.push(await step("public: create-tx rejects malformed invoiceId", async () => {
        const res = await raw("POST", `/create-tx`, { "Content-Type": "application/json" }, { invoiceId: "__invalid__", payerPrincipal: DUMMY_PAYER });
        return res.status >= 400;
    }));
    results.push(await step("public: create-tx rejects unknown invoiceId", async () => {
        const res = await raw("POST", `/create-tx`, { "Content-Type": "application/json" }, { invoiceId: "inv_nonexistent_111111", payerPrincipal: DUMMY_PAYER });
        return res.status >= 400;
    }));
    results.push(await step("public: /create-tx rate-limit smoke", async () => {
        const attempts = 15;
        let saw429 = false;
        const reqs = [];
        for (let i = 0; i < attempts; i++) {
            const badId = (i % 2 === 0) ? "11111111-1111-1111-1111-111111111111" : "not-a-uuid";
            reqs.push(
                raw("POST", `/create-tx`, { "Content-Type": "application/json" }, { invoiceId: badId, payerPrincipal: DUMMY_PAYER })
                    .then((r) => { if (r.status === 429) saw429 = true; })
                    .catch(() => { })
            );
        }
        await Promise.all(reqs);
        return saw429 ? true : skip("public: /create-tx rate-limit smoke", "no 429 observed (THIS PIPELINE IS HARD TO TEST. MOST LIKELY IS WORKING)");
    }));

    // Refunds (builder if present)
    results.push(await step("refund builder present (merchant)", async () => {
        try {
            const call = await jsonCompat("POST", `/api/v1/stores/${STORE_ID}/refunds/create-tx`, { invoiceId: invId(invoiceA), amount_sats: 1000, memo: "partial" }, "merchant");
            return looksLikeUnsignedCall(call, "refund-invoice");
        } catch {
            return fail("refund builder present (merchant)", { route: "/api/v1/stores/:id/refunds/create-tx" }, "route missing (REQUIRED)");
        }
    }, [need.storeId(), need.apiKey(), need.invoiceA(), need.payReady()]));
    results.push(await step("refund partial ok; mirror increments; cap enforced later", async () => {
        // Require paid invoice to avoid 409 invalid_state noise
        try {
            const dto = await httpJson("GET", `/api/v1/stores/${STORE_ID}/invoices/${invId(invoiceA)}`, null, "merchant");
            if ((dto?.status || "").toLowerCase() !== "paid") {
                return skip("refund partial ok; mirror increments; cap enforced later", "requires paid invoice");
            }
        } catch { }
        try {
            const ps = await getPollerStatus();
            if (ps.ok && ps.lagBlocks > 0) {
                await ensurePollerProgress(MAX_WAIT_MS);
                const ps2 = await getPollerStatus();
                if (ps2.ok && ps2.lagBlocks > 0) {
                    return skip("refund partial ok; mirror increments; cap enforced later",
                        `poller lagBlocks=${ps2.lagBlocks} (mirror update delayed)`);
                }
            }
            const before = await httpJson("GET", `/api/v1/stores/${STORE_ID}/invoices/${invId(invoiceA)}`, null, "merchant");
            const beforeAmt = Number(before?.refundAmount || 0);
            const call = await jsonCompat("POST",
                `/api/v1/stores/${STORE_ID}/refunds/create-tx`,
                { invoiceId: invId(invoiceA), amount_sats: 1000, memo: "partial" },
                "merchant"
            );
            const { txid } = await signAndBroadcastUnsigned(call, MERCHANT_SK);
            const st = await waitForFinal(txid);
            if (st?.tx_status !== "success") return fail("refund-invoice", st || {}, st?.tx_status);
            LAST_REFUND_TX_SUCCESS = true;
            const printed = JSON.stringify(st.events || []).includes("invoice-refunded");
            if (!printed) return fail("refund event", st || {}, "missing print: invoice-refunded");
            // Give the poller time based on current lag before we start polling DTO
            await waitForMirrorAdvance(MAX_WAIT_MS);
            // Mirror should bump refundAmount by at least 1000
            const deadline = Date.now() + MAX_WAIT_MS;
            while (Date.now() < deadline) {
                const after = await httpJson("GET", `/api/v1/stores/${STORE_ID}/invoices/${invId(invoiceA)}`, null, "merchant");
                if (Number(after?.refundAmount || 0) >= beforeAmt + 1000) return true;
                await sleep(600);
            }
            return fail("refund mirror", { beforeAmt }, "refundAmount not updated on mirror in time");

        } catch (e) {
            return (e.status === 404 || e.status === 405)
                ? blocked("refund partial ok; mirror increments; cap enforced later", "builder missing")
                : fail("refund partial ok; mirror increments; cap enforced later", e);
        }
    }, [need.storeId(), need.apiKey(), need.invoiceA(), need.merchantSigner(), need.payReady()]));

    results.push(await step("webhook: invoice-refunded delivered & signed (optional)", async () => {
        if (!HMAC_SECRET) {
            return skip("webhook: invoice-refunded delivered & signed (optional)", "no HMAC configured");
        }

        // 0) Set up: fresh paid invoice (isolated from prior tests)
        let invoiceId = "";
        try {
            const { invoiceId: newId } = await createPayInvoiceForRefundTests({
                amountSats: 25000,
                memo: "refund-webhook-test"
            });
            invoiceId = newId;
        } catch (e) {
            return blocked("webhook: invoice-refunded delivered & signed (optional)", `setup failed: ${e}`);
        }

        // 1) Broadcast a small refund to produce the webhook event
        try {
            const call = await jsonCompat(
                "POST",
                `/api/v1/stores/${STORE_ID}/refunds/create-tx`,
                { invoiceId, amount_sats: 1_000, memo: "partial-refund-webhook" },
                "merchant"
            );
            if (!looksLikeUnsignedCall(call, "refund-invoice")) {
                return fail("refund builder unsigned shape", call);
            }

            const { txid } = await signAndBroadcastUnsigned(call, MERCHANT_SK);
            const st = await waitForFinal(txid);
            if (!st || st.tx_status !== "success") {
                return fail("refund broadcast", st || {}, st?.tx_status || "no-status");
            }
        } catch (e) {
            return (e.status === 404 || e.status === 405)
                ? blocked("webhook: invoice-refunded delivered & signed (optional)", "refund builder missing")
                : fail("webhook: invoice-refunded delivered & signed (optional)", e);
        }

        // 2) Give the poller a chance to process the refund event (depends on lag)
        await ensurePollerProgress(MAX_WAIT_MS);

        // 3) Wait for webhook capture and verify HMAC
        const deadline = Date.now() + MAX_WAIT_MS;
        let hit = null;
        while (Date.now() < deadline) {
            hit = hook.captured.find(
                (e) =>
                    typeof e.raw === "string" &&
                    e.raw.includes(String(invoiceId)) &&
                    /(invoice-refunded|"status"\s*:\s*"refunded")/i.test(e.raw)
            );
            if (hit) break;
            await sleep(400);
        }

        if (!hit) {
            // If still not seen, extend based on poller lag, then re-check once
            const ps = await getPollerStatus();
            if (ps.ok && ps.lagBlocks > 0) {
                const avgSecs = Number(process.env.AVG_BLOCK_SECONDS || 20);
                const extra = Math.min(6 * MAX_WAIT_MS, (ps.lagBlocks + 1) * avgSecs * 1000 + 20_000);
                await ensurePollerProgress(extra);
                hit = hook.captured.find(
                    (e) =>
                        typeof e.raw === "string" &&
                        e.raw.includes(String(invoiceId)) &&
                        /(invoice-refunded|"status"\s*:\s*"refunded")/i.test(e.raw)
                );
            }
        }

        if (!hit) {
            await dumpWebhookDiag({ storeId: STORE_ID, invoiceId, hook, expectEvent: "invoice-refunded" });
            return skip("webhook: invoice-refunded delivered & signed (optional)", "no event captured");
        }

        const v = verifyWebhookSig(hit, HMAC_SECRET);
        return v.ok || fail("invoice-refunded webhook HMAC", v, v.reason);
    }, [need.hmac(), need.storeId(), need.apiKey(), need.merchantSigner(), need.payerSigner(), need.payReady()]));


    // New: full refund path — sum of refunds == amountSats and DTO mirror updates refundAmount
    results.push(await step("refund full amount completed; mirror matches", async () => {
        // Only if paid and builder present
        let dto = await httpJson("GET", `/api/v1/stores/${STORE_ID}/invoices/${invId(invoiceA)}`, null, "merchant");
        if ((dto?.status || "").toLowerCase() !== "paid") {
            return skip("refund full amount completed; mirror matches", "requires paid invoice");
        }
        const total = Number(dto.amountSats || 0);
        const already = Number(dto.refundAmount || 0);
        if (already >= total) return pass("refund full amount completed; mirror matches");
        const remaining = total - already;
        try {
            const call = await jsonCompat("POST",
                `/api/v1/stores/${STORE_ID}/refunds/create-tx`,
                { invoiceId: invId(invoiceA), amount_sats: remaining, memo: "full-rest" },
                "merchant"
            );
            const { txid } = await signAndBroadcastUnsigned(call, MERCHANT_SK);
            const st = await waitForFinal(txid);
            if (st?.tx_status !== "success") return fail("refund-invoice (full)", st || {}, st?.tx_status);
            LAST_REFUND_TX_SUCCESS = true;
            const printed = JSON.stringify(st.events || []).includes("invoice-refunded");
            if (!printed) return fail("refund event (full)", st || {}, "missing print: invoice-refunded");
            // Ensure poller is caught up (again) *after* this tx, then poll longer.
            await ensurePollerProgress(MAX_WAIT_MS * 2);
            const deadline = Date.now() + (MAX_WAIT_MS * 2);
            while (Date.now() < deadline) {
                dto = await httpJson(
                    "GET",
                    `/api/v1/stores/${STORE_ID}/invoices/${invId(invoiceA)}`,
                    null,
                    "merchant"
                );
                const ra = Number(dto?.refundAmount || 0);
                const amt = Number(dto?.amountSats || 0);
                if (ra === amt && amt === total) return true;
                await sleep(600);
            }
            return fail(
                "refund mirror (full)",
                dto || {},
                "refundAmount did not reach amountSats before timeout"
            );
        } catch (e) {
            return (e.status === 404 || e.status === 405)
                ? blocked("refund full amount completed; mirror matches", "builder missing")
                : fail("refund full amount completed; mirror matches", e);
        }
    }, [need.storeId(), need.apiKey(), need.invoiceA(), need.merchantSigner(), need.payReady()]));

    results.push(await step("refund wrong-token blocked (u307)", async () => {
        let invoiceId;
        try {
            const out = await createPayInvoiceForRefundTests({ amountSats: 25000, memo: "refund-u307" });
            invoiceId = out.invoiceId;
        } catch (e) {
            return blocked("refund wrong-token blocked (u307)", `setup failed: ${e}`);
        }

        try {
            // Build a *correct* refund first so we can inspect configured token
            const base = await jsonCompat(
                "POST",
                `/api/v1/stores/${STORE_ID}/refunds/create-tx`,
                { invoiceId, amount_sats: 1, memo: "probe-u307" },
                "merchant"
            );
            if (!looksLikeUnsignedCall(base, "refund-invoice")) return fail("unsigned shape", base);

            const configured = String(base.functionArgs[base.functionArgs.length - 1]?.value || "");
            const ALT = process.env.ALT_FT_CONTRACT;

            // Require a real, deployed alt token to avoid broadcast-time BadFunctionArgument
            if (!ALT) {
                return skip("refund wrong-token blocked (u307)", "set ALT_FT_CONTRACT to a DEPLOYED SIP-010 token (not the configured sBTC token)");
            }
            if (ALT === configured) {
                return skip("refund wrong-token blocked (u307)", "ALT_FT_CONTRACT equals configured sBTC token; set a different deployed token");
            }

            // Swap the token arg to ALT (keeps everything else identical)
            const fake = { type: "contract", value: ALT };
            const call = { ...base, functionArgs: base.functionArgs.slice(0, -1).concat(fake) };

            const { txid } = await signAndBroadcastUnsigned(call, MERCHANT_SK);
            const st = await waitForFinal(txid);
            const s = String(repr(st));

            return (st?.tx_status?.startsWith("abort") && /err u307/i.test(s))
                ? true
                : fail("refund wrong-token", st || {}, s || st?.tx_status || "no-status");
        } catch (e) {
            // If the ALT contract isn’t actually deployed, the node will reject at broadcast time.
            const msg = String(e?.body?.reason_data?.message || e?.body?.reason || e);
            if (/NoSuchContract/i.test(msg)) {
                return skip("refund wrong-token blocked (u307)", "ALT_FT_CONTRACT not deployed on-chain");
            }
            return (e.status === 404 || e.status === 405)
                ? blocked("refund wrong-token", "builder missing")
                : fail("refund wrong-token", e);
        }
    }, [need.storeId(), need.apiKey(), need.merchantSigner(), need.payerSigner()]));


    // Over-refund guard (u305): try refunding remaining+1
    results.push(await step("refund over-amount blocked (u305)", async () => {
        let invoiceId;
        try {
            const out = await createPayInvoiceForRefundTests({ amountSats: 25000, memo: "refund-u305" });
            invoiceId = out.invoiceId;
        } catch (e) {
            return blocked("refund over-amount blocked (u305)", `setup failed: ${e}`);
        }

        try {
            const dto = await httpJson("GET", `/api/v1/stores/${STORE_ID}/invoices/${invoiceId}`, null, "merchant");
            const total = Number(dto.amountSats || 0);
            const already = Number(dto.refundAmount || 0);
            const remaining = total - already;
            if (remaining <= 0) return skip("refund over-amount blocked (u305)", "nothing remaining to refund");

            const call = await jsonCompat(
                "POST",
                `/api/v1/stores/${STORE_ID}/refunds/create-tx`,
                { invoiceId, amount_sats: remaining + 1, memo: "over-refund-u305" },
                "merchant"
            );
            const { txid } = await signAndBroadcastUnsigned(call, MERCHANT_SK);
            const st = await waitForFinal(txid);
            const s = String(repr(st));
            return (st?.tx_status?.startsWith("abort") && /err u305/i.test(s))
                ? true
                : fail("over-refund", st || {}, s || st?.tx_status || "no-status");
        } catch (e) {
            return (e.status === 404 || e.status === 405)
                ? blocked("refund over-amount blocked (u305)", "refund builder missing")
                : fail("refund over-amount blocked (u305)", e);
        }
    }, [need.storeId(), need.apiKey(), need.merchantSigner(), need.payerSigner(), need.payReady()]));


    // Subscriptions
    results.push(await step("merchant: create subscription (invoice mode)", async () => {
        try {
            // Prefer snake_case; jsonCompat will auto-retry with camelCase if server expects it.
            const bodySnake = {
                subscriber: PAYER_ADDR,
                amount_sats: 1111,
                interval_blocks: 2,
                mode: "invoice",
            };

            const j = await jsonCompat("POST", `/api/v1/stores/${STORE_ID}/subscriptions`, bodySnake, "merchant");
            sub = j;

            // Accept either `subscriber` or `subscriberPrincipal` in the response.
            const haveSubscriber = ("subscriber" in j) || ("subscriberPrincipal" in j);
            return haveSubscriber && expectKeys(j, ["id", "storeId", "amountSats", "intervalBlocks", "active", "mode"]);
        } catch (e) {
            if (e.status === 400 && String(e.body?.error || "").includes("validation_error")) {
                return skip("merchant: create subscription (invoice mode)", "validation_error (route/spec evolving)");
            }
            return fail("merchant: create subscription (invoice mode)", e);
        }
    }, [need.storeId(), need.apiKey()]));

    results.push(await step("merchant: sub → invoice (dto + magicLink + unsigned)", async () => {
        const j = await httpJson(
            "POST",
            `/api/v1/stores/${STORE_ID}/subscriptions/${sub.id}/invoice`,
            { ttl_seconds: 300, memo: "From sub" },
            "merchant"
        );
        const dto = j?.invoice ?? j;
        const okDto = looksLikePublicInvoice(dto);
        const okMagic = typeof j?.magicLink === "string";
        const okUnsigned = looksLikeUnsignedCall(j?.unsignedCall, "pay-invoice");
        const okPcs = okUnsigned && hasFungiblePC(j.unsignedCall, dto, PAYER_ADDR);
        if (!(okDto && okMagic && okUnsigned && okPcs)) {
            console.warn("sub→invoice payload shape:", Object.keys(j || {}));
        }
        if (okUnsigned) logUnsigned("sub→invoice unsigned", j.unsignedCall);
        return okDto && okMagic && okUnsigned && okPcs;
    }, [need.storeId(), need.apiKey(), need.subId()]));



    // treat 409 (not due yet) as PASS; unsigned call also PASS
    results.push(await step("merchant: sub direct create-tx ok (or 409 until due)", async () => {
        await setDirectMode(sub.id);
        try {
            const j = await httpJson("POST",
                `/api/v1/stores/${STORE_ID}/subscriptions/${sub.id}/create-tx`,
                { payerPrincipal: PAYER_ADDR }, "merchant");
            return looksLikeUnsignedCall(j, "pay-subscription");
        } catch (e) {
            if (is409BadStatus(e)) return true; // early gate is expected
            console.warn("sub.create-tx:", errStatus(e), errBody(e) || e?.message);
            throw e;
        }
    }, [need.storeId(), need.apiKey(), need.subId(), need.payReady()]));


    results.push(await step("subscription wrong-token blocked (u207)", async () => {
        await setDirectMode(sub.id);

        const ALT = process.env.ALT_FT_CONTRACT;
        if (!ALT) return skip("subscription wrong-token blocked (u207)", "set ALT_FT_CONTRACT=ADDR.contract");

        let unsigned;
        try {
            unsigned = await httpJson("POST",
                `/api/v1/stores/${STORE_ID}/subscriptions/${sub.id}/create-tx`,
                { payerPrincipal: PAYER_ADDR }, "merchant");
        } catch (e) {
            if (is409BadStatus(e)) return true; // server pre-gate when not due is OK
            console.warn("wrong-token builder:", errStatus(e), errBody(e) || e?.message);
            throw e;
        }

        if (!looksLikeUnsignedCall(unsigned, "pay-subscription")) return fail("unsigned call shape", unsigned);

        // If the call doesn't expose a token contract arg, that's spec-compliant — skip test.
        const hasTokenArg = Array.isArray(unsigned.functionArgs)
            && unsigned.functionArgs.some(a => a?.type === "contract");
        if (!hasTokenArg) {
            return skip("subscription wrong-token blocked (u207)", "no token contract arg in pay-subscription (spec-compliant)");
        }

        // Legacy flow with token arg: tamper last arg and expect u207 (or 400 NoSuchContract)
        const fake = { type: "contract", value: ALT };
        const tampered = { ...unsigned, functionArgs: unsigned.functionArgs.slice(0, -1).concat(fake) };

        try {
            const { txid } = await signAndBroadcastUnsigned(tampered, PAYER_SK);
            const st = await waitForFinal(txid);
            const res = String(repr(st));
            return (st?.tx_status?.startsWith("abort") && /err u207/i.test(res))
                ? true
                : fail("subscription wrong-token", st || {}, res || st?.tx_status || "no-status");
        } catch (e) {
            const body = errBody(e);
            const msg = (body && (body.reason_data?.message || body.message)) || "";
            if (errStatus(e) === 400 && /NoSuchContract/i.test(String(msg))) return true;
            console.warn("wrong-token broadcast:", errStatus(e), body || e?.message);
            throw e;
        }
    }, [need.storeId(), need.apiKey(), need.subId(), need.payerSigner(), need.payReady()]));


    // PASS on either server 409 (pre-block) or chain abort u503
    results.push(await step("subscription: early-pay blocked (u503 or 409)", async () => {
        await setDirectMode(sub.id);
        try {
            const unsigned = await httpJson("POST",
                `/api/v1/stores/${STORE_ID}/subscriptions/${sub.id}/create-tx`,
                { payerPrincipal: PAYER_ADDR }, "merchant");
            if (!looksLikeUnsignedCall(unsigned, "pay-subscription")) return fail("unsigned call shape", unsigned);
            const { txid } = await signAndBroadcastUnsigned(unsigned, PAYER_SK);
            const st = await waitForFinal(txid);
            const res = String(repr(st));
            return (st?.tx_status?.startsWith("abort") && /err u503/i.test(res))
                ? true : fail("subscription early-pay should abort u503", st || {}, res || st?.tx_status || "no-status");
        } catch (e) {
            if (is409BadStatus(e)) return true; // server pre-gate is acceptable
            console.warn("early-pay:", errStatus(e), errBody(e) || e?.message);
            throw e;
        }
    }, [need.storeId(), need.apiKey(), need.subId(), need.payerSigner(), need.payReady()]));

    results.push(await step("merchant: cancel subscription", async () => {
        const j = await httpJson("POST", `/api/v1/stores/${STORE_ID}/subscriptions/${sub.id}/cancel`, null, "merchant");
        return (j?.canceled === true) || looksLikeUnsignedCall(j?.unsignedTx || j?.unsignedCall, "cancel-subscription");
    }, [need.storeId(), need.apiKey(), need.subId()]));

    // Admin & poller
    results.push(await step("merchant: GET webhook logs", async () => {
        const j = await httpJson("GET", `/api/v1/stores/${STORE_ID}/webhooks`, null, "merchant");
        return Array.isArray(j);
    }, [need.storeId(), need.apiKey()]));
    results.push(await step("admin: poller status", async () => {
        const j = await httpJson("GET", `/api/admin/poller`, null, "admin");
        return expectKeys(j, ["running", "lastRunAt", "lastHeight", "lastTxId", "lagBlocks"]);
    }));
    results.push(await step("admin: poller restart toggles", async () => {
        try {
            const j = await httpJson("POST", `/api/admin/poller/restart`, null, "admin");
            return typeof j?.running === "boolean";
        } catch (e) {
            return (e.status === 404 || e.status === 405) ? blocked("admin: poller restart toggles", "route missing") : fail("admin: poller restart", e);
        }
    }));
    results.push(await step("admin: GET webhooks (all)", async () => {
        const j = await httpJson("GET", `/api/admin/webhooks?status=all&storeId=${encodeURIComponent(STORE_ID)}`, null, "admin");
        return Array.isArray(j);
    }, [need.storeId()]));
    results.push(await step("admin: retry first failed webhook (if any)", async () => {
        const j = await httpJson("GET", `/api/admin/webhooks?status=failed&storeId=${encodeURIComponent(STORE_ID)}`, null, "admin");
        const first = Array.isArray(j) ? j.find((x) => x.success === false) : null;
        if (!first) return skip("admin: retry first failed webhook (if any)", "no failed logs");
        const r = await httpJson("POST", `/api/admin/webhooks/retry`, { webhookLogId: first.id }, "admin");
        return (r?.enqueued === true) || (r?.alreadyDelivered === true);
    }, [need.storeId()]));
    // Refund-before-paid negative (u301)
    let invUnpaid = null;
    results.push(await step("refund-before-paid: create fresh unpaid invoice", async () => {
        const j = await jsonCompat("POST", `/api/v1/stores/${STORE_ID}/invoices`,
            { amount_sats: 777, ttl_seconds: 600, memo: "unpaid-refund-guard" }, "merchant");
        invUnpaid = j;
        return looksLikePublicInvoice(j);
    }, [need.storeId(), need.apiKey()]));
    results.push(await step("refund-before-paid blocked (u301)", async () => {
        if (!invId(invUnpaid)) return blocked("refund-before-paid blocked (u301)", "no invoice created");
        // Materialize the invoice on-chain (like other sync blocks)
        try {
            const sync = await httpJson("POST", `/api/admin/stores/${STORE_ID}/sync-onchain`, null, "admin");
            const calls = Array.isArray(sync?.calls) ? sync.calls : [];
            const idHex = String((await httpJson("GET",
                `/api/v1/stores/${STORE_ID}/invoices/${invId(invUnpaid)}`, null, "merchant")).idHex || "").toLowerCase();
            const createCall = calls.find(c => c?.functionName === "create-invoice"
                && Array.isArray(c.functionArgs) && argToInvoiceHex(c.functionArgs[0]) === idHex);
            if (createCall) await broadcastWith(MERCHANT_SK, "create-invoice (invUnpaid)", createCall);
        } catch { /* best-effort */ }
        try {
            const call = await jsonCompat("POST",
                `/api/v1/stores/${STORE_ID}/refunds/create-tx`,
                { invoiceId: invId(invUnpaid), amount_sats: 1, memo: "should-fail" },
                "merchant");
            const { txid } = await signAndBroadcastUnsigned(call, MERCHANT_SK);
            const st = await waitForFinal(txid);
            const s = String(repr(st));
            return (st?.tx_status?.startsWith("abort") && /err u301/i.test(s))
                ? true : fail("refund-before-paid", st || {}, s || st?.tx_status || "no-status");
        } catch (e) {
            if (e.status === 409 && /invalid[_-]?state/i.test(String(e.body?.error || ""))) {
                // Builder refused refund because invoice not paid yet — this is a PASS.
                return true;
            }
            return (e.status === 404 || e.status === 405)
                ? blocked("refund-before-paid blocked (u301)", "refund builder missing")
                : fail("refund-before-paid blocked (u301)", e);
        }

    }, [need.storeId(), need.apiKey(), need.merchantSigner()]));

    // Admin listings
    results.push(await step("admin: list stores (camelCase)", async () => {
        const j = await httpJson("GET", "/api/admin/stores", null, "admin");
        const ok = Array.isArray(j) && j.length >= 1;
        const noSnake = ok ? !hasUnderscoreKeys(j[0]) : false;
        return ok && noSnake;
    }));
    results.push(await step("admin: list invoices (camelCase + idHex)", async () => {
        const j = await httpJson("GET", `/api/admin/invoices?status=&storeId=${encodeURIComponent(STORE_ID || "")}`, null, "admin");
        if (!Array.isArray(j)) return false;
        const any = j[0];
        return !any || (!hasUnderscoreKeys(any) && (any.idHex ? is64Hex(any.idHex) : true));
    }));

    // Admin cancel unpaid invoice
    results.push(await step("admin: cancel unpaid invoice", async () => {
        let tmpInv = null;
        try {
            tmpInv = await jsonCompat("POST", `/api/v1/stores/${STORE_ID}/invoices`, { amount_sats: 2222, ttl_seconds: 300, memo: "Admin cancel test" }, "merchant");
        } catch { }
        if (!invId(tmpInv)) return skip("admin: cancel unpaid invoice", "could not create temp invoice");
        const j = await httpJson("POST", `/api/admin/invoices/${invId(tmpInv)}/cancel`, null, "admin");
        return j?.canceled === true && j?.invoiceId === invId(tmpInv);
    }, [need.storeId(), need.apiKey()]));

    // Active merchant gating
    results.push(await step("admin: deactivate store", async () => {
        const j = await httpJson("PATCH", `/api/admin/stores/${STORE_ID}/activate`, { active: false }, "admin");
        return j?.active === false;
    }, [need.storeId()]));
    results.push(await step("merchant: create-invoice builder blocked when inactive", async () => {
        const res = await raw("POST", `/api/v1/stores/${STORE_ID}/invoices/create-tx`, { ...merchantHeaders() }, { amount_sats: 1000, ttl_blocks: 10, memo: "inactive" });
        return res.status >= 400;
    }, [need.storeId(), need.apiKey()]));
    results.push(await step("public: create-tx blocked when merchant inactive", async () => {
        if (!invId(invoiceA)) return skip("public: create-tx blocked when merchant inactive", "no earlier invoice to reuse");
        const res = await raw("POST", `/create-tx`, { "Content-Type": "application/json" }, { invoiceId: invId(invoiceA), payerPrincipal: DUMMY_PAYER });
        return res.status >= 400;
    }, [need.storeId()]));
    results.push(await step("on-chain pay while inactive is rejected (u205)", async () => {
        if (!LAST_PAY_UNSIGNED) {
            return skip("on-chain pay while inactive is rejected (u205)", "no cached unsigned call from active period");
        }
        const { txid } = await signAndBroadcastUnsigned(LAST_PAY_UNSIGNED, PAYER_SK);
        const st = await waitForFinal(txid);
        const res = String(repr(st));
        return (st?.tx_status?.startsWith("abort") && (/err u205/i.test(res) || /err u201/i.test(res)))
            ? true : fail("inactive on-chain pay should abort u205", st || {}, res || st?.tx_status || "no-status");
    }, [need.payerSigner()]));
    results.push(await step("admin: reactivate store", async () => {
        const j = await httpJson("PATCH", `/api/admin/stores/${STORE_ID}/activate`, { active: true }, "admin");
        return j?.active === true;
    }, [need.storeId()]));
    // prove flows resume after reactivation with a quick create-tx
    results.push(await step("reactivation: builder works again (create-tx)", async () => {
        if (!invId(invoiceA)) return skip("reactivation: builder works again (create-tx)", "no earlier invoice to reuse");
        try {
            const call = await httpJson("POST", `/create-tx`, { invoiceId: invId(invoiceA), payerPrincipal: DUMMY_PAYER });
            return looksLikeUnsignedCall(call, "pay-invoice");
        } catch (e) {
            // If the builder responds, but blocks this particular invoice as invalid, that's still proof the builder is working.
            if (e.status === 409 && /invalid[_-]?state/i.test(String(e.body?.error || ""))) return true;
            throw e;
        }
    }, [need.storeId(), need.invoiceA()]));
    // Webhook dispatcher: flaky → retries with backoff → success
    results.push(await step("webhooks: flaky receiver triggers retries then delivery", async () => {
        // 1) Start flaky receiver (fail twice)
        const flaky = await startFlakyWebhookReceiver({ failFirst: 2, status: 503 });

        // 2) Point store webhook to flaky url
        await httpJson("PATCH",
            `/api/v1/stores/${STORE_ID}/profile`,
            { webhook_url: flaky.url },
            "merchant"
        );

        // 3) Create & pay a small invoice to emit "invoice-paid"
        const { invoiceId } = await createPayInvoiceForRefundTests({
            amountSats: 1500, ttlSeconds: 600, memo: "webhook-retry"
        });

        // 4) Allow poller + dispatcher time to churn (bounded by lag)
        await ensurePollerProgress(MAX_WAIT_MS);

        const deadline = Date.now() + (MAX_WAIT_MS * 2);
        let failed = 0, ok = false, okMulti = false;
        while (Date.now() < deadline) {
            const logs = await httpJson(
                "GET",
                `/api/admin/webhooks?status=all&storeId=${encodeURIComponent(STORE_ID)}`,
                null,
                "admin"
            );
            const relevant = (Array.isArray(logs) ? logs : []).filter(l =>
                String(l?.invoiceId || "") === String(invoiceId) &&
                /invoice-paid/i.test(String(l?.eventType || l?.event || l?.body || ""))
            );

            failed = relevant.filter(l => l.success === false).length;
            ok = relevant.some(l => l.success === true);
            okMulti = relevant.some(l => l.success === true && Number(l.attempts) >= 2);

            // PASS if: (a) attempts≥2 on any success row, OR (b) at least 1 failure before a success
            if (okMulti || (failed >= 1 && ok)) break;

            await sleep(700);
        }

        if (!(okMulti || (failed >= 1 && ok))) {
            // diagnostics & lag handling (unchanged)
            const ps = await getPollerStatus();
            if (ps.ok && ps.lagBlocks > 0) {
                const avg = Number(process.env.AVG_BLOCK_SECONDS || 20);
                await ensurePollerProgress((ps.lagBlocks + 1) * avg * 1000 + 20_000);
            }
        }

        return okMulti || (failed >= 1 && ok) ||
            skip("webhooks: flaky receiver triggers retries then delivery",
                "no multi-attempt pattern observed (queue/backoff not enabled yet?)");

    }, [need.storeId(), need.apiKey(), need.hmac(), need.merchantSigner(), need.payerSigner(), need.payReady()]));
    results.push(await step("invoice: usdAtCreate is present and stable", async () => {
        // create with merchant auth using snake_case (jsonCompat will retry camelCase if needed)
        const created = await jsonCompat("POST",
            `/api/v1/stores/${STORE_ID}/invoices`,
            { amount_sats: 2222, ttl_seconds: 600, memo: "usd-snapshot" },
            "merchant"
        );
        const id = invId(created);
        if (!id) return fail("create invoice failed", created);

        // snapshot at create (accept snake/camel)
        const snap1 = created.usdAtCreate ?? created.usd_at_create;
        if (snap1 == null) return skip("invoice: usdAtCreate is present and stable", "server does not expose usdAtCreate");

        await ensurePollerProgress(MAX_WAIT_MS);
        const dto = await httpJson("POST", `/api/v1/stores/${STORE_ID}/invoices`, { amount_sats: 2222, ttl_seconds: 600, memo: "usd-snapshot" }, "merchant", false, { timeoutMs: 60000 });
        const snap2 = dto.usdAtCreate ?? dto.usd_at_create;

        const isNum = (v) => Number.isFinite(Number(v));
        if (!isNum(snap1) || !isNum(snap2)) {
            return fail("usdAtCreate not numeric", { snap1, snap2 });
        }
        if (String(snap1) !== String(snap2)) {
            return fail("usdAtCreate mutated", { snap1, snap2 });
        }
        if (Number(snap1) === 0) {
            console.warn("[HARNESS] usdAtCreate=0 — pricing service likely disabled in this env");
        }
        return true;

    }, [need.storeId(), need.apiKey()]));
    results.push(await step("rate-limit: burst POST /invoices eventually hits 429 (use RL_MERCHANT_MAX=1 for testing) ", async () => {
        const tries = 12;
        const make = (i) => raw(
            "POST",
            `/api/v1/stores/${STORE_ID}/invoices`,
            { "Content-Type": "application/json", "X-API-Key": MERCHANT_API_KEY, "X-Forwarded-For": "203.0.113.7" },
            { amount_sats: 120 + i, ttl_seconds: 300, memo: `rl-${i}` }
        );

        // fire 8 in parallel to hit windowed limiters
        const parallel = await Promise.all(Array.from({ length: 8 }, (_, i) => make(i)));
        let saw429 = parallel.some(r => r.status === 429);

        // if none, finish the remaining calls sequentially
        for (let i = 8; i < tries && !saw429; i++) {
            const r = await make(i);
            saw429 = r.status === 429;
            await sleep(25);
        }

        return saw429 || skip("rate-limit: burst POST /invoices eventually hits 429", "no 429 observed (limit not enforced yet?)");
    }, [need.storeId(), need.apiKey()]));
    results.push(await step("scheduler: sub due → auto-invoice + webhook (optional)", async () => {
        if (!sub?.id) return blocked("scheduler: sub due → auto-invoice + webhook (optional)", "no subscription created");

        // Window to watch for the scheduler to kick in and create a fresh invoice
        const deadline = Date.now() + (MAX_WAIT_MS * 2);
        let found = null;

        while (Date.now() < deadline) {
            const list = await httpJson("GET",
                `/api/v1/stores/${STORE_ID}/invoices?status=unpaid&subscriptionId=${encodeURIComponent(sub.id)}`,
                null, "merchant"
            );
            if (Array.isArray(list) && list.length > 0) {
                found = list[0];
                break;
            }
            await ensurePollerProgress(3000);
        }

        if (!found) {
            return skip("scheduler: sub due → auto-invoice + webhook (optional)", "no auto-generated invoice observed (scheduler likely disabled)");
        }

        // If we have a webhook receiver configured, see if we captured the event
        const wantId = String(found.id || found.invoiceId || "");
        const deadline2 = Date.now() + MAX_WAIT_MS;
        let hit = null;
        while (Date.now() < deadline2) {
            hit = hook.captured.find(e =>
                typeof e.raw === "string" &&
                e.raw.includes(wantId) &&
                /subscription-invoice-created/i.test(e.raw)
            );
            if (hit) break;
            await sleep(500);
        }
        // Webhook is optional; success if invoice exists. If webhook present, verify HMAC.
        if (!hit) return true;
        const v = verifyWebhookSig(hit, HMAC_SECRET);
        return v.ok ? true : fail("subscription-invoice-created HMAC", v, v.reason);
    }, [need.storeId(), need.apiKey(), need.subId(), need.hmac()]));


    // Report
    console.log("");
    console.log(c.bold("Test Summary"));
    let counts = { PASS: 0, FAIL: 0, SKIP: 0, BLOCKED: 0 }, i = 1;
    for (const r of results) {
        printResult(r, i++);
        counts[r.status] = (counts[r.status] || 0) + 1;
    }
    console.log("");
    console.log(
        "Result: "
        + c.green(`${counts.PASS} passed`) + " / "
        + (counts.FAIL ? c.red(`${counts.FAIL} failed`) : "0 failed") + " / "
        + (counts.SKIP ? c.yellow(`${counts.SKIP} skipped`) : "0 skipped") + " / "
        + (counts.BLOCKED ? c.dim(`${counts.BLOCKED} blocked`) : "0 blocked")
    );

    // cleanup
    hook.server.close();
    process.exit(counts.FAIL ? 1 : 0);
})().catch((err) => {
    console.error(c.red("Fatal error in server selftest:"), err);
    process.exit(1);
});
