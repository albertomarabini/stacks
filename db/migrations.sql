-- SQL DDL (SQLite)
CREATE TABLE IF NOT EXISTS merchants (
  id TEXT PRIMARY KEY,
  principal TEXT NOT NULL UNIQUE,
  name TEXT,
  display_name TEXT,
  logo_url TEXT,
  brand_color TEXT,
  webhook_url TEXT,
  hmac_secret TEXT NOT NULL,
  api_key TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  support_email TEXT,
  support_url TEXT,
  allowed_origins TEXT,
  created_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_merchants_principal ON merchants(principal);
CREATE UNIQUE INDEX IF NOT EXISTS ux_merchants_api_key ON merchants(api_key);

CREATE TABLE IF NOT EXISTS invoices (
  id_raw TEXT PRIMARY KEY,
  id_hex TEXT NOT NULL,
  store_id TEXT NOT NULL REFERENCES merchants(id),
  amount_sats INTEGER NOT NULL,
  usd_at_create REAL NOT NULL,
  quote_expires_at INTEGER NOT NULL,
  merchant_principal TEXT NOT NULL,
  status TEXT NOT NULL,
  payer TEXT,
  txid TEXT,
  memo TEXT,
  webhook_url TEXT,
  created_at INTEGER NOT NULL,
  refunded_at INTEGER,
  refund_amount INTEGER NOT NULL DEFAULT 0,
  refund_txid TEXT,
  subscription_id TEXT,
  refund_count INTEGER NOT NULL DEFAULT 0,
  expired INTEGER NOT NULL DEFAULT 0,
  CHECK (length(id_hex) = 64),
  CHECK (id_hex GLOB '[0-9A-Fa-f]*')
);
CREATE INDEX IF NOT EXISTS idx_invoices_store ON invoices(store_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE UNIQUE INDEX IF NOT EXISTS ux_invoices_id_hex ON invoices(id_hex);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  id_hex TEXT NOT NULL,
  store_id TEXT NOT NULL REFERENCES merchants(id),
  merchant_principal TEXT NOT NULL,
  subscriber TEXT NOT NULL,
  amount_sats INTEGER NOT NULL CHECK(amount_sats > 0),
  interval_blocks INTEGER NOT NULL CHECK(interval_blocks > 0),
  active INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_billed_at INTEGER,
  next_invoice_at INTEGER NOT NULL,
  last_paid_invoice_id TEXT,
  mode TEXT NOT NULL CHECK(mode IN ('invoice','direct')),
  CHECK(length(id_hex)=64),
  CHECK(id_hex GLOB '[0-9A-Fa-f]*')
);
CREATE INDEX IF NOT EXISTS idx_subs_store_next ON subscriptions(store_id, next_invoice_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_subscriptions_id_hex ON subscriptions(id_hex);

CREATE TABLE IF NOT EXISTS webhook_logs (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL REFERENCES merchants(id),
  invoice_id TEXT,
  subscription_id TEXT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  status_code INTEGER,
  success INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  last_attempt_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhooks_store ON webhook_logs(store_id);
