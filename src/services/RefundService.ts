// src/services/RefundService.ts
import type {
  IStacksChainClient,
  IContractCallBuilder,
  IPostConditionFactory,
  IAssetInfoFactory,
  IInvoiceIdCodec,
  IConfigService,
} from '../contracts/interfaces';
import type {
  UnsignedContractCall,
  MerchantRow,
  InvoiceRow,
} from '../contracts/domain';

export class RefundService {
  private chain!: IStacksChainClient;
  private builder!: IContractCallBuilder;
  private pcf!: IPostConditionFactory;
  private aif!: IAssetInfoFactory;
  private codec!: IInvoiceIdCodec;
  private cfg!: IConfigService;

  bindDependencies(deps: {
    chain: IStacksChainClient;
    builder: IContractCallBuilder;
    pcf: IPostConditionFactory;
    aif: IAssetInfoFactory;
    codec: IInvoiceIdCodec;
    cfg: IConfigService;
  }): void {
    this.chain = deps.chain;
    this.builder = deps.builder;
    this.pcf = deps.pcf;
    this.aif = deps.aif;
    this.codec = deps.codec;
    this.cfg = deps.cfg;
  }

  async precheckBalance(merchantPrincipal: string, amountSats: number): Promise<boolean> {
    const token = this.cfg.getSbtcContractId();
    if (!token) return false;
    const bal = await this.chain.getFungibleBalance(token, merchantPrincipal);
    return bal >= BigInt(amountSats);
  }

  async buildRefundPayload(
    store: MerchantRow,
    invoice: InvoiceRow,
    amountSats: number,
    memo?: string,
  ): Promise<UnsignedContractCall> {
    if (!(invoice.status === 'paid' || invoice.status === 'partially_refunded')) {
      throw new Error('not_refundable');
    }

    this.codec.assertHex64(invoice.id_hex);

    const alreadyRefunded = Number(invoice.refund_amount ?? 0);
    const newTotal = alreadyRefunded + Number(amountSats);
    if (newTotal > Number(invoice.amount_sats)) {
      throw new Error('refund_cap_exceeded');
    }

    const payload = this.builder.buildRefundInvoice({
      idHex: invoice.id_hex,
      amountSats,
      memo,
      merchantPrincipal: store.principal,
    });

    return payload;
  }
}

export default RefundService;
