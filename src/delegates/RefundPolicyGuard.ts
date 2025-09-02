// src/delegates/RefundPolicyGuard.ts
import type { IInvoiceIdCodec } from '../contracts/interfaces';
import { RefundService } from '../services/RefundService';
import type { MerchantRow, InvoiceRow, UnsignedContractCall } from '../contracts/domain';

export class RefundPolicyGuard {
  constructor(private readonly codec: IInvoiceIdCodec, private readonly refund: RefundService) {}

  async enforceAndBuild(
    store: MerchantRow,
    invRow: InvoiceRow,
    amountSats: number,
    memo?: string,
  ): Promise<UnsignedContractCall> {
    if (invRow.status !== 'paid' && invRow.status !== 'partially_refunded') {
      const e: any = new Error('Invoice not refundable in current status');
      e.code = 'bad_status';
      throw e;
    }

    this.codec.assertHex64(invRow.id_hex);

    const alreadyRefunded = invRow.refund_amount ?? 0;
    const proposed = alreadyRefunded + amountSats;
    if (proposed > invRow.amount_sats) {
      const e: any = new Error('Refund cap exceeded');
      e.code = 'cap_violation';
      throw e;
    }

    const hasBalance = await this.refund.precheckBalance(store.principal, amountSats);
    if (!hasBalance) {
      const e: any = new Error('Insufficient sBTC balance');
      e.code = 'insufficient_balance';
      throw e;
    }

    return this.refund.buildRefundPayload(store, invRow, amountSats, memo);
  }
}
