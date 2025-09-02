// src/delegates/ApiCaseAndDtoMapper.ts
import type {
  InvoiceRow,
  WebhookLogRow,
  MerchantRow,
  PublicInvoiceDTO,
  StorePrivateProfileDTO,
} from '../contracts/domain';


export class ApiCaseAndDtoMapper {
  invoiceToPublicDto(r: InvoiceRow): PublicInvoiceDTO {
    return {
      invoiceId: r.id_raw,
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
      subscriptionId: r.subscription_id ?? undefined,
      createdAt: r.created_at,
      refundAmount: r.refund_amount ?? undefined,
      refundTxId: r.refund_txid ?? undefined,
      store: undefined,
    };
  }

  webhookToDto(w: WebhookLogRow): {
    id: string;
    storeId: string;
    invoiceId?: string | null;
    subscriptionId?: string | null;
    eventType: string;
    payload: string;
    statusCode: number | null;
    success: boolean;
    attempts: number;
    lastAttemptAt: number | null;
  } {
    return {
      id: w.id,
      storeId: w.store_id,
      invoiceId: w.invoice_id ?? null,
      subscriptionId: w.subscription_id ?? null,
      eventType: w.event_type,
      payload: w.payload,
      statusCode: w.status_code ?? null,
      success: w.success === 1,
      attempts: w.attempts,
      lastAttemptAt: w.last_attempt_at ?? null,
    };
  }

  storeToPrivateProfile(row: MerchantRow): StorePrivateProfileDTO {
    return {
      id: row.id,
      name: row.name ?? undefined,
      displayName: row.display_name ?? null,
      logoUrl: row.logo_url ?? null,
      brandColor: row.brand_color ?? null,
      webhookUrl: row.webhook_url ?? undefined,
      supportEmail: row.support_email ?? null,
      supportUrl: row.support_url ?? null,
      allowedOrigins: row.allowed_origins
        ? row.allowed_origins
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      principal: row.principal,
      active: !!row.active,
    };
  }

  toCamel<T = any>(input: any): T {
    if (input === null || typeof input !== 'object') return input as T;
    if (Array.isArray(input)) return input.map((v) => this.toCamel(v)) as any;
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(input)) {
      const camel = k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
      out[camel] = this.toCamel(v);
    }
    return out as T;
  }

  toSnake<T extends Record<string, any> = Record<string, any>>(input: any): T {
    if (input === null || typeof input !== 'object') return input as T;
    if (Array.isArray(input)) return input.map((v) => this.toSnake(v)) as any;
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(input)) {
      const snake = k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      out[snake] = this.toSnake(v);
    }
    return out as T;
  }
}
