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

  // ───────────────────────────────────────────────────────────────────────────
  // NEW: helper – resolve the configured sBTC token as a contract-principal CV
  // Tries cfg.getSbtcTokenId() or cfg.getTokenContractId(); falls back to env.
  // Throws with a clear message if the token is not configured.
  // ───────────────────────────────────────────────────────────────────────────
  // private tokenContractCv() {
  //   // Try config service first (optional to keep this a non-breaking change)
  //   const anyCfg = this.cfg as unknown as {
  //     getSbtcTokenId?: () => { contractAddress: string; contractName: string } | { address: string; name: string };
  //     getTokenContractId?: () => { contractAddress: string; contractName: string } | { address: string; name: string };
  //   };

  //   let contractAddress: string | undefined =
  //     process.env.SBTC_CONTRACT_ADDRESS || process.env.SBTC_ADDRESS || undefined;
  //   let contractName: string | undefined =
  //     process.env.SBTC_CONTRACT_NAME || process.env.SBTC_NAME || undefined;

  //   if (anyCfg?.getSbtcTokenId) {
  //     const x = anyCfg.getSbtcTokenId();
  //     contractAddress = (x as any).contractAddress ?? (x as any).address ?? contractAddress;
  //     contractName    = (x as any).contractName    ?? (x as any).name    ?? contractName;
  //   } else if (anyCfg?.getTokenContractId) {
  //     const x = anyCfg.getTokenContractId();
  //     contractAddress = (x as any).contractAddress ?? (x as any).address ?? contractAddress;
  //     contractName    = (x as any).contractName    ?? (x as any).name    ?? contractName;
  //   }

  //   if (!contractAddress || !contractName) {
  //     throw new Error(
  //       'sBTC token not configured: missing contract address/name (provide via ConfigService or SBTC_CONTRACT_ADDRESS/SBTC_CONTRACT_NAME env)'
  //     );
  //   }
  //   return contractPrincipalCV(contractAddress, contractName);
  // }

  private tokenContractCv() {
    const contractAddress =
      process.env.SBTC_CONTRACT_ADDRESS ?? process.env.SBTC_ADDRESS ?? '';
    const contractName =
      process.env.SBTC_CONTRACT_NAME ?? process.env.SBTC_NAME ?? '';
    if (!contractAddress || !contractName) {
      throw new Error(
        'sBTC token not configured: set SBTC_CONTRACT_ADDRESS and SBTC_CONTRACT_NAME'
      );
    }
    return contractPrincipalCV(contractAddress, contractName);
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

    const idBuf = this.codec.toBuff32Hex(args.idHex);
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

    const idBuf = this.codec.toBuff32Hex(args.idHex);
    const memoOpt = this.opt34.encodeOptionalUtf8ToBuff34(args.memo);
    const pcs = this.pcc.forRefund(args.merchantPrincipal, args.amountSats);

    // CHANGED: append trait-typed token arg (as contract principal)
    const functionArgs = [bufferCV(idBuf), uintCV(args.amountSats), memoOpt, this.tokenContractCv()];
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

    const idBuf = this.codec.toBuff32Hex(args.idHex);
    const pcs = this.pcc.forPay(args.payerPrincipal, args.merchantPrincipal, args.amountSats);

    // CHANGED: add the missing ft trait arg
    const functionArgs = [bufferCV(idBuf), this.tokenContractCv()];
    return this.baseCall('pay-invoice', functionArgs, pcs);
  }

  buildCancelInvoice(args: { idHex: string }): UnsignedContractCall {
    this.codec.assertHex64(args.idHex);
    const idBuf = this.codec.toBuff32Hex(args.idHex);
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

    const idBuf = this.codec.toBuff32Hex(args.idHex);
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

    const idBuf = this.codec.toBuff32Hex(args.idHex);
    const pcs = this.pcc.forPay(args.subscriber, args.merchant, args.amountSats);

    // CHANGED: add the missing ft trait arg
    const functionArgs = [bufferCV(idBuf), this.tokenContractCv()];
    return this.baseCall('pay-subscription', functionArgs, pcs);
  }

  buildCancelSubscription(args: { idHex: string }): UnsignedContractCall {
    this.codec.assertHex64(args.idHex);
    const idBuf = this.codec.toBuff32Hex(args.idHex);
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
