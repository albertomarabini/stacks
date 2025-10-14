#!/usr/bin/env node
import fetch from "node-fetch";
import * as Cl from "@stacks/transactions";
import { STACKS_DEVNET } from "@stacks/network";

// ===== CONFIG (devnet) =====
const BASE_URL = "http://localhost:3000";         // your WEBPAY (for DTO only)
const STACKS_API_URL = "http://localhost:3999";   // Hiro API (extended)
const NODE_RPC_URL  = "http://localhost:20443";   // stacks-node RPC (/v2)

// From your .env (devnet)
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
const CONTRACT_NAME    = process.env.CONTRACT_NAME    || "sbtc-payment";
const SBTC_ADDR        = process.env.SBTC_CONTRACT_ADDRESS || "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
const SBTC_NAME        = process.env.SBTC_CONTRACT_NAME    || "sbtc-token";

// PAYER (devnet wallet)
const PAYER_SECRET_KEY = process.env.PAYER_SECRET_KEY || "530d9f61984c888536871c6573073bdfc0058896dc1adfe9a6a10dfacadc209101";
const PAYER_PRINCIPAL  = process.env.PAYER_PRINCIPAL  || "ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG";

// ===== ARGS =====
const [, , INVOICE_ID_HEX] = process.argv;
if (!INVOICE_ID_HEX) {
  console.error("Usage: node pay-invoice-devnet.mjs <INVOICE_ID_HEX>");
  process.exit(1);
}

// Toggle diagnostics
const DIAGNOSE = true;  // true = PostConditionMode.Allow + extra logs

// ===== HELPERS =====
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const cleanHex = (s) => String(s || "").replace(/^0x/i, "");

async function http(method, url, body, headers = {}) {
  const res = await fetch(url, { method, headers, body });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { ok: res.ok, status: res.status, json, text, headers: Object.fromEntries(res.headers.entries()) };
}
async function httpJson(method, url, body) {
  const { ok, status, json, text } = await http(method, url, body ? JSON.stringify(body) : undefined, {
    "Content-Type": "application/json"
  });
  if (!ok) { const e = new Error(`HTTP ${status}: ${text || JSON.stringify(json)}`); e.status = status; throw e; }
  return json ?? {};
}

async function callRead({ contractAddress, contractName, functionName, sender, args }) {
  const body = { sender, arguments: (args || []).map(Cl.cvToHex) };
  const { ok, status, json, text } = await http(
    "POST",
    `${NODE_RPC_URL}/v2/contracts/call-read/${contractAddress}/${contractName}/${functionName}`,
    JSON.stringify(body),
    { "Content-Type": "application/json" }
  );
  if (!ok) throw new Error(`call-read ${status}: ${text}`);
  return json;
}

async function fetchTx(txid) {
  const r = await http("GET", `${STACKS_API_URL}/extended/v1/tx/${txid}`);
  if (!r.ok) throw new Error(`tx fetch ${r.status}: ${r.text}`);
  return r.json;
}
async function fetchTxEvents(txid) {
  const r = await http("GET", `${STACKS_API_URL}/extended/v1/tx/events?tx_id=${txid}`);
  if (!r.ok) return null;
  return r.json;
}
async function waitForFinal(txid, tries = 120, delayMs = 1000) {
  for (let i = 0; i < tries; i++) {
    const dto = await fetchTx(txid);
    const st = String(dto?.tx_status || "").toLowerCase();
    const reason = dto?.tx_status_reason;
    console.log(`[chain] tx_status=${st} height=${dto?.block_height ?? "-"}${reason ? ` reason=${reason}` : ""}`);
    if (st === "success") return dto;
    if (["abort_by_post_condition","abort_by_response","rejected","dropped_replace_by_fee"].includes(st)) {
      const ev = await fetchTxEvents(txid).catch(()=>null);
      console.log("[events]", Array.isArray(ev?.events) ? ev.events.map(e => e.event_type) : ev);
      throw new Error(`tx failed: ${reason || st}`);
    }
    await sleep(delayMs);
  }
  throw new Error("timeout waiting for tx success");
}

function pcHuman(pc) {
  return pc.type === "ft-postcondition"
    ? { type: pc.type, addr: pc.address, cond: pc.condition, amount: pc.amount, asset: pc.asset }
    : { type: pc.type, addr: pc.address, cond: pc.condition, amount: pc.amount };
}

// ===== MAIN =====
(async () => {
  const idHex = cleanHex(INVOICE_ID_HEX);

  // 0) Pull invoice DTO from WEBPAY (amount & sanity)
  const dto = await httpJson("GET", `${BASE_URL}/i/${idHex}`);
  const amountSats = Number(dto?.amountSats || 0);
  if (!amountSats || !dto?.invoiceId) throw new Error("invoice DTO missing/invalid");
  console.log("[invoice]", { invoiceId: dto.invoiceId, amountSats, status: dto.status });

  // 0a) Optional preflight on-chain state
  try {
    const idBuff = Cl.bufferCV(Buffer.from(idHex, "hex"));
    const stV2 = await callRead({
      contractAddress: CONTRACT_ADDRESS, contractName: CONTRACT_NAME,
      functionName: "get-invoice-status-v2",
      sender: CONTRACT_ADDRESS,
      args: [Cl.tupleCV({ id: idBuff })],
    });
    const j = Cl.cvToJSON(Cl.hexToCV(stV2.result));
    console.log("[preflight] status:", j?.value);
  } catch(e) { console.log("[preflight] skipped:", e.message); }

  // 1) Build args for (pay-invoice (buff 32) (ft <ft-trait>))
  const functionName = "pay-invoice";
  const functionArgs = [
    Cl.bufferCV(Buffer.from(idHex, "hex")),
    Cl.contractPrincipalCV(SBTC_ADDR, SBTC_NAME),
  ];

  // 2) Post-conditions (payer spends exactly amountSats of sBTC)
  const assetId = `${SBTC_ADDR}.${SBTC_NAME}::${"sbtc"}`; // replace "sbtc" with actual token name if different
  // The Pc API needs contract FQ + asset name split
  const pcPayer = Cl.Pc.principal(PAYER_PRINCIPAL).willSendEq(BigInt(amountSats)).ft(`${SBTC_ADDR}.${SBTC_NAME}`, "sbtc");
  // STX guard (no STX spend) for payer/contract/burn
  const pcNoStx = [
    Cl.Pc.principal(PAYER_PRINCIPAL).willSendLte(0).ustx(),
    Cl.Pc.principal(`${CONTRACT_ADDRESS}`).willSendLte(0).ustx(),
    Cl.Pc.principal("STNHKEPYEPJ8ET55ZZ0M5A34J0R3N5FM2CMMMAZ6").willSendLte(0).ustx(),
  ];
  const postConditions = DIAGNOSE ? [] : [pcPayer, ...pcNoStx];
  const postConditionMode = DIAGNOSE ? Cl.PostConditionMode.Allow : Cl.PostConditionMode.Deny;

  console.log("[pcs]", postConditions.map(pcHuman));
  console.log("[call]", `${CONTRACT_ADDRESS}.${CONTRACT_NAME}::${functionName}`);

  // 3) Build & broadcast
  const tx = await Cl.makeContractCall({
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    functionName,
    functionArgs,
    postConditionMode,
    postConditions,
    senderKey: PAYER_SECRET_KEY,
    validateWithAbi: false,
    network: STACKS_DEVNET,
    anchorMode: Cl.AnchorMode.Any,
  });

  const { txid, error, reason, reason_data } = await Cl.broadcastTransaction({ transaction: tx, network: STACKS_DEVNET });
  if (!txid) {
    console.error("Broadcast failed:", { error, reason, reason_data });
    process.exit(2);
  }
  console.log("Broadcasted:", txid);

  // 4) Wait for success, print events
  const finalTx = await waitForFinal(txid);
  console.log("[final]", { tx_status: finalTx?.tx_status, block_height: finalTx?.block_height });

  const evs = await fetchTxEvents(txid).catch(()=>null);
  if (Array.isArray(evs?.events)) {
    for (const e of evs.events) {
      if (e.event_type === "ft_asset") {
        console.log("[FT]", { sender: e.asset?.sender, recipient: e.asset?.recipient, asset: e.asset?.asset_identifier, amount: e.asset?.amount });
      }
    }
  }
})();
