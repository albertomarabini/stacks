// src/contracts/interfaces.ts
import type {
  OnChainSubscription,
  UnsignedContractCall,
  WebhookEventType,
} from './domain';

export interface IStacksChainClient {
  callReadOnly(fn: string, args: any[]): Promise<any>;
  readSbtcToken(): Promise<{ contractAddress: string; contractName: string } | undefined>;
  readSubscription(idHex: string): Promise<OnChainSubscription | undefined>;
  getTip(): Promise<{ height: number; blockHash: string }>;
  getTipHeight(): Promise<number>;
  getFungibleBalance(
    assetContract: { contractAddress: string; contractName: string },
    principal: string,
  ): Promise<bigint>;
  getContractCallEvents(params: { fromHeight: number }): Promise<any[]>;
  getBlockHeader(
    height: number,
  ): Promise<{ parent_block_hash: string; block_hash: string }>;
}

export interface IContractCallBuilder {
  buildCreateInvoice(args: {
    idHex: string;
    amountSats: number;
    memo?: string;
    expiresAtBlock?: number;
  }): UnsignedContractCall;

  buildRefundInvoice(args: {
    idHex: string;
    amountSats: number;
    memo?: string;
    merchantPrincipal: string;
  }): UnsignedContractCall;

  buildPayInvoice(args: {
    idHex: string;
    amountSats: number;
    payerPrincipal: string;
    merchantPrincipal: string;
  }): UnsignedContractCall;

  buildCancelInvoice(args: { idHex: string }): UnsignedContractCall;

  buildCreateSubscription(args: {
    idHex: string;
    merchant: string;
    subscriber: string;
    amountSats: number;
    intervalBlocks: number;
  }): UnsignedContractCall;

  buildPaySubscription(args: {
    idHex: string;
    amountSats: number;
    subscriber: string;
    merchant: string;
  }): UnsignedContractCall;

  buildCancelSubscription(args: { idHex: string }): UnsignedContractCall;

  buildRegisterMerchant(args: { merchant: string; name?: string }): UnsignedContractCall;

  buildSetMerchantActive(args: {
    merchant: string;
    active: boolean;
  }): UnsignedContractCall;

  buildSetSbtcToken(args: {
    contractAddress: string;
    contractName: string;
  }): UnsignedContractCall;

  buildBootstrapAdmin(): UnsignedContractCall;
}

export interface IAssetInfoFactory {
  getSbtcAssetInfo(): {
    contractAddress: string;
    contractName: string;
    assetName: string;
  };
}

export interface IPostConditionFactory {
  forPayInvoice(
    payer: string,
    merchant: string,
    amountSats: number,
    asset: any,
  ): any[];
  forRefund(merchant: string, amountSats: number, asset: any): any[];
}

export interface IInvoiceIdCodec {
  assertHex64(idHex: string): void;
  isValidHex64(idHex: string): boolean;
  toBuff32Hex(idHex: string): Uint8Array;
  hexFromBuff32(buf: Uint8Array): string;
  generateRandomBuff32Hex(): string;
}

export interface IConfigService {
  getNetwork(): 'mainnet' | 'testnet' | 'devnet';
  getContractId(): { contractAddress: string; contractName: string };
  getSbtcContractId():
    | { contractAddress: string; contractName: string }
    | undefined;
  getPollingConfig(): {
    minConfirmations: number;
    reorgWindowBlocks: number;
    pollIntervalSecs: number;
  };
  getAvgBlockSecs(): number;
  getPriceApiUrl(): string | undefined;
  isAutoBroadcastEnabled(): boolean;
}

export interface IWebhookDispatcher {
  dispatch(ctx: {
    storeId: string;
    invoiceId?: string;
    subscriptionId?: string;
    eventType: WebhookEventType;
    rawBody: string;
    attempts?: number;
  }): Promise<void>;
}

export interface IWebhookRetryScheduler {
  enqueueRetry(ctx: {
    storeId: string;
    invoiceId?: string;
    subscriptionId?: string;
    eventType: WebhookEventType;
    rawBody: string;
    attempts: number;
  }): void;
}
