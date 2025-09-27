// src/contracts/domain.ts

// Enums
export type InvoiceStatus =
  | 'unpaid'
  | 'paid'
  | 'partially_refunded'
  | 'refunded'
  | 'canceled'
  | 'expired';

export type WebhookEventType =
  | 'paid'
  | 'refunded'
  | 'subscription'
  | 'subscription-created'
  | 'subscription-paid'
  | 'subscription-canceled'
  | 'invoice-expired'
  | 'invoice-canceled';

export type SubscriptionMode = 'invoice' | 'direct';

// On-chain mirrors (read-only DTOs)
export interface OnChainInvoice {
  idHex: string; // 64-hex for (buff 32)
  merchant: string; // principal
  amountSats: bigint;
  memo?: string; // ≤34 bytes utf8
  expiresAt?: bigint; // block height
  paid: boolean;
  canceled: boolean;
  refundAmountSats: bigint;
  payer?: string; // principal
}

export interface OnChainSubscription {
  idHex: string; // 64-hex
  merchant: string;
  subscriber: string;
  amountSats: bigint;
  intervalBlocks: bigint;
  active: boolean;
  nextDue: bigint;
  lastPaid?: bigint;
}

export interface OnChainAdminState {
  admin?: string; // principal
  sbtcToken?: { contractAddress: string; contractName: string };
}

// SQLite rows (snake_case)
export interface MerchantRow {
  id: string;
  principal: string;
  name?: string;
  display_name?: string;
  logo_url?: string;
  brand_color?: string;
  webhook_url?: string;
  hmac_secret: string;
  api_key: string;
  active: number;              // 0/1
  support_email?: string;
  support_url?: string;
  allowed_origins?: string;    // CSV
  created_at: number;          // seconds

  // new rotation columns (persisted “shown once” guard)
  keys_rotation_version: number;       // NOT NULL DEFAULT 0
  keys_last_rotated_at?: number | null;
  keys_last_revealed_at?: number | null;
  keys_dual_valid_until?: number | null;
}

export interface InvoiceRow {
  id_raw: string;
  id_hex: string; // 64-hex, CHECK enforced
  store_id: string;
  amount_sats: number;
  usd_at_create: number;
  quote_expires_at: number; // ms
  merchant_principal: string;
  status: InvoiceStatus;
  payer?: string;
  txid?: string;
  memo?: string;
  webhook_url?: string;
  created_at: number; // seconds
  refunded_at?: number;
  refund_amount: number;
  refund_txid?: string;
  subscription_id?: string;
  refund_count: number;
  expired: number; // 0/1
}

export interface SubscriptionRow {
  id: string;
  id_hex: string; // 64-hex
  store_id: string;
  merchant_principal: string;
  subscriber: string;
  amount_sats: number;
  interval_blocks: number;
  active: number; // 0/1
  created_at: number;
  last_billed_at?: number;
  next_invoice_at: number; // block height
  last_paid_invoice_id?: string;
  mode: SubscriptionMode;
}

export interface WebhookLogRow {
  id: string;
  store_id: string;
  invoice_id?: string;
  subscription_id?: string;
  event_type: WebhookEventType;
  payload: string; // raw JSON
  status_code?: number;
  success: number; // 0/1
  attempts: number;
  last_attempt_at: number; // seconds
}

// Public DTOs (camelCase)
export interface PublicInvoiceDTO {
  invoiceId: string;
  idHex: string;
  storeId: string;
  amountSats: number;
  usdAtCreate: number;
  quoteExpiresAt: number; // ms
  merchantPrincipal: string;
  status: InvoiceStatus;
  payer?: string;
  txId?: string;
  memo?: string;
  subscriptionId?: string;
  createdAt: number; // seconds
  refundAmount?: number;
  refundTxId?: string;
  store?: StorePublicProfileDTO;
}

export interface StorePublicProfileDTO {
  displayName: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  supportEmail: string | null;
  supportUrl: string | null;
}

export interface StorePrivateProfileDTO extends StorePublicProfileDTO {
  id: string;
  name?: string;
  webhookUrl?: string;
  allowedOrigins: string[];
  principal: string;
  active: boolean;
}

export interface AdminPollerStatusDTO {
  running: boolean;
  lastRunAt?: number;
  lastHeight?: number;
  lastTxId?: string;
  lastBlockHash?: string;
  lagBlocks?: number;
}

// Unsigned contract-call payload
export interface UnsignedContractCall {
  contractAddress: string;
  contractName: string;
  functionName: string;
  functionArgs: any[]; // Clarity CV descriptors
  postConditionMode?: 'deny' | 'allow';
  postConditions?: any[];
  anchorMode?: 'any' | 'onChainOnly' | 'offChainOnly';
  network: 'mainnet' | 'testnet' | 'devnet';
}

// Poller telemetry
export interface PollerMetrics {
  running: boolean;
  lastRunAt?: number;
  lastHeight?: number;
  lastTxId?: string;
  lastBlockHash?: string;
  lagBlocks?: number;
}

// Normalized chain event (for internal processing)
export type NormalizedEventType =
  | 'invoice-paid'
  | 'refund-invoice'
  | 'invoice-canceled'
  | 'create-subscription'
  | 'cancel-subscription'
  | 'pay-subscription';

export interface NormalizedEvent {
  type: NormalizedEventType;
  idHex: string;
  block_height: number;
  tx_id: string;
  tx_index: number;
  sender?: string;
  merchantPrincipal?: string;
  subscriber?: string;
  amountSats?: number;
  intervalBlocks?: number;
  refundAmountSats?: number;
}

// Outbound webhook payloads (camelCase JSON)
export type InvoicePaidEvent = {
  invoiceId: string;
  status: 'paid';
  txId: string;
  payer: string;
  amountSats: number;
};

export type InvoiceRefundedEvent = {
  invoiceId: string;
  status: 'refunded';
  refundTxId: string;
  refundAmount: number;
};

export type SubscriptionInvoiceCreatedEvent = {
  subscriptionId: string;
  invoiceId: string;
  amountSats: number;
  nextDue: number;
  subscriber: string;
};

export type SubscriptionCreatedEvent = {
  subscriptionId: string;
  merchant: string;
  subscriber: string;
  amountSats: number;
  intervalBlocks: number;
  nextDue: number;
};

export type SubscriptionPaidEvent = {
  subscriptionId: string;
  subscriber: string;
  amountSats: number;
  txId: string;
  nextDue: number;
};

export type SubscriptionCanceledEvent = {
  subscriptionId: string;
};

export type InvoiceExpiredEvent = {
  invoiceId: string;
  status: 'expired';
};

export type InvoiceCanceledEvent = {
  invoiceId: string;
};
