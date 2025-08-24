// src/delegates/MerchantInputValidator.ts
import { Validation } from '/src/validation/rules';

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

  validateRefundBody(body: any): {
    invoiceId: string;
    amountSats: number;
    memo?: string;
  } {
    const invoiceId = String(body?.invoice_id ?? '');
    if (!Validation.uuid.test(invoiceId)) {
      throw new TypeError('invalid invoice_id');
    }

    const amountSats = Number(body?.amount_sats);
    if (!Number.isInteger(amountSats) || amountSats <= 0) {
      throw new TypeError('invalid amount_sats');
    }

    let memo: string | undefined;
    if (body?.memo !== undefined && body.memo !== null) {
      const str = String(body.memo);
      const buf = Buffer.from(str, 'utf8').subarray(0, Validation.refund.memoMaxUtf8Bytes);
      memo = buf.toString('utf8');
    }

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
