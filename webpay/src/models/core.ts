/**
 * Core domain models and DTOs for the Webpay application.
 * Defines and exports all static data structures used across the system.
 * No logic or implementation—types only.
 */

// Store (Admin and Merchant contexts)
export type Store = {
  storeId: string;
  principal: string;
  name: string;
  displayName: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  allowedOrigins: string[];
  webhookUrl: string | null;
  active: boolean;
  sBTCContractAddress?: string | null;
  sBTCContractName?: string | null;
};

// Branding portion embedded in invoice responses (subset of Store)
export type InvoiceStoreBranding = {
  displayName: string | null;
  logoUrl: string | null;
  brandColor: string | null;
};

// FT Postcondition object (inside UnsignedCall)
export type FtPostCondition = {
  type: 'ft-postcondition';
  address: string;
  asset: string;
  condition: 'eq';
  amount: string;
};

// UnsignedCall object (for wallet connect)
export type UnsignedCall = {
  contractId: string;
  function: string;
  args: string[];
  postConditions: FtPostCondition[];
  postConditionMode: 'deny';
  network: 'mainnet' | 'testnet';
};

// Magic-link U blob (base64url-encoded JSON, validated)
export type MagicLinkU = {
  v: 1;
  storeId: string;
  invoiceId?: string;
  subscriptionId?: string;
  unsignedCall: UnsignedCall;
  exp: number;
  sig: string;
};

// Invoice DTO (Bridge API public interface)
export type Invoice = {
  invoiceId: string;
  idHex: string;
  storeId: string;
  amountSats: number;
  usdAtCreate: string;
  quoteExpiresAt: string;
  merchantPrincipal: string;
  memo: string;
  status: 'unpaid' | 'pending' | 'paid' | 'expired' | 'canceled' | 'PAY_READY';
  payer?: string;
  txId?: string;
  subscriptionId?: string;
  createdAt: string;
  refundAmount?: number;
  refundTxId?: string;
  store: InvoiceStoreBranding;
};

// MagicLinkDTO (surface by Bridge API and used by all flows)
export type MagicLinkDTO = {
  invoice: Invoice;
  magicLink: string;
  unsignedCall: UnsignedCall;
};

// Linked invoice for a subscription
export type SubscriptionLinkedInvoice = {
  invoiceId: string;
  status: 'unpaid' | 'pending' | 'paid' | 'expired' | 'canceled';
  createdAt: string;
  quoteExpiresAt: string;
  amountSats: number;
};

// Subscription DTO
export type Subscription = {
  subscriptionId: string;
  storeId: string;
  subscriberPrincipal: string;
  amountSats: number;
  intervalBlocks: number;
  status: 'active' | 'cancelled';
  nextDue: string;
  lastBilled?: string;
  mode: 'invoice';
  createdAt: string;
  linkedInvoices: SubscriptionLinkedInvoice[];
};

// Refund DTO (for refund actions)
export type RefundRequest = {
  invoiceId: string;
  amount_sats: number;
  memo: string;
};

// Branding/Public Profile DTO (fetched for theming, emails, etc)
export type PublicProfile = {
  displayName: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  supportEmail: string | null;
  supportUrl: string | null;
};

// Key material for store (stored only server-side, one-time reveal)
export type StoreSecrets = {
  apiKey: string;
  hmacSecret: string;
};

// WebhookLog DTO
export type WebhookLog = {
  webhookLogId: string;
  storeId: string;
  status: 'delivered' | 'failed' | 'pending';
  payload: object;
  headers: object;
  deliveredAt: string | null;
  failedAt: string | null;
  attemptCount: number;
};

// Poller status DTO
export type PollerStatus = {
  running: boolean;
  lastRunAt: string;
  lastHeight: number;
  lastTxId: string;
  lagBlocks: number;
};
