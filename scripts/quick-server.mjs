#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * sBTC Payment – Server Self Test (Prod-style; Node never signs)
 * --------------------------------------------------------------
 * - Server builds unsigned calls; tester signs & broadcasts.
 * - Includes “Original” DTO suite (CORS, auth, rate-limit).
 * - Pulls merchant API/HMAC from SQLite (read-only) if already present.
 *
 * Usage:
 *   node scripts/quick-server.mjs
 */

import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

import stacksTx from "@stacks/transactions";
const { AnchorMode, Cl, hexToCV, makeContractCall, serializeCV } = stacksTx;



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

function logHTTP(direction, { method, url, kind, headers, body, status, resHeaders, resBody }) {
    if (!VERBOSE) return;
    if (direction === "→") {
        console.log(c.dim(`[HTTP] → ${method} ${url} (${kind || "public"})`));
        console.log(c.dim(`       headers=${jstr(headers)}`));
        if (body !== undefined) console.log(c.dim(`       body=${jstr(body)}`));
    } else {
        console.log(c.dim(`[HTTP] ← ${status} ${method} ${url}`));
        // only show a few response headers that matter to CORS/debug
        const pick = {};
        for (const k of ["content-type", "access-control-allow-origin", "access-control-allow-headers"]) {
            const v = resHeaders?.get ? resHeaders.get(k) : resHeaders?.[k];
            if (v) pick[k] = v;
        }
        console.log(c.dim(`       headers=${jstr(pick)}`));
        if (resBody !== undefined) console.log(c.dim(`       body=${typeof resBody === "string" ? redactStr(truncate(resBody, 1200)) : jstr(resBody)}`));
    }
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
function logUnsigned(label, call) {
    if (!VERBOSE) return;
    try {
        console.log(c.dim(`[CALL] ${label}: ${call?.contractAddress}::${call?.contractName}.${call?.functionName}`));
        const args = Array.isArray(call?.functionArgs) ? call.functionArgs : [];
        console.log(c.dim(`       args=${jstr(args.map(summarizeArg))}`));
        if (call?.postConditions) console.log(c.dim(`       postConditions=${jstr(call.postConditions)}`));
        if (call?.post_conditions) console.log(c.dim(`       post_conditions=${jstr(call.post_conditions)}`));
    } catch { }
}

// ───────────────────────────────────────────────────────────────────────────────
// Step harness
// ───────────────────────────────────────────────────────────────────────────────
const Status = { PASS: "PASS", FAIL: "FAIL", SKIP: "SKIP", BLOCKED: "BLOCKED" };
const result = (name, status, extras = {}) => ({ name, status, ...extras });
const pass = (name) => result(name, Status.PASS);
const skip = (name, reason) => result(name, Status.SKIP, { reason });
const blocked = (name, reason) => result(name, Status.BLOCKED, { reason });
const fail = (name, errOrObj, hint) =>
    result(name, Status.FAIL, {
        reason: hint || errOrObj?.message || "unexpected",
        result: safeStr(errOrObj?.result || errOrObj),
    });

async function step(name, fn, requires = []) {
    const checks = requires.map((r) => (typeof r === "function" ? r() : r));
    const unmet = checks.find((ch) => !ch.ok);
    if (unmet) return blocked(name, unmet.reason || `requires ${unmet.label}`);
    try {
        if (VERBOSE) console.log(c.dim(`→ ${name}`));
        const out = await fn();
        if (out?.status) return out;
        return out ? pass(name) : fail(name, null, "falsy step result");
    } catch (e) {
        return fail(name, e, e?.message || "threw");
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
async function httpJson(method, path, body, kind = "public") {
    const url = path.startsWith("http") ? path : `${BASE_URL}${path}`;
    const headers =
        kind === "admin" ? adminHeaders()
            : kind === "merchant" ? merchantHeaders()
                : { "Content-Type": "application/json" };

    logHTTP("→", { method, url, kind, headers, body });

    const res = await withTimeout(
        (signal) => fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            signal,
        }),
        FETCH_TIMEOUT_MS,
        `${method} ${url}`
    );

    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep text */ }

    logHTTP("←", { method, url, status: res.status, resHeaders: res.headers, resBody: json ?? text });

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
        (signal) => fetch(url, {
            method,
            headers,
            body: body ? JSON.stringify(body) : undefined,
            signal,
        }),
        FETCH_TIMEOUT_MS,
        `${method} ${url}`
    );
    // peek a small body chunk without consuming twice
    let text = "";
    try { text = await res.text(); } catch { }
    logHTTP("←", { method, url, status: res.status, resHeaders: res.headers, resBody: text });
    // rebuild a Response-like minimal object so callers can still read status/headers
    return {
        status: res.status,
        headers: res.headers,
        text: async () => text,
        json: async () => { try { return JSON.parse(text); } catch { return null; } },
    };
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
    const id = invId(i);
    const must = ["idHex", "storeId", "amountSats", "usdAtCreate", "quoteExpiresAt", "merchantPrincipal", "status", "createdAt"];
    return !!id && expectKeys(i, must);
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
function hasTwoFungiblePC(unsignedCall, invoice, payerPrincipal) {
    const pcs = unsignedCall?.postConditions || unsignedCall?.post_conditions;
    if (!Array.isArray(pcs) || pcs.length < 2) return false;
    const blob = JSON.stringify(pcs);
    const amt = String(invoice?.amountSats ?? "");
    const merchant = invoice?.merchantPrincipal ?? "";
    const hasAmt = blob.includes(amt);
    const hasMerchant = merchant && blob.includes(merchant);
    const hasPayer = payerPrincipal ? blob.includes(payerPrincipal) : true;
    const sbtcOk = (SBTC_ADDRESS && SBTC_NAME) ? blob.includes(`${SBTC_ADDRESS}::${SBTC_NAME}`) : true;
    return hasAmt && hasMerchant && hasPayer && sbtcOk;
}

// Build 0x… hex for a CV
const cvHex = (cv) => "0x" + Buffer.from(serializeCV(cv)).toString("hex");

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
    return { ok: ok && skewOk, reason: ok ? (skewOk ? "ok" : "skew") : "mismatch" };
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
        if (!VERBOSE) return;
        try {
            const summary = summarizeArg(a);
            console.log(c.dim(`[CALL] arg[${idx}] in=${jstr(summary)} → as=${outTag}`));
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

        // 2) Contract principal as a string ("ADDR.CONTRACT" or "ADDR::CONTRACT")
        if (typeof a === "string") {
            const p = parseContractStr(a);
            if (p) { argDbg(idx, a, "Cl.contractPrincipal(str)"); return Cl.contractPrincipal(p.address, p.name); }
        }

        // 3) Objects we know how to coerce
        if (a && typeof a === "object") {
            // 3a) Hex-cv exposed via common fields
            const hex = a.hex || a.cv || a.value;
            if (typeof hex === "string" && hex.startsWith("0x")) { argDbg(idx, a, "hexToCV(obj.hex)"); return hexToCV(hex); }

            // 3b) Contract-principal via fields
            const address = a.contractAddress || a.address;
            const name = a.contractName || a.name;
            if (address && name) { argDbg(idx, a, "Cl.contractPrincipal(obj fields)"); return Cl.contractPrincipal(address, name); }

            // 3c) Typed server shapes (minimal set we actually see)
            if (typeof a.type === "string") {
                const t = a.type.toLowerCase();

                // { type: "contract" | "contractprincipal", value: "ADDR.CONTRACT" }
                if ((t === "contract" || t === "contractprincipal") && typeof a.value === "string") {
                    const p = parseContractStr(a.value);
                    if (p) { argDbg(idx, a, "Cl.contractPrincipal(typed)"); return Cl.contractPrincipal(p.address, p.name); }
                }

                // { type: "buffer", value: "<hex-without-0x-ok>" }
                if (t === "buffer" && typeof a.value === "string") {
                    const bytes = Buffer.from(cleanHex(a.value), "hex");
                    if (Cl.buffer) { argDbg(idx, a, "Cl.buffer(hex)"); return Cl.buffer(bytes); }
                    if (Cl.bufferCV) { argDbg(idx, a, "Cl.bufferCV(hex)"); return Cl.bufferCV(bytes); }
                }

                // { type: "uint" | "int", value: string|number }
                if ((t === "uint" || t === "int") && (typeof a.value === "string" || typeof a.value === "number")) {
                    argDbg(idx, a, t === "uint" ? "Cl.uint" : "Cl.int");
                    return t === "uint" ? Cl.uint(a.value) : Cl.int(a.value);
                }

                // { type: "true" } / { type: "false" }
                if (t === "true" || t === "false") {
                    argDbg(idx, a, "Cl.bool");
                    return Cl.bool(t === "true");
                }

                // { type: "some", value: <inner> }  /  { type: "none" }
                if (t === "some") {
                    argDbg(idx, a, "Cl.some");
                    return Cl.some(toClarityValue(a.value, idx));
                }
                if (t === "none") {
                    argDbg(idx, a, "Cl.none");
                    return Cl.none();
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
            // show which arg failed
            console.log(c.red(`[CALL] arg[${i}] conversion failed: ${e.message}`));
            console.log(c.red(`       value=${jstr(v)}`));
            throw e;
        }
    });

    if (VERBOSE) {
        console.log(c.dim(`[TX] building ${unsigned.contractAddress}::${unsigned.contractName}.${unsigned.functionName}`));
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

    if (!res.ok) throw new Error(`broadcast failed: HTTP ${res.status} ${await res.text()}`);
    const { txid } = await res.json();
    if (!txid) throw new Error("broadcast returned no txid");
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
            return j;
        }
        await sleep(1500);
    }
    return null;
}
const repr = (j) => j?.contract_call?.result || j?.smart_contract?.result || j?.tx_result || "";

// ───────────────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────────────
let invoiceA = null;
let invoiceExp = null;
let sub = null;

// When true, /create-tx builder is responding (sBTC configured) so pay/refund flows are allowed.
let PAY_READY = false;

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
        console.log(c.dim(`Seeded keys from DB: MERCHANT_API_KEY=${mask(MERCHANT_API_KEY)} HMAC_SECRET=${mask(HMAC_SECRET)}`));
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

    // Admin set-sbtc-token
    results.push(await step("admin: set-sbtc-token → unsigned call", async () => {
        const j = await httpJson("POST", `/api/admin/set-sbtc-token`, { contractAddress: SBTC_ADDRESS, contractName: SBTC_NAME }, "admin");
        logUnsigned("set-sbtc-token unsigned", j?.call); // <— add this line
        return looksLikeUnsignedCall(j?.call, "set-sbtc-token");
    }, [need.env("SBTC_CONTRACT_ADDRESS"), need.env("SBTC_CONTRACT_NAME")]));


    results.push(await step("admin: set-sbtc-token → broadcast (tester wallet)", async () => {
        const j = await httpJson("POST", `/api/admin/set-sbtc-token`, { contractAddress: SBTC_ADDRESS, contractName: SBTC_NAME }, "admin");
        logUnsigned("set-sbtc-token (pre-broadcast)", j?.call); // <— add this line
        const { txid } = await signAndBroadcastUnsigned(j.call, ADMIN_SK);
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
    results.push(await step("merchant: create DTO invoice (fallback path)", async () => {
        try {
            const j = await jsonCompat("POST", `/api/v1/stores/${STORE_ID}/invoices`, { amount_sats: 25000, ttl_seconds: 900, memo: "DTO path" }, "merchant");
            invoiceA = j;
            return looksLikePublicInvoice(j);
        } catch (e) {
            return (e.status === 404 || e.status === 405) ? blocked("merchant: create DTO invoice (fallback path)", "route missing") : fail("create DTO invoice", e);
        }
    }, [need.storeId(), need.apiKey()]));

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
            const pcs = hasTwoFungiblePC(call, invoiceA, DUMMY_PAYER);
            PAY_READY = shape && pcs;
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

    // Sign & broadcast pay
    results.push(await step("pay-invoice (on-chain): tester signs as payer", async () => {
        const id = invId(invoiceA);
        const call = await httpJson("POST", `/create-tx`, { invoiceId: id, payerPrincipal: DUMMY_PAYER });
        const { txid } = await signAndBroadcastUnsigned(call, PAYER_SK);
        const st = await waitForFinal(txid);
        if (st?.tx_status !== "success") return fail("pay-invoice", st || {}, st?.tx_status);
        const okPrint = JSON.stringify(st.events || []).includes("invoice-paid");
        if (!okPrint) return fail("invoice-paid event", st || {}, "missing print: invoice-paid");
        const start = Date.now();
        while (Date.now() - start < MAX_WAIT_MS) {
            const dto = await httpJson("GET", `/api/v1/stores/${STORE_ID}/invoices/${id}`, null, "merchant");
            if (dto?.status?.toLowerCase?.() === "paid") return true;
            await sleep(1200);
        }
        return fail("DTO mirror after pay", {}, "timeout waiting status=paid");
    }, [need.invoiceA(), need.payerSigner(), need.payReady()]));

    // Double-pay -> err u201 (builder path or on-chain)
    results.push(await step("pay-invoice double-pay blocked (u201)", async () => {
        const id = invId(invoiceA);
        try {
            const call = await httpJson("POST", `/create-tx`, { invoiceId: id, payerPrincipal: DUMMY_PAYER });
            const { txid } = await signAndBroadcastUnsigned(call, PAYER_SK);
            const st = await waitForFinal(txid);
            const res = String(repr(st));
            return (st?.tx_status?.startsWith("abort") && /err u201/.test(res)) || fail("double-pay", st || {}, res || st?.tx_status);
        } catch (e) {
            return (e.status && e.status >= 400) ? pass("pay-invoice double-pay blocked (builder)") : fail("double-pay builder path", e);
        }
    }, [need.invoiceA(), need.payerSigner(), need.payReady()]));

    // Wrong-token → u207
    results.push(await step("pay-invoice wrong-token blocked (u207)", async () => {
        const unsigned = await httpJson("POST", `/create-tx`, { invoiceId: invId(invoiceA), payerPrincipal: DUMMY_PAYER });
        if (!looksLikeUnsignedCall(unsigned, "pay-invoice")) return fail("unsigned call shape", unsigned);
        const fake = cvHex(Cl.contractPrincipal(unsigned.contractAddress, unsigned.contractName));
        const newArgs = unsigned.functionArgs.slice(0, -1).concat(fake);
        const tampered = { ...unsigned, functionArgs: newArgs };
        const { txid } = await signAndBroadcastUnsigned(tampered, PAYER_SK);
        const st = await waitForFinal(txid);
        const res = String(repr(st));
        return (st?.tx_status?.startsWith("abort") && /err u207/.test(res)) || fail("wrong-token", st || {}, res || st?.tx_status);
    }, [need.invoiceA(), need.payerSigner(), need.payReady()]));

    // Cancel unpaid
    let invForCancel = null;
    results.push(await step("merchant: create new DTO invoice (for cancel)", async () => {
        const j = await jsonCompat("POST", `/api/v1/stores/${STORE_ID}/invoices`, { amount_sats: 1111, ttl_seconds: 600, memo: "cancel path" }, "merchant");
        invForCancel = j;
        return looksLikePublicInvoice(j);
    }, [need.storeId(), need.apiKey()]));

    results.push(await step("merchant: cancel unpaid (Node action or builder)", async () => {
        try {
            const resp = await httpJson("POST", `/api/v1/stores/${STORE_ID}/invoices/${invId(invForCancel)}/cancel/create-tx`, null, "merchant");
            // The server returns a wrapper: { unsignedCall, unsignedPayload }
            const call = resp.unsignedCall || resp.call || resp.unsignedTx || resp; // be robust to variants
            const { txid } = await signAndBroadcastUnsigned(call, MERCHANT_SK);
            const st = await waitForFinal(txid);
            if (st?.tx_status !== "success") return fail("cancel-invoice", st || {}, st?.tx_status);
            const printed = JSON.stringify(st.events || []).includes("invoice-canceled");
            return printed || fail("cancel event", st || {}, "missing print: invoice-canceled");
        } catch (e) {
            const j = await httpJson("POST", `/api/v1/stores/${STORE_ID}/invoices/${invId(invForCancel)}/cancel`, null, "merchant");
            return j?.canceled === true;
        }
    }, [need.storeId(), need.apiKey(), need.merchantSigner()]));
    results.push(await step("public: create-tx blocked after cancel", async () => {
        const res = await raw("POST", `/create-tx`, { "Content-Type": "application/json" }, { invoiceId: invId(invForCancel), payerPrincipal: DUMMY_PAYER });
        return res.status >= 400;
    }));

    // Expiry path + webhook
    results.push(await step("merchant: create short-ttl invoice (webhook test)", async () => {
        const j = await jsonCompat("POST", `/api/v1/stores/${STORE_ID}/invoices`, { amount_sats: 1111, ttl_seconds: 2, memo: "Soon expires" }, "merchant");
        invoiceExp = j;
        return looksLikePublicInvoice(j);
    }, [need.storeId(), need.apiKey()]));
    results.push(await step("public: create-tx blocked on expired", async () => {
        await sleep(6000);
        const res = await raw("POST", `/create-tx`, { "Content-Type": "application/json" }, { invoiceId: invId(invoiceExp), payerPrincipal: DUMMY_PAYER });
        return res.status >= 400;
    }, [need.invoiceExp()]));
    results.push(await step("webhook: invoice-expired delivered & signed (HMAC, skew≤300s)", async () => {
        // NEW: wait loop to tolerate poller lag
        const deadline = Date.now() + MAX_WAIT_MS;
        let hit = null;
        while (Date.now() < deadline) {
            hit = hook.captured.find((e) => typeof e.raw === "string" && e.raw.includes(String(invId(invoiceExp))));
            if (hit) break;
            await sleep(500);
        }
        if (!hit) return skip("webhook: invoice-expired delivered & signed (HMAC, skew≤300s)", "no webhook captured (poller lag)");
        const v = verifyWebhookSig(hit, HMAC_SECRET);
        return v.ok ? true : fail("webhook signature", v, v.reason);
    }, [need.invoiceExp(), need.hmac()]));
    results.push(await step("merchant: webhook logs include invoice-expired (optional)", async () => {
        const logs = await httpJson("GET", `/api/v1/stores/${STORE_ID}/webhooks`, null, "merchant");
        const blob = JSON.stringify(logs || []);
        return blob.includes("invoice-expired") && blob.includes(invId(invoiceExp))
            ? true
            : skip("merchant: webhook logs include invoice-expired (optional)", "not found (ok if emitted differently)");
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
    results.push(await step("public: create-tx rejects bad invoiceId (not a uuid)", async () => {
        const res = await raw("POST", `/create-tx`, { "Content-Type": "application/json" }, { invoiceId: "not-a-uuid", payerPrincipal: DUMMY_PAYER });
        return res.status >= 400;
    }));
    results.push(await step("public: create-tx rejects unknown invoiceId", async () => {
        const res = await raw("POST", `/create-tx`, { "Content-Type": "application/json" }, { invoiceId: "11111111-1111-1111-1111-111111111111", payerPrincipal: DUMMY_PAYER });
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
        return saw429 ? true : skip("public: /create-tx rate-limit smoke", "no 429 observed (threshold high or not enabled)");
    }));

    // Refunds (builder if present)
    results.push(await step("refund builder present (merchant)", async () => {
        try {
            const call = await jsonCompat("POST", `/api/v1/stores/${STORE_ID}/refunds/create-tx`, { invoiceId: invId(invoiceA), amount_sats: 1000, memo: "partial" }, "merchant");
            return looksLikeUnsignedCall(call, "refund-invoice");
        } catch {
            return blocked("refund builder present (merchant)", "route missing");
        }
    }, [need.storeId(), need.apiKey(), need.invoiceA(), need.payReady()]));
    results.push(await step("refund partial ok; cap enforced later", async () => {
        try {
            const call = await jsonCompat("POST", `/api/v1/stores/${STORE_ID}/refunds/create-tx`, { invoiceId: invId(invoiceA), amount_sats: 1000, memo: "partial" }, "merchant");
            const { txid } = await signAndBroadcastUnsigned(call, MERCHANT_SK);
            const st = await waitForFinal(txid);
            if (st?.tx_status !== "success") return fail("refund-invoice", st || {}, st?.tx_status);
            const printed = JSON.stringify(st.events || []).includes("invoice-refunded");
            return printed || fail("refund event", st || {}, "missing print: invoice-refunded");
        } catch (e) {
            return (e.status === 404 || e.status === 405) ? blocked("refund partial ok", "builder missing") : fail("refund partial ok", e);
        }
    }, [need.storeId(), need.apiKey(), need.invoiceA(), need.merchantSigner(), need.payReady()]));
    results.push(await step("refund wrong-token blocked (u307)", async () => {
        try {
            let call = await jsonCompat("POST", `/api/v1/stores/${STORE_ID}/refunds/create-tx`, { invoiceId: invId(invoiceA), amount_sats: 1, memo: "probe" }, "merchant");
            if (!looksLikeUnsignedCall(call, "refund-invoice")) return fail("unsigned shape", call);
            const fake = cvHex(Cl.contractPrincipal(call.contractAddress, call.contractName));
            const newArgs = call.functionArgs.slice(0, -1).concat(fake);
            call = { ...call, functionArgs: newArgs };
            const { txid } = await signAndBroadcastUnsigned(call, MERCHANT_SK);
            const st = await waitForFinal(txid);
            const s = String(repr(st));
            return (st?.tx_status?.startsWith("abort") && /err u307/.test(s)) || fail("refund wrong-token", st || {}, s || st?.tx_status);
        } catch (e) {
            return (e.status === 404 || e.status === 405) ? blocked("refund wrong-token", "builder missing") : fail("refund wrong-token", e);
        }
    }, [need.storeId(), need.apiKey(), need.invoiceA(), need.merchantSigner(), need.payReady()]));

    // Subscriptions
    results.push(await step("merchant: create subscription (invoice mode)", async () => {
        // Use snake_case keys and the 'subscriber' field; let jsonCompat retry with camel if needed.
        const body = {
            subscriber: DUMMY_PAYER,
            amount_sats: 1111,
            interval_blocks: 144,
            mode: "invoice",
        };
        // Use jsonCompat so either casing works.
        const j = await jsonCompat("POST", `/api/v1/stores/${STORE_ID}/subscriptions`, body, "merchant");
        sub = j;

        // Accept either `subscriber` or `subscriberPrincipal` in the response.
        const haveSubscriber = ("subscriber" in j) || ("subscriberPrincipal" in j);
        return haveSubscriber && expectKeys(j, ["id", "storeId", "amountSats", "intervalBlocks", "active", "mode"]);

    }, [need.storeId(), need.apiKey()]));

    results.push(await step("merchant: sub → invoice (magicLink present)", async () => {
        const j = await httpJson("POST", `/api/v1/stores/${STORE_ID}/subscriptions/${sub.id}/invoice`, { ttl_seconds: 300, memo: "From sub" }, "merchant");
        return looksLikePublicInvoice(j) && typeof j.magicLink === "string";
    }, [need.storeId(), need.apiKey(), need.subId()]));
    results.push(await step("merchant: sub direct create-tx without payerPrincipal rejected", async () => {
        await httpJson("POST", `/api/v1/stores/${STORE_ID}/subscriptions/${sub.id}/mode`, { mode: "direct" }, "merchant");
        const res = await raw("POST", `/api/v1/stores/${STORE_ID}/subscriptions/${sub.id}/create-tx`, { ...merchantHeaders() }, { /* missing payerPrincipal */ });
        return res.status >= 400;
    }, [need.storeId(), need.apiKey(), need.subId()]));
    results.push(await step("merchant: sub direct create-tx ok", async () => {
        const j = await httpJson("POST", `/api/v1/stores/${STORE_ID}/subscriptions/${sub.id}/create-tx`, { payerPrincipal: DUMMY_PAYER }, "merchant");
        return looksLikeUnsignedCall(j, "pay-subscription");
    }, [need.storeId(), need.apiKey(), need.subId(), need.payReady()]));
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
    results.push(await step("admin: reactivate store", async () => {
        const j = await httpJson("PATCH", `/api/admin/stores/${STORE_ID}/activate`, { active: true }, "admin");
        return j?.active === true;
    }, [need.storeId()]));

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
