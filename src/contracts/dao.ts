// src/contracts/dao.ts
import {
  MerchantRow,
  InvoiceRow,
  SubscriptionRow,
  WebhookLogRow,
  InvoiceStatus,
  WebhookEventType,
  SubscriptionMode,
} from '../contracts/domain';

export interface ISqliteStore {
  migrate(): void;

  // Merchants
  findActiveByApiKey(apiKey: string): MerchantRow | undefined;
  insertMerchant(row: MerchantRow): void;
  updateMerchantActive(storeId: string, active: boolean): number;
  updateMerchantKeysTx(storeId: string, apiKey: string, hmacSecret: string): void;
  listMerchantsProjection(): Omit<MerchantRow, 'api_key' | 'hmac_secret'>[];
  rotateKeysPersist(storeId: string, apiKey: string, hmacSecret: string, now: number):number;
  markKeysRevealedOnce(storeId: string, expectVersion: number, now: number):boolean;
  getMerchantById(storeId: string): MerchantRow | undefined;
  getInvoiceStatusByHex(idHex: string): InvoiceStatus | undefined;
  updateMerchantProfile(
    storeId: string,
    patch: Partial<Pick<
      MerchantRow,
      | 'name'
      | 'display_name'
      | 'logo_url'
      | 'brand_color'
      | 'webhook_url'
      | 'support_email'
      | 'support_url'
      | 'allowed_origins'
    >>
  ): void;

  // Invoices
  invoices: {
    insert(row: InvoiceRow): void;
    findByStoreAndIdRaw(storeId: string, idRaw: string): InvoiceRow | undefined;
  };
  getInvoiceById(idRaw: string): InvoiceRow | undefined;
  getInvoiceWithStore(idRaw: string): (InvoiceRow & { store: MerchantRow }) | undefined;
  listInvoicesByStore(
    storeId: string,
    opts?: { status?: InvoiceStatus; orderByCreatedDesc?: boolean },
  ): InvoiceRow[];
  markInvoicePaid(idHex: string, payer: string, txId: string, tx?: unknown): void;
  upsertInvoiceRefund(idHex: string, amountSats: number, refundTxId: string, tx?: unknown): void;
  markInvoiceCanceled(idHexOrIdRaw: string, tx?: unknown): void;
  updateInvoiceStatus(idRaw: string, status: InvoiceStatus, expired?: 0 | 1): void;
  ensureInvoiceIdHexUnique(idHex: string): boolean;
  invoiceExists(idHex: string): boolean;
  bulkMarkExpired(idRawList: string[]): number;
  selectInvoicesByStatuses(
    statuses: InvoiceStatus[],
    limit: number,
    storeId?: string
  ): Pick<InvoiceRow, 'id_hex' | 'status' | 'refund_amount' | 'merchant_principal'>[];

  // Subscriptions
  insertSubscription(row: SubscriptionRow): void;
  getSubscriptionByIdForStore(id: string, storeId: string): SubscriptionRow | undefined;
  getActiveSubscription(id: string, storeId: string): SubscriptionRow | undefined;
  updateSubscriptionMode(id: string, storeId: string, mode: SubscriptionMode): void;
  deactivateSubscription(id: string, storeId: string, tx?: unknown): void;
  setSubscriptionActive(input: { idHex: string; active: 0 | 1 }): void;
  upsertSubscriptionByHex(input: {
    idHex: string;
    storeId: string;
    merchantPrincipal: string;
    subscriber: string;
    amountSats: number;
    intervalBlocks: number;
    active: 1;
  }): void;
  advanceSubscriptionSchedule(id: string): void;
  updateSubscriptionLastPaid(input: { subscriptionId: string; lastPaidInvoiceId: string }): void;
  subscriptionExists(idHex: string): boolean;
  selectDueSubscriptions(currentHeight: number): SubscriptionRow[];
  getStoreIdByPrincipal(merchantPrincipal: string): string | undefined;

  // Webhooks
  insertWebhookAttempt(row: WebhookLogRow): string;
  updateWebhookAttemptStatus(id: string, patch: { success: 0 | 1; statusCode?: number }): void;
  listWebhooksForStore(storeId: string): WebhookLogRow[];
  listAdminWebhooks(storeId?: string, failedOnly?: boolean): WebhookLogRow[];
  getWebhookLogById(id: string): WebhookLogRow | undefined;
  existsSuccessfulDeliveryFor(ctx: {
    storeId: string;
    invoiceId?: string;
    subscriptionId?: string;
    eventType: WebhookEventType;
  }): boolean;
  selectDueWebhookRetries(): WebhookLogRow[];
  getDueWebhookAttempts(nowEpochSecs: number): WebhookLogRow[];

  // Admin queries
  selectAdminInvoices(statuses?: InvoiceStatus[], storeId?: string): InvoiceRow[];

  // Optional cursor persistence
  getPollerCursor():
    | { lastRunAt: number; lastHeight: number; lastTxId?: string; lastBlockHash?: string }
    | null;
  savePollerCursor(cursor: {
    lastRunAt: number;
    lastHeight: number;
    lastTxId?: string;
    lastBlockHash?: string;
  }): void;
}
