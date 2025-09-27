#!/usr/bin/env bash
set -euo pipefail

### ── Server/API ──────────────────────────────────────────────────────────────
export BASE_URL="http://localhost:3000"
export ADMIN_TOKEN="b32a6a5d8f5f4a4d8c2a25e52a447bb3c1dbecc28d8bba1a4b6fbe82b24741f0"
export ADMIN_USER="admin"
export ADMIN_PASS="secret"

### ── Merchant / Stacks (devnet) ─────────────────────────────────────────────
export MERCHANT_PRINCIPAL="ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5"
export STACKS_NETWORK="devnet"
export STACKS_API_URL="http://localhost:3999"

### ── Signers (devnet keys; keep trailing 01) ────────────────────────────────
export ADMIN_SECRET_KEY="753b7cc01a1a2e86221266a154af739463fce51219d97e4f856cd7200c3bd2a601"
export MERCHANT_SECRET_KEY="7287ba251d44a4d3fd9276c88ce34c5c52a038955511cccaf77e61068649c17801"
export PAYER_SECRET_KEY="530d9f61984c888536871c6573073bdfc0058896dc1adfe9a6a10dfacadc209101"
export PAYER_PRINCIPAL="ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG"

### ── Optional: sBTC token (uncomment if deployed on devnet) ─────────────────
export SBTC_CONTRACT_ADDRESS="ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
export SBTC_CONTRACT_NAME="sbtc-token"
export ALT_FT_CONTRACT="ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.bogus-token"

### ── Misc ───────────────────────────────────────────────────────────────────
export BRAND_NAME="Demo Store"
export MAX_WAIT_MS="60000"
export DB_PATH="${DB_PATH:-./invoices.sqlite}"
export VERBOSE=1

### ── Lmt ───────────────────────────────────────────────────────────────────

unset ONLY_INDEX
unset FROM_INDEX
unset TO_INDEX
unset STEPS_LIST
# export FROM_INDEX=1
# export TO_INDEX=26
# export ONLY_INDEX=26
# export STEPS_LIST="3,7,8,14,15,18,19,22,26,47"

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
      echo "No keys in DB yet for principal $MERCHANT_PRINCIPAL (will rely on test script to rotate or read later)."
    fi
  else
    echo "sqlite3 not found or DB_PATH '$DB_PATH' missing; set MERCHANT_API_KEY/HMAC_SECRET manually if needed."
  fi
fi
node -p "require.resolve('@stacks/network')"
node -e "import('@stacks/network').then(m=>console.log(!!m.default, Object.keys(m)))"
### ── Sanity prints ──────────────────────────────────────────────────────────
node -e '
  const tx = require("@stacks/transactions");
  const net = { transactionVersion: 0x80 }; // devnet/testnet
  const show = (label, sk) => console.log(label, tx.getAddressFromPrivateKey(sk, net));
  show("ADMIN   :", process.env.ADMIN_SECRET_KEY);
  show("MERCHANT:", process.env.MERCHANT_SECRET_KEY);
  show("PAYER   :", process.env.PAYER_SECRET_KEY);
  console.log("MERCHANT_PRINCIPAL env  :", process.env.MERCHANT_PRINCIPAL);
  console.log("PAYER_PRINCIPAL env     :", process.env.PAYER_PRINCIPAL);
' || true

### ── Contract existence checks (devnet) ──────────────────────────────────────
if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required for contract checks"; exit 1
fi

api="${STACKS_API_URL:?STACKS_API_URL missing}"
addr="${SBTC_CONTRACT_ADDRESS:?SBTC_CONTRACT_ADDRESS missing}"

check_contract () {
  local address="$1" name="$2" require="$3"
  local url="$api/v2/contracts/interface/$address/$name"
  local code
  code="$(curl -s -o /dev/null -w "%{http_code}" "$url")"
  if [[ "$code" == "200" ]]; then
    echo "✅ found contract: ${address}::${name} (via $api)"
    return 0
  fi
  if [[ "$require" == "required" ]]; then
    echo "❌ REQUIRED contract missing: ${address}::${name}  (HTTP $code)"
    echo "   → Check your Clarinet devnet deployment plan & run: clarinet deployments apply --devnet -p deployments/default.devnet-plan.yaml"
    exit 1
  else
    echo "⚠️  Optional contract missing: ${address}::${name}  (HTTP $code)"
    return 1
  fi
}

echo "[CHK] verifying contracts on $api for principal $addr"
# Required: payment contract (must be deployed)
check_contract "$addr" "sbtc-payment" "required"

# Optional: token check only if name provided
if [[ -n "${SBTC_CONTRACT_NAME:-}" ]]; then
  check_contract "$addr" "$SBTC_CONTRACT_NAME" "optional" || {
    echo "   hint: your repo uses 'sbtc-token' — set SBTC_CONTRACT_NAME=sbtc-token if that’s what you deployed."
  }
else
  echo "ℹ️  SBTC_CONTRACT_NAME not set; skipping token contract check."
fi


#!/usr/bin/env bash
set -euo pipefail

### ── Server/API ──────────────────────────────────────────────────────────────
export BASE_URL="http://localhost:3000"
export ADMIN_TOKEN="b32a6a5d8f5f4a4d8c2a25e52a447bb3c1dbecc28d8bba1a4b6fbe82b24741f0"
export ADMIN_USER="admin"
export ADMIN_PASS="secret"

### ── Merchant / Stacks (devnet) ─────────────────────────────────────────────
export MERCHANT_PRINCIPAL="ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5"
export STACKS_NETWORK="devnet"
export STACKS_API_URL="http://localhost:3999"

### ── Signers (devnet keys; keep trailing 01) ────────────────────────────────
export ADMIN_SECRET_KEY="753b7cc01a1a2e86221266a154af739463fce51219d97e4f856cd7200c3bd2a601"
export MERCHANT_SECRET_KEY="7287ba251d44a4d3fd9276c88ce34c5c52a038955511cccaf77e61068649c17801"
export PAYER_SECRET_KEY="530d9f61984c888536871c6573073bdfc0058896dc1adfe9a6a10dfacadc209101"
export PAYER_PRINCIPAL="ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG"

### ── Optional: sBTC token (uncomment if deployed on devnet) ─────────────────
export SBTC_CONTRACT_ADDRESS="ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
export SBTC_CONTRACT_NAME="sbtc-token"
export ALT_FT_CONTRACT="ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.bogus-token"

### ── Misc ───────────────────────────────────────────────────────────────────
export BRAND_NAME="Demo Store"
export FETCH_TIMEOUT_MS=20000
export MAX_WAIT_MS=90000
export DB_PATH="${DB_PATH:-./invoices.sqlite}"
export VERBOSE=1

### ── Lmt ───────────────────────────────────────────────────────────────────

unset ONLY_INDEX
unset FROM_INDEX
unset TO_INDEX
unset STEPS_LIST
# export FROM_INDEX=1
# export TO_INDEX=26
# export ONLY_INDEX=26
# export STEPS_LIST="1,4,8,9,12,13,52,53,54,76,77,78"

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
      echo "No keys in DB yet for principal $MERCHANT_PRINCIPAL (will rely on test script to rotate or read later)."
    fi
  else
    echo "sqlite3 not found or DB_PATH '$DB_PATH' missing; set MERCHANT_API_KEY/HMAC_SECRET manually if needed."
  fi
fi
node -p "require.resolve('@stacks/network')"
node -e "import('@stacks/network').then(m=>console.log(!!m.default, Object.keys(m)))"
### ── Sanity prints ──────────────────────────────────────────────────────────
node -e '
  const tx = require("@stacks/transactions");
  const net = { transactionVersion: 0x80 }; // devnet/testnet
  const show = (label, sk) => console.log(label, tx.getAddressFromPrivateKey(sk, net));
  show("ADMIN   :", process.env.ADMIN_SECRET_KEY);
  show("MERCHANT:", process.env.MERCHANT_SECRET_KEY);
  show("PAYER   :", process.env.PAYER_SECRET_KEY);
  console.log("MERCHANT_PRINCIPAL env  :", process.env.MERCHANT_PRINCIPAL);
  console.log("PAYER_PRINCIPAL env     :", process.env.PAYER_PRINCIPAL);
' || true

### ── Contract existence checks (devnet) ──────────────────────────────────────
if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required for contract checks"; exit 1
fi

api="${STACKS_API_URL:?STACKS_API_URL missing}"
addr="${SBTC_CONTRACT_ADDRESS:?SBTC_CONTRACT_ADDRESS missing}"

check_contract () {
  local address="$1" name="$2" require="$3"
  local url="$api/v2/contracts/interface/$address/$name"
  local code
  code="$(curl -s -o /dev/null -w "%{http_code}" "$url")"
  if [[ "$code" == "200" ]]; then
    echo "✅ found contract: ${address}::${name} (via $api)"
    return 0
  fi
  if [[ "$require" == "required" ]]; then
    echo "❌ REQUIRED contract missing: ${address}::${name}  (HTTP $code)"
    echo "   → Check your Clarinet devnet deployment plan & run: clarinet deployments apply --devnet -p deployments/default.devnet-plan.yaml"
    exit 1
  else
    echo "⚠️  Optional contract missing: ${address}::${name}  (HTTP $code)"
    return 1
  fi
}

echo "[CHK] verifying contracts on $api for principal $addr"
# Required: payment contract (must be deployed)
check_contract "$addr" "sbtc-payment" "required"

# Optional: token check only if name provided
if [[ -n "${SBTC_CONTRACT_NAME:-}" ]]; then
  check_contract "$addr" "$SBTC_CONTRACT_NAME" "optional" || {
    echo "   hint: your repo uses 'sbtc-token' — set SBTC_CONTRACT_NAME=sbtc-token if that’s what you deployed."
  }
else
  echo "ℹ️  SBTC_CONTRACT_NAME not set; skipping token contract check."
fi

### ── Optional: devnet funding (bootstrap+mint payer) ─────────────────────────
if [[ "${STACKS_NETWORK,,}" == "devnet" ]]; then
    echo "[DEVNET] funding payer with sBTC via scripts"
    # Allow override with FUND_AMOUNT; defaults to 100_000 sats inside the script
    node scripts/fund-devnet-payer.mjs || { echo "❌ funding failed"; exit 1; }
fi

### ── Run self-test ──────────────────────────────────────────────────────────
node scripts/quick-server.mjs
