#!/usr/bin/env bash
set -euo pipefail

# Seeds a local data.sqlite with a test merchant and a test invoice.
# Usage: ./scripts/seed-dev.sh

DB_PATH="${DB_PATH:-data.sqlite}"

now_ms() {
  echo "$(($(date +%s) * 1000))"
}

NOW_MS=$(now_ms)
FUTURE_MS=$((NOW_MS + 86400000)) # +1 day

INVOICE_ID_RAW="inv-1"
INVOICE_ID_HEX="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
STORE_ID="test-store"
MERCHANT_PRINCIPAL="SP0000000000000000000000000000000000000000"
API_KEY="test-api-key"

cat <<SQL | sqlite3 "$DB_PATH"
PRAGMA foreign_keys = ON;
INSERT OR IGNORE INTO merchants (id, principal, name, hmac_secret, api_key, active, created_at)
VALUES(
  '${STORE_ID}',
  '${MERCHANT_PRINCIPAL}',
  'Test Store',
  'hmac-secret',
  '${API_KEY}',
  1,
  ${NOW_MS}
);

INSERT OR IGNORE INTO invoices (id_raw, id_hex, store_id, amount_sats, usd_at_create, quote_expires_at, merchant_principal, status, created_at)
VALUES(
  '${INVOICE_ID_RAW}',
  '${INVOICE_ID_HEX}',
  '${STORE_ID}',
  1000,
  10.0,
  ${FUTURE_MS},
  '${MERCHANT_PRINCIPAL}',
  'unpaid',
  ${NOW_MS}
);
SQL

echo "Seeded $DB_PATH with merchant '${STORE_ID}' (api_key=${API_KEY}) and invoice '${INVOICE_ID_RAW}'."

cat <<EOF
Now try these requests (server must be running):

curl -i http://localhost:3000/

curl -i http://localhost:3000/i/${INVOICE_ID_RAW}

curl -i http://localhost:3000/api/v1/stores/${STORE_ID}/public-profile

# Merchant-protected endpoint (create invoice) - example; server may validate body and fail if required fields are missing
curl -i -H "X-API-Key: ${API_KEY}" -H 'Content-Type: application/json' \
  -d '{"amountSats":1000, "memo":"dev test"}' \
  http://localhost:3000/api/v1/stores/${STORE_ID}/invoices

EOF
