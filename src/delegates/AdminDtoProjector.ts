// src/delegates/AdminDtoProjector.ts
import type { MerchantRow, InvoiceRow, WebhookLogRow } from '../contracts/domain';

export type MerchantProjectionRow = Omit<MerchantRow, 'stx_private_key' | 'hmac_secret'>;

export type MerchantDto = {
  id: string;
  principal: string;
  name?: string;
  displayName?: string;
  logoUrl?: string;
  brandColor?: string;
  webhookUrl?: string;
  active: boolean;
  supportEmail?: string;
  supportUrl?: string;
  allowedOrigins?: string;
  createdAt: number;
};

export type AdminInvoiceDto = {
  idRaw: string;
  idHex: string;
  storeId: string;
  amountSats: number;
  usdAtCreate: number;
  quoteExpiresAt: number;
  merchantPrincipal: string;
  status: string;
  payer?: string;
  txId?: string;
  memo?: string;
  webhookUrl?: string;
  createdAt: number;
  refundedAt?: number;
  refundAmount: number;
  refundTxId?: string;
  subscriptionId?: string;
  refundCount: number;
  expired: number;
};

export type AdminWebhookDto = {
  id: string;
  storeId: string;
  invoiceId?: string;
  subscriptionId?: string;
  eventType: string;
  payload: string;
  statusCode?: number;
  success: boolean;
  attempts: number;
  lastAttemptAt: number;
};

export class AdminDtoProjector {
  merchantToDto(r: MerchantProjectionRow): MerchantDto {
    return {
      id: r.id,
      principal: r.principal,
      name: r.name ?? undefined,
      displayName: r.display_name ?? undefined,
      logoUrl: r.logo_url ?? undefined,
      brandColor: r.brand_color ?? undefined,
      webhookUrl: r.webhook_url ?? undefined,
      active: !!r.active,
      supportEmail: r.support_email ?? undefined,
      supportUrl: r.support_url ?? undefined,
      allowedOrigins: r.allowed_origins ?? undefined,
      createdAt: r.created_at,
    };
  }

  invoiceToDto(r: InvoiceRow): AdminInvoiceDto {
    return {
      idRaw: r.id_raw,
      idHex: r.id_hex,
      storeId: r.store_id,
      amountSats: r.amount_sats,
      usdAtCreate: r.usd_at_create,
      quoteExpiresAt: r.quote_expires_at,
      merchantPrincipal: r.merchant_principal,
      status: r.status,
      payer: r.payer ?? undefined,
      txId: r.txid ?? undefined,
      memo: r.memo ?? undefined,
      webhookUrl: r.webhook_url ?? undefined,
      createdAt: r.created_at,
      refundedAt: r.refunded_at ?? undefined,
      refundAmount: r.refund_amount,
      refundTxId: r.refund_txid ?? undefined,
      subscriptionId: r.subscription_id ?? undefined,
      refundCount: r.refund_count,
      expired: r.expired,
    };
  }

  webhookToDto(w: WebhookLogRow): AdminWebhookDto {
    return {
      id: w.id,
      storeId: w.store_id,
      invoiceId: w.invoice_id ?? undefined,
      subscriptionId: w.subscription_id ?? undefined,
      eventType: w.event_type,
      payload: w.payload,
      statusCode: w.status_code ?? undefined,
      success: !!w.success,
      attempts: w.attempts,
      lastAttemptAt: w.last_attempt_at,
    };
  }
}
