// scripts/fund-devnet-payer.mjs
/* eslint-disable no-console */
// Minimal, no extra config. Uses only your existing envs.

import * as tx from '@stacks/transactions';
import netPkg from '@stacks/network';

const Net = netPkg.default ?? netPkg;
// These exist in the CJS build your env prints out.
const { networkFromName, clientFromNetwork } = Net;

// ── Env (all already present in your runner) ────────────────────────────────
const {
  STACKS_NETWORK = 'devnet',
  STACKS_API_URL = 'http://localhost:3999',
  SBTC_CONTRACT_ADDRESS,
  SBTC_CONTRACT_NAME = 'sbtc-token',
  ADMIN_SECRET_KEY,
  MERCHANT_SECRET_KEY,
  PAYER_PRINCIPAL,
  FUND_AMOUNT_SATS = '100000', // 100k sats default
} = process.env;

if (!SBTC_CONTRACT_ADDRESS) throw new Error('SBTC_CONTRACT_ADDRESS required');
if (!PAYER_PRINCIPAL) throw new Error('PAYER_PRINCIPAL required');

const OWNER_SK = ADMIN_SECRET_KEY || MERCHANT_SECRET_KEY;
if (!OWNER_SK) throw new Error('ADMIN_SECRET_KEY or MERCHANT_SECRET_KEY required');

const FUND_AMOUNT = BigInt(FUND_AMOUNT_SATS);

// ── Network (point at your local API) ───────────────────────────────────────
let nw = networkFromName ? networkFromName(STACKS_NETWORK) : undefined;
if (nw) {
  const client = clientFromNetwork ? clientFromNetwork(nw) : { baseUrl: STACKS_API_URL };
  nw = { ...nw, client: { ...client, baseUrl: STACKS_API_URL }, coreApiUrl: STACKS_API_URL };
} else {
  // ultra-minimal fallback used by stacks.js
  nw = { coreApiUrl: STACKS_API_URL, client: { baseUrl: STACKS_API_URL } };
}
const network = nw;

// ── Helpers ─────────────────────────────────────────────────────────────────
async function waitOk(txid) {
  const url = `${STACKS_API_URL}/extended/v1/tx/${txid}`;
  for (let i = 0; i < 45; i++) {
    const r = await fetch(url).then(r => r.json()).catch(() => null);
    if (r?.tx_status === 'success') return r;
    if (r?.tx_status === 'abort_by_response') {
      const repr = r?.tx_result?.repr || r?.tx_result || '';
      throw new Error(`abort_by_response: ${repr}`);
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  throw new Error('timeout waiting for confirmation');
}

// stacks.js has (new) object signature and (old) positional; try both.
async function broadcastCompat(stxTx) {
  try {
    const res = await tx.broadcastTransaction({ transaction: stxTx, network });
    return typeof res === 'string' ? res : res?.txid || res;
  } catch {
    const res = await tx.broadcastTransaction(stxTx, network);
    return typeof res === 'string' ? res : res?.txid || res;
  }
}

async function call(ownerKey, fn, args) {
  const c = await tx.makeContractCall({
    contractAddress: SBTC_CONTRACT_ADDRESS,
    contractName: SBTC_CONTRACT_NAME,
    functionName: fn,
    functionArgs: args,
    senderKey: ownerKey,
    network,
    anchorMode: tx.AnchorMode.Any,
    postConditionMode: tx.PostConditionMode.Deny,
  });
  const txid = await broadcastCompat(c);
  if (!txid || typeof txid !== 'string') {
    throw new Error(`broadcast failed: ${JSON.stringify(txid)}`);
  }
  return waitOk(txid);
}

(async () => {
  console.log('[DEVNET] funding payer with sBTC');

  // 1) bootstrap-owner (idempotent; ignore ERR u100 if already set)
  try {
    await call(OWNER_SK, 'bootstrap-owner', []);
    console.log('  → bootstrap-owner: ok');
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes('u100')) {
      console.log('  → bootstrap-owner: already set (u100), continuing');
    } else {
      throw e;
    }
  }

  // 2) mint(to, amount) — your demo token signature matches this order
  await call(OWNER_SK, 'mint', [
    tx.Cl.standardPrincipal(PAYER_PRINCIPAL),
    tx.Cl.uint(FUND_AMOUNT),
  ]);
  console.log(`  → mint ${FUND_AMOUNT} sats to ${PAYER_PRINCIPAL}: ok`);

  // 3) quick read-only balance check
  const ro = await fetch(
    `${STACKS_API_URL}/v2/contracts/call-read/${SBTC_CONTRACT_ADDRESS}/${SBTC_CONTRACT_NAME}/get-balance`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender: PAYER_PRINCIPAL,
        arguments: [tx.cvToHex(tx.Cl.principal(PAYER_PRINCIPAL))],
      }),
    }
  ).then(r => r.json()).catch(() => null);

  if (ro?.result) console.log(`  → get-balance: ${ro.result}`);
  console.log('[DEVNET] funding complete');
})().catch(err => {
  console.error('[DEVNET] funding failed:', err?.message || err);
  process.exit(1);
});
