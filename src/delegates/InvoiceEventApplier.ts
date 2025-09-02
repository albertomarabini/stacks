// src/delegates/InvoiceEventApplier.ts
import type { ISqliteStore } from '../contracts/dao';
import type { IWebhookDispatcher } from '../contracts/interfaces';
import type { NormalizedEvent, InvoiceStatus } from '../contracts/domain';

export class InvoiceEventApplier {
  constructor(private store: ISqliteStore, private dispatcher: IWebhookDispatcher) {}

  async handlePaid(e: NormalizedEvent): Promise<void> {
    this.store.markInvoicePaid(e.idHex, e.sender!, e.tx_id);

    const rows = this.store.selectAdminInvoices(['paid'] as InvoiceStatus[]);
    const row = rows.find((r) => r.id_hex === e.idHex)!;

    const rawBody = JSON.stringify({
      invoiceId: row.id_raw,
      status: 'paid' as const,
      txId: e.tx_id,
      payer: e.sender!,
      amountSats: row.amount_sats,
    });

    await this.dispatcher.dispatch({
      storeId: row.store_id,
      invoiceId: row.id_raw,
      eventType: 'paid',
      rawBody,
    });
  }

  async handleRefund(e: NormalizedEvent): Promise<void> {
    const refundAmount = e.refundAmountSats!;
    this.store.upsertInvoiceRefund(e.idHex, refundAmount, e.tx_id);

    const rows = this.store.selectAdminInvoices(
      ['refunded', 'partially_refunded', 'paid'] as InvoiceStatus[],
    );
    const row = rows.find((r) => r.id_hex === e.idHex)!;

    const rawBody = JSON.stringify({
      invoiceId: row.id_raw,
      status: 'refunded' as const,
      refundTxId: e.tx_id,
      refundAmount: refundAmount,
    });

    await this.dispatcher.dispatch({
      storeId: row.store_id,
      invoiceId: row.id_raw,
      eventType: 'refunded',
      rawBody,
    });
  }

  async handleCanceled(e: NormalizedEvent): Promise<void> {
    this.store.markInvoiceCanceled(e.idHex);

    const rows = this.store.selectAdminInvoices(['canceled'] as InvoiceStatus[]);
    const row = rows.find((r) => r.id_hex === e.idHex)!;

    const rawBody = JSON.stringify({
      invoiceId: row.id_raw,
    });

    await this.dispatcher.dispatch({
      storeId: row.store_id,
      invoiceId: row.id_raw,
      eventType: 'invoice-canceled',
      rawBody,
    });
  }
}
