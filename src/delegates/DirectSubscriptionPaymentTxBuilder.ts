// src/delegates/DirectSubscriptionPaymentTxBuilder.ts
import type { IStacksChainClient, IContractCallBuilder, IInvoiceIdCodec } from '/src/contracts/interfaces';
import type { SubscriptionRow, UnsignedContractCall } from '/src/contracts/domain';

export class DirectSubscriptionPaymentTxBuilder {
  constructor(
    private readonly chain: IStacksChainClient,
    private readonly builder: IContractCallBuilder,
    private readonly codec: IInvoiceIdCodec
  ) {}

  async assemble(
    sub: SubscriptionRow,
    payerPrincipal: string,
    merchantPrincipal: string
  ): Promise<UnsignedContractCall> {
    if (sub.active !== 1 || sub.mode !== 'direct') {
      const e: any = new Error('Subscription not payable in direct mode');
      e.code = 'bad_status';
      throw e;
    }

    this.codec.assertHex64(sub.id_hex);

    if (payerPrincipal !== sub.subscriber) {
      const e: any = new Error('Payer must equal subscriber');
      e.code = 'invalid_payer';
      throw e;
    }

    const tip = await this.chain.getTip();
    if (tip.height < sub.next_invoice_at) {
      const e: any = new Error('Current height below next invoice at');
      e.code = 'too_early';
      throw e;
    }

    const token = await this.chain.readSbtcToken();
    if (!token) {
      const e: any = new Error('sBTC token not set');
      e.code = 'missing_token';
      throw e;
    }

    return this.builder.buildPaySubscription({
      idHex: sub.id_hex,
      amountSats: sub.amount_sats,
      subscriber: payerPrincipal,
      merchant: merchantPrincipal,
    });
  }
}
