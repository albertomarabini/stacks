#!/usr/bin/env node
/* Minimal probe for step 15:
   admin: set-sbtc-token → broadcast (tester wallet)

   Required env:
     BASE_URL                 (default http://localhost:3000)
     ADMIN_TOKEN  or  ADMIN_USER + ADMIN_PASS
     SBTC_CONTRACT_ADDRESS    (token principal address, e.g. ST... or SM...)
     SBTC_CONTRACT_NAME       (token contract name, e.g. sbtc-token)
     ADMIN_SECRET_KEY         (64/66 hex, keep trailing 01 for dev keys)
     STACKS_NETWORK           (mainnet|testnet|devnet|mocknet; default testnet)
     STACKS_API_URL           (override Hiro API base; default by network)
     WAIT_FOR_FINAL           (1 to poll)
     VERBOSE                  (1 for extra logs)
*/

import * as txlib from "@stacks/transactions";
import * as netlib from "@stacks/network";

const { AnchorMode, Cl, makeContractCall } = txlib;
const { networkFromName, clientFromNetwork } = (netlib.default ?? netlib);

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const STACKS_NETWORK = (process.env.STACKS_NETWORK || "testnet").toLowerCase();
const STACKS_API = process.env.STACKS_API_URL || (
  STACKS_NETWORK === "mainnet" ? "https://api.hiro.so" :
  STACKS_NETWORK === "devnet"  ? "http://localhost:3999" :
                                 "https://api.testnet.hiro.so"
);
const SBTC_ADDRESS = process.env.SBTC_CONTRACT_ADDRESS || "";
const SBTC_NAME = process.env.SBTC_CONTRACT_NAME || "";
const ADMIN_SK = (process.env.ADMIN_SECRET_KEY || "").replace(/^0x/i, "");
const VERBOSE = String(process.env.VERBOSE || "") === "1";
const WAIT_FOR_FINAL = String(process.env.WAIT_FOR_FINAL || "") === "1";

function log(...a){ if (VERBOSE) console.log(...a); }

// ── HTTP helpers ──────────────────────────────────────────────────────────────
function adminHeaders() {
  const h = { "Content-Type": "application/json" };
  if (process.env.ADMIN_USER && process.env.ADMIN_PASS) {
    const b64 = Buffer.from(`${process.env.ADMIN_USER}:${process.env.ADMIN_PASS}`).toString("base64");
    h.Authorization = `Basic ${b64}`;
  } else if (process.env.ADMIN_TOKEN) {
    h.Authorization = `Bearer ${process.env.ADMIN_TOKEN}`;
    h["X-Admin-Token"] = process.env.ADMIN_TOKEN;
    h["X-API-Key"] = process.env.ADMIN_TOKEN; // compat
  }
  return h;
}
async function httpJson(method, url, body, headers = {}) {
  const full = url.startsWith("http") ? url : `${BASE_URL}${url}`;
  log(`[HTTP] → ${method} ${full}`);
  const res = await fetch(full, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch {}
  log(`[HTTP] ← ${res.status} ${method} ${full} body=${(text||"").slice(0,300)}`);
  if (!res.ok) { const err = new Error(`HTTP ${res.status}: ${res.statusText}`); err.status = res.status; err.body = json ?? text; throw err; }
  return json;
}
async function apiJson(path) {
  const url = `${STACKS_API}${path}`;
  log(`[API] → GET ${url}`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Stacks API ${path} → HTTP ${r.status}`);
  return r.json();
}

// ── Network ───────────────────────────────────────────────────────────────────
function stacksNetwork() {
  let net = networkFromName(STACKS_NETWORK);
  if (STACKS_API) {
    const client = clientFromNetwork(net);
    net = { ...net, client: { ...client, baseUrl: STACKS_API } };
  }
  return net;
}

// ── CL arg coercion (server sends typed objects) ───────────────────────────────
function parseContractRef(s) {
  if (typeof s !== "string") return null;
  const [addr, name] = s.includes("::") ? s.split("::") : s.split(".");
  return (addr && name) ? { address: addr, name } : null;
}
function toClarityValue(a) {
  if (a && typeof a === "object" && typeof a.type === "string") {
    const t = a.type.toLowerCase();
    if ((t === "contract" || t === "contractprincipal") && typeof a.value === "string") {
      const p = parseContractRef(a.value);
      if (!p) throw new Error(`bad contract principal: ${a.value}`);
      return Cl.contractPrincipal(p.address, p.name);
    }
    if (t === "uint")   return Cl.uint(a.value);
    if (t === "int")    return Cl.int(a.value);
    if (t === "true" || t === "false") return Cl.bool(t === "true");
    if (t === "none")   return Cl.none();
    if (t === "some")   return Cl.some(toClarityValue(a.value));
    if (t === "buffer" && typeof a.value === "string") {
      return Cl.buffer(Buffer.from(a.value.replace(/^0x/i, ""), "hex"));
    }
  }
  if (typeof a === "string") {
    const p = parseContractRef(a);
    if (p) return Cl.contractPrincipal(p.address, p.name);
  }
  throw new Error(`Unsupported functionArg shape: ${JSON.stringify(a)}`);
}

// ── Broadcast helper (always octet-stream bytes) ──────────────────────────────
async function broadcastTx(tx) {
  let bytes = tx.serialize();
  if (typeof bytes === "string") bytes = Buffer.from(bytes.replace(/^0x/i, ""), "hex");
  const url = `${STACKS_API}/v2/transactions`;
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes });
  const text = await r.text();
  let j = null; try { j = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok) {
    const reason = j?.reason || j?.error || text || `HTTP ${r.status}`;
    const e = new Error(`broadcast failed: ${reason}`);
    e.body = text; throw e;
  }
  if (!j?.txid) throw new Error(`broadcast returned no txid: ${text}`);
  return j.txid;
}

async function fetchTxStatus(txid) {
  try {
    const r = await fetch(`${STACKS_API}/extended/v1/tx/${txid}`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!SBTC_ADDRESS || !SBTC_NAME) throw new Error("Set SBTC_CONTRACT_ADDRESS and SBTC_CONTRACT_NAME");
  if (!ADMIN_SK) throw new Error("Set ADMIN_SECRET_KEY (hex private key)");

  console.log(`[CFG] network=${STACKS_NETWORK} api=${STACKS_API}`);

  // 1) Ask server for the unsigned call (this reveals the PAYMENT contract coords)
  const unsignedResp = await httpJson("POST", "/api/admin/set-sbtc-token",
    { contractAddress: SBTC_ADDRESS, contractName: SBTC_NAME },
    adminHeaders()
  );
  const unsigned = unsignedResp?.call || unsignedResp;
  if (!unsigned || unsigned.functionName !== "set-sbtc-token") {
    throw new Error(`Unexpected unsigned call shape: ${JSON.stringify(unsignedResp)}`);
  }
  if (VERBOSE) {
    console.log(`[CALL] ${unsigned.contractAddress}::${unsigned.contractName}.${unsigned.functionName}`);
    console.log(`[ARGS] ${JSON.stringify(unsigned.functionArgs)}`);
  }

  // 2) Now preflight both contracts on the broadcast node (correct principals)
  await apiJson(`/v2/contracts/interface/${unsigned.contractAddress}/${unsigned.contractName}`)
    .catch(() => { throw new Error(`${unsigned.contractName} NOT found at STACKS_API_URL`); });

  await apiJson(`/v2/contracts/interface/${SBTC_ADDRESS}/${SBTC_NAME}`)
    .catch(() => { throw new Error(`${SBTC_NAME} NOT found at STACKS_API_URL`); });

  console.log("[CHK] payment+token contracts exist on the broadcast node");

  // 3) Sign
  const args = (unsigned.functionArgs || []).map(toClarityValue);
  const tx = await makeContractCall({
    contractAddress: unsigned.contractAddress,
    contractName:   unsigned.contractName,
    functionName:   unsigned.functionName,
    functionArgs:   args,
    senderKey:      ADMIN_SK,
    network:        stacksNetwork(),
    anchorMode:     AnchorMode.Any,
  });

  // 4) Broadcast (bytes)
  const txid = await broadcastTx(tx);
  console.log(`OK → broadcasted set-sbtc-token txid=${txid}`);

  if (WAIT_FOR_FINAL) {
    process.stdout.write("waiting for confirmation… ");
    const started = Date.now();
    while (Date.now() - started < 30000) {
      const j = await fetchTxStatus(txid);
      const st = j?.tx_status;
      if (st && st !== "pending") {
        console.log(`\nfinal status: ${st}`);
        if (VERBOSE) console.log(JSON.stringify(j, null, 2));
        return;
      }
      await new Promise(r => setTimeout(r, 1500));
      process.stdout.write(".");
    }
    console.log("\n(ended wait loop without final status)");
  }
}

main().catch((e) => {
  console.error("FAILED:", e.message);
  if (e.body) console.error("body:", e.body);
  process.exit(1);
});
