// src/delegates/MerchantInputValidator.ts
import { Validation } from '../validation/rules';

export class MerchantInputValidator {
  validateCreateInvoiceBody(body: any): {
    amountSats: number;
    ttlSeconds: number;
    memo?: string;
    webhookUrl?: string;
  } {
    const amountSats = Number(body?.amount_sats);
    const ttlSeconds = Number(body?.ttl_seconds);

    if (!Number.isInteger(amountSats) || amountSats <= 0) {
      throw new TypeError('amount_sats must be positive int');
    }
    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new TypeError('ttl_seconds must be positive int');
    }

    let memo: string | undefined;
    if (body?.memo !== undefined && body.memo !== null) {
      const str = String(body.memo);
      const buf = Buffer.from(str, 'utf8').subarray(0, Validation.createInvoice.memoMaxUtf8Bytes);
      memo = buf.toString('utf8');
    }

    let webhookUrl: string | undefined;
    if (body?.webhook_url) {
      const url = String(body.webhook_url);
      if (!Validation.url.test(url)) {
        throw new TypeError('invalid webhook_url');
      }
      webhookUrl = url;
    }

    return { amountSats, ttlSeconds, memo, webhookUrl };
  }

  public validateRefundBody(body: Record<string, unknown>): {
    invoiceId: string;
    amountSats: number;
    memo?: string;
  } {
    const b = body || {};

    // accept snake_case or camelCase
    const invoiceId = String(
      (b as any).invoice_id ?? (b as any).invoiceId ?? ''
    ).trim();
    const amountSatsRaw = (b as any).amount_sats ?? (b as any).amountSats;
    const amountSats = Number(amountSatsRaw);

    // same memo handling (limit per Steroids)
    const memoMax = Validation.refund.memoMaxUtf8Bytes;
    let memo: string | undefined;
    if (typeof (b as any).memo === 'string') {
      const enc = new TextEncoder().encode((b as any).memo);
      memo = new TextDecoder().decode(enc.subarray(0, memoMax));
    }

    // current project uses regexes on Validation, not methods
    if (!invoiceId || !Validation.uuid.test(invoiceId)) {
      throw new TypeError('invalid invoice_id');
    }
    if (!Number.isInteger(amountSats) || amountSats <= 0) {
      throw new TypeError('invalid amount_sats');
    }

    // NOTICE: return **camelCase** (controller expects this)
    return { invoiceId, amountSats, memo };
  }


  assertStacksPrincipal(p: string): void {
    if (!Validation.stacksPrincipal.test(p)) {
      throw new TypeError('invalid principal');
    }
  }

  assertPositiveInt(n: number, name: string): void {
    if (!Number.isInteger(n) || n <= 0) {
      throw new TypeError(`${name} must be positive integer`);
    }
  }
}
