#!/usr/bin/env bash
set -euo pipefail

### ── Server/API ──────────────────────────────────────────────────────────────
export BASE_URL="${BASE_URL:-http://localhost:3000}"
export ADMIN_TOKEN="${ADMIN_TOKEN:-b32a6a5d8f5f4a4d8c2a25e52a447bb3c1dbecc28d8bba1a4b6fbe82b24741f0}"
export ADMIN_USER="${ADMIN_USER:-admin}"
export ADMIN_PASS="${ADMIN_PASS:-secret}"

### ── Merchant / Stacks (devnet) ─────────────────────────────────────────────
export MERCHANT_PRINCIPAL="${MERCHANT_PRINCIPAL:-ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5}"
export STACKS_NETWORK="${STACKS_NETWORK:-devnet}"
export STACKS_API_URL="${STACKS_API_URL:-http://localhost:3999}"   # Clarinet/sidecar default

### ── Signers (devnet keys; keep trailing 01) ────────────────────────────────
export ADMIN_SECRET_KEY="${ADMIN_SECRET_KEY:-753b7cc01a1a2e86221266a154af739463fce51219d97e4f856cd7200c3bd2a601}"
export MERCHANT_SECRET_KEY="${MERCHANT_SECRET_KEY:-7287ba251d44a4d3fd9276c88ce34c5c52a038955511cccaf77e61068649c17801}"
export PAYER_SECRET_KEY="${PAYER_SECRET_KEY:-530d9f61984c888536871c6573073bdfc0058896dc1adfe9a6a10dfacadc209101}"
export PAYER_PRINCIPAL="${PAYER_PRINCIPAL:-ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG}"

### ── sBTC token / payment contract references ───────────────────────────────
export CONTRACT_ADDRESS="${CONTRACT_ADDRESS:-ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM}"
export CONTRACT_NAME="${CONTRACT_NAME:-sbtc-payment}"
export SBTC_CONTRACT_ADDRESS="${SBTC_CONTRACT_ADDRESS:-ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM}"
export SBTC_CONTRACT_NAME="${SBTC_CONTRACT_NAME:-sbtc-token}"

### ── Misc ───────────────────────────────────────────────────────────────────
export BRAND_NAME="${BRAND_NAME:-Demo Store}"
export MAX_WAIT_MS="${MAX_WAIT_MS:-60000}"
export DB_PATH="${DB_PATH:-./invoices.sqlite}"
export VERBOSE="${VERBOSE:-1}"
export WAIT_FOR_FINAL="${WAIT_FOR_FINAL:-1}"

### ── Auto-seed MERCHANT_API_KEY / HMAC_SECRET from SQLite (if available) ────
if [[ -z "${MERCHANT_API_KEY:-}" || -z "${HMAC_SECRET:-}" ]]; then
  if command -v sqlite3 >/dev/null 2>&1 && [[ -f "$DB_PATH" ]]; then
    IFS=, read -r DB_API_KEY DB_HMAC_SECRET < <(
      sqlite3 -csv "$DB_PATH" \
        "SELECT api_key,hmac_secret FROM merchants WHERE principal='$MERCHANT_PRINCIPAL' LIMIT 1;"
    ) || true
    if [[ -n "${DB_API_KEY:-}" && -n "${DB_HMAC_SECRET:-}" ]]; then
      export MERCHANT_API_KEY="$DB_API_KEY"
      export HMAC_SECRET="$DB_HMAC_SECRET"
      echo "Seeded keys from DB: MERCHANT_API_KEY=$(echo "$MERCHANT_API_KEY" | head -c 8)… HMAC_SECRET=$(echo "$HMAC_SECRET" | head -c 8)…"
    else
      echo "No keys in DB yet for principal $MERCHANT_PRINCIPAL (ok for this probe)."
    fi
  else
    echo "sqlite3 not found or DB_PATH '$DB_PATH' missing; skipping DB seed."
  fi
fi

### ── Library presence / shape ────────────────────────────────────────────────
node -p "require.resolve('@stacks/network')" || true
node -e "import('@stacks/network').then(m=>console.log('network exports:', Object.keys(m)))" || true

# --- stacks.js network sanity (version-agnostic) ---

# --- stacks.js network sanity (stable) ---
node - <<'NODE'
const net = require('@stacks/network');
const { networkFromName, whenTransactionVersion, TransactionVersion } = (net.default ?? net);
const name = (process.env.STACKS_NETWORK || 'testnet').toLowerCase();
const n = networkFromName(name);

// prefer helper if present; else fall back to enum or 0x80/0x00
let version;
if (typeof whenTransactionVersion === 'function') {
  version = whenTransactionVersion(n, { mainnet: 0x00, testnet: 0x80 });
}
if (version === undefined && TransactionVersion) {
  version = name === 'mainnet' ? TransactionVersion.Mainnet : TransactionVersion.Testnet;
}
if (version === undefined) {
  version = (name === 'mainnet') ? 0x00 : 0x80;
}

const baseUrl = (n.client && n.client.baseUrl) || 'n/a';
console.log('stx network sanity:', { name, baseUrl, version });
NODE
# ----------------------------------------

# ---------------------------------------------------

### ── Preflight: contracts must exist on this node ────────────────────────────
set +e
curl -sf "${STACKS_API_URL}/v2/contracts/interface/${CONTRACT_ADDRESS}/${CONTRACT_NAME}" > /dev/null \
  && echo "✅ ${CONTRACT_NAME} exists at ${CONTRACT_ADDRESS}" \
  || echo "❌ ${CONTRACT_NAME} NOT found at ${CONTRACT_ADDRESS}"
curl -sf "${STACKS_API_URL}/v2/contracts/interface/${SBTC_CONTRACT_ADDRESS}/${SBTC_CONTRACT_NAME}" > /dev/null \
  && echo "✅ ${SBTC_CONTRACT_NAME} exists at ${SBTC_CONTRACT_ADDRESS}" \
  || echo "⚠️  ${SBTC_CONTRACT_NAME} not found (token contract optional until configured)"
set -e

### ── Run probe ───────────────────────────────────────────────────────────────
node scripts/quick-server-15.mjs
