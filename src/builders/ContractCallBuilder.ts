// src/builders/ContractCallBuilder.ts
import type {
  IContractCallBuilder,
  IConfigService,
  IAssetInfoFactory,
  IPostConditionFactory,
  IInvoiceIdCodec,
} from '../contracts/interfaces';
import type { UnsignedContractCall } from '../contracts/domain';
import { PostConditionsComposer } from '../delegates/PostConditionsComposer';
import { OptionalBuff34Encoder } from '../delegates/OptionalBuff34Encoder';
import { Buffer } from 'buffer';
import {
  bufferCV,
  uintCV,
  standardPrincipalCV,
  contractPrincipalCV,
  someCV,
  noneCV,
  trueCV,
  falseCV,
} from '@stacks/transactions';

export class ContractCallBuilder implements IContractCallBuilder {
  private readonly cfg: IConfigService;
  private readonly aif: IAssetInfoFactory;
  private readonly pcf: IPostConditionFactory;
  private readonly codec: IInvoiceIdCodec;

  private readonly pcc: PostConditionsComposer;
  private readonly opt34: OptionalBuff34Encoder;

  constructor(
    cfg: IConfigService,
    aif: IAssetInfoFactory,
    pcf: IPostConditionFactory,
    codec: IInvoiceIdCodec
  ) {
    this.cfg = cfg;
    this.aif = aif;
    this.pcf = pcf;
    this.codec = codec;
    this.pcc = new PostConditionsComposer(this.aif, this.pcf);
    this.opt34 = new OptionalBuff34Encoder();
  }

  buildCreateInvoice(args: {
    idHex: string;
    amountSats: number;
    memo?: string;
    expiresAtBlock?: number;
  }): UnsignedContractCall {
    this.codec.assertHex64(args.idHex);
    this.assertPositiveInt(args.amountSats, 'amountSats');
    if (args.expiresAtBlock !== undefined) {
      this.assertNonNegativeInt(args.expiresAtBlock, 'expiresAtBlock');
    }

  const idBufArr = this.codec.toBuff32Hex(args.idHex);
  const idBuf = Buffer.from(idBufArr);
    const memoOpt = this.opt34.encodeOptionalUtf8ToBuff34(args.memo);

    const functionArgs = [
      bufferCV(idBuf),
      uintCV(args.amountSats),
      memoOpt,
      args.expiresAtBlock !== undefined ? someCV(uintCV(args.expiresAtBlock)) : noneCV(),
    ];

    return this.baseCall('create-invoice', functionArgs);
  }

  buildRefundInvoice(args: {
    idHex: string;
    amountSats: number;
    memo?: string;
    merchantPrincipal: string;
  }): UnsignedContractCall {
    this.codec.assertHex64(args.idHex);
    this.assertPositiveInt(args.amountSats, 'amountSats');
    // principal validation by CV construction
    void standardPrincipalCV(args.merchantPrincipal);

  const idBufArr = this.codec.toBuff32Hex(args.idHex);
  const idBuf = Buffer.from(idBufArr);
    const memoOpt = this.opt34.encodeOptionalUtf8ToBuff34(args.memo);
    const pcs = this.pcc.forRefund(args.merchantPrincipal, args.amountSats);

    const functionArgs = [bufferCV(idBuf), uintCV(args.amountSats), memoOpt];
    return this.baseCall('refund-invoice', functionArgs, pcs);
  }

  buildPayInvoice(args: {
    idHex: string;
    amountSats: number;
    payerPrincipal: string;
    merchantPrincipal: string;
  }): UnsignedContractCall {
    this.codec.assertHex64(args.idHex);
    this.assertPositiveInt(args.amountSats, 'amountSats');
    void standardPrincipalCV(args.payerPrincipal);
    void standardPrincipalCV(args.merchantPrincipal);

  const idBufArr = this.codec.toBuff32Hex(args.idHex);
  const idBuf = Buffer.from(idBufArr);
    const pcs = this.pcc.forPay(args.payerPrincipal, args.merchantPrincipal, args.amountSats);
    const functionArgs = [bufferCV(idBuf)];
    return this.baseCall('pay-invoice', functionArgs, pcs);
  }

  buildCancelInvoice(args: { idHex: string }): UnsignedContractCall {
    this.codec.assertHex64(args.idHex);
  const idBufArr = this.codec.toBuff32Hex(args.idHex);
  const idBuf = Buffer.from(idBufArr);
  const functionArgs = [bufferCV(idBuf)];
    return this.baseCall('cancel-invoice', functionArgs);
  }

  buildCreateSubscription(args: {
    idHex: string;
    merchant: string;
    subscriber: string;
    amountSats: number;
    intervalBlocks: number;
  }): UnsignedContractCall {
    this.codec.assertHex64(args.idHex);
    void standardPrincipalCV(args.merchant);
    void standardPrincipalCV(args.subscriber);
    this.assertPositiveInt(args.amountSats, 'amountSats');
    this.assertPositiveInt(args.intervalBlocks, 'intervalBlocks');

  const idBufArr = this.codec.toBuff32Hex(args.idHex);
  const idBuf = Buffer.from(idBufArr);
    const functionArgs = [
      bufferCV(idBuf),
      standardPrincipalCV(args.merchant),
      standardPrincipalCV(args.subscriber),
      uintCV(args.amountSats),
      uintCV(args.intervalBlocks),
    ];
    return this.baseCall('create-subscription', functionArgs);
  }

  buildPaySubscription(args: {
    idHex: string;
    amountSats: number;
    subscriber: string;
    merchant: string;
  }): UnsignedContractCall {
    this.codec.assertHex64(args.idHex);
    this.assertPositiveInt(args.amountSats, 'amountSats');
    void standardPrincipalCV(args.subscriber);
    void standardPrincipalCV(args.merchant);

  const idBufArr = this.codec.toBuff32Hex(args.idHex);
  const idBuf = Buffer.from(idBufArr);
  const pcs = this.pcc.forPay(args.subscriber, args.merchant, args.amountSats);
  const functionArgs = [bufferCV(idBuf)];
    return this.baseCall('pay-subscription', functionArgs, pcs);
  }

  buildCancelSubscription(args: { idHex: string }): UnsignedContractCall {
    this.codec.assertHex64(args.idHex);
  const idBufArr = this.codec.toBuff32Hex(args.idHex);
  const idBuf = Buffer.from(idBufArr);
  const functionArgs = [bufferCV(idBuf)];
    return this.baseCall('cancel-subscription', functionArgs);
  }

  buildRegisterMerchant(args: { merchant: string; name?: string }): UnsignedContractCall {
    const merchantCv = standardPrincipalCV(args.merchant);
    const nameOpt = this.opt34.encodeOptionalUtf8ToBuff34(args.name);
    const functionArgs = [merchantCv, nameOpt];
    return this.baseCall('register-merchant', functionArgs);
  }

  buildSetMerchantActive(args: { merchant: string; active: boolean }): UnsignedContractCall {
    const merchantCv = standardPrincipalCV(args.merchant);
    const activeCv = args.active ? trueCV() : falseCV();
    const functionArgs = [merchantCv, activeCv];
    return this.baseCall('set-merchant-active', functionArgs);
  }

  buildSetSbtcToken(args: {
    contractAddress: string;
    contractName: string;
  }): UnsignedContractCall {
    const cp = contractPrincipalCV(args.contractAddress, args.contractName);
    const functionArgs = [cp];
    return this.baseCall('set-sbtc-token', functionArgs);
  }

  buildBootstrapAdmin(): UnsignedContractCall {
    return this.baseCall('bootstrap-admin', []);
  }

  private baseCall(
    functionName: string,
    functionArgs: any[],
    pcs?: { postConditionMode: 'deny'; postConditions: any[] }
  ): UnsignedContractCall {
    const { contractAddress, contractName } = this.cfg.getContractId();
    const base: UnsignedContractCall = {
      contractAddress,
      contractName,
      functionName,
      functionArgs,
      network: this.cfg.getNetwork(),
      anchorMode: 'any',
    };
    if (pcs) {
      base.postConditionMode = pcs.postConditionMode;
      base.postConditions = pcs.postConditions;
    }
    return base;
  }

  private assertPositiveInt(n: number, name: string): void {
    if (!Number.isInteger(n) || n <= 0) {
      throw new TypeError(`${name} must be a positive integer`);
    }
  }

  private assertNonNegativeInt(n: number, name: string): void {
    if (!Number.isInteger(n) || n < 0) {
      throw new TypeError(`${name} must be a non-negative integer`);
    }
  }
}
