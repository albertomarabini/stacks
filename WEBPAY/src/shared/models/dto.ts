/**
 * /src/shared/models/dto.ts
 *
 * Canonical source for all TypeScript DTO and contract type definitions used throughout the system.
 * Imported by both server and client (SSR controllers, islands, services, etc).
 * Pure types only—no runtime logic or instantiation.
 */

// Branding object (used in SSR templates and theming)
export type Branding = {
  displayName: string;
  logoUrl?: string | null;
  brandColor?: string | null;
  supportEmail?: string | null;
  supportUrl?: string | null;
  // Optionally, admin/merchant may inject .active and .deactivationReason for SSR context
  active?: boolean;
  principal?: string | null;
};

// Invoice Data Transfer Object (DTO)
export type InvoiceDTO = {
  invoiceId: string;
  storeId: string;
  status: 'unpaid' | 'paid' | 'partially_refunded' | 'refunded' | 'canceled' | 'expired';
  amountSats: number;
  usdAtCreate?: string;
  quoteExpiresAt?: string; // ISO 8601
  merchantPrincipal?: string;
  payer?: string | null;
  txId?: string | null;
  memo?: string | null;
  subscriptionId?: string | null;
  createdAt?: string;
  refundAmount?: number | null;
  refundTxId?: string | null;
  store?: Pick<Branding, 'displayName' | 'logoUrl' | 'brandColor'>;
};

// Magic-link view props for SSR
export type MagicLinkViewProps = {
  branding: Branding;
  invoice: Pick<InvoiceDTO, 'invoiceId' | 'amountSats' | 'usdAtCreate' | 'quoteExpiresAt' | 'memo'>;
  magicLink: string;
  returnUrl?: string | null;
  hydration: {
    invoiceId: string;
    magicLink: string;
    returnUrl?: string | null;
    connectConfig?: Record<string, unknown>;
  };
  deactivationReason?: string | null;
};

// Invoice SSR view props
export type InvoiceViewProps = {
  branding: Branding;
  invoice: InvoiceDTO;
  hydration: { invoiceId: string };
};

// Merchant shell props (SSR context)
export type MerchantShellProps = {
  branding: Branding;
  nav: string;
  user: { name?: string; email?: string };
};

// Magic-link payload decoded from `u` blob
export type MagicLinkPayload = {
  v: 1;
  storeId: string;
  invoiceId: string;
  unsignedCall: {
    contractId: string;
    function: "pay-invoice";
    args: string[];
    postConditions: Array<{
      type: "ft-postcondition";
      address: string;
      asset: string;
      condition: "eq";
      amount: string;
    }>;
    postConditionMode: "deny";
    network: "mainnet" | "testnet";
  };
  exp: number; // epoch seconds
  sig: string; // base64url HMAC-SHA256
};

// Subscription DTO
export type SubscriptionDTO = {
  subscriptionId: string;
  storeId: string;
  status: "active" | "cancelled";
  amountSats: number;
  intervalBlocks: number;
  subscriberPrincipal: string;
  nextDue: string; // ISO 8601
  lastBilled?: string;
  mode: "invoice";
};

// Session data for express-session
export type SessionData = {
  userId?: string;
  storeId?: string;
  adminUser?: { id: string; name?: string; email?: string };
  apiKeyReveal?: { apiKey: string; hmacSecret: string; revealed: boolean };
};

// Hydration objects (SSR → client islands)
export type HydrationMagicLink = {
  invoiceId: string;
  magicLink: string;
  returnUrl?: string | null;
  connectConfig?: Record<string, unknown>;
};

export type HydrationInvoice = {
  invoiceId: string;
};

export type HydrationPOS = {
  storeId: string;
  // Optionally add: defaultTtlSeconds?: number; defaultAmountSats?: number;
};
