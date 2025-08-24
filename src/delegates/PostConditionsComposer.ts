// src/delegates/PostConditionsComposer.ts
import type { IAssetInfoFactory, IPostConditionFactory } from '../contracts/interfaces';

export class PostConditionsComposer {
  constructor(
    private aif: IAssetInfoFactory,
    private pcf: IPostConditionFactory
  ) {}

  forRefund(
    merchantPrincipal: string,
    amountSats: number
  ): { postConditionMode: 'deny'; postConditions: any[] } {
    const asset = this.aif.getSbtcAssetInfo();
    const postConditions = this.pcf.forRefund(merchantPrincipal, amountSats, asset);
    return {
      postConditionMode: 'deny',
      postConditions,
    };
  }

  forPay(
    payerPrincipal: string,
    merchantPrincipal: string,
    amountSats: number
  ): { postConditionMode: 'deny'; postConditions: any[] } {
    const asset = this.aif.getSbtcAssetInfo();
    const postConditions = this.pcf.forPayInvoice(payerPrincipal, merchantPrincipal, amountSats, asset);
    return {
      postConditionMode: 'deny',
      postConditions,
    };
  }
}
