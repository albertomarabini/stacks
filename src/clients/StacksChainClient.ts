// src/clients/StacksChainClient.ts

import axios from 'axios';
import { callReadOnlyFunction, bufferCV, cvToJSON } from '@stacks/transactions';
import { StacksMainnet, StacksTestnet, StacksMocknet } from '@stacks/network';
import type { IStacksChainClient, IConfigService } from '../contracts/interfaces';
import type { OnChainSubscription } from '../contracts/domain';
import { ClarityCvAdapter } from '../delegates/ClarityCvAdapter';

type NetworkName = 'mainnet' | 'testnet' | 'devnet';

export class StacksChainClient implements IStacksChainClient {
  private readonly cvAdapter = new ClarityCvAdapter();
  private network: any;
  private contractAddress!: string;
  private contractName!: string;

  constructor(cfg: IConfigService) {
    this.initializeNetwork(cfg);
  }

  initializeNetwork(cfg: IConfigService): void {
    const net = cfg.getNetwork() as NetworkName;
    if (net === 'mainnet') {
      this.network = new StacksMainnet();
    } else if (net === 'testnet') {
      this.network = new StacksTestnet();
    } else {
      this.network = new StacksMocknet();
    }
    const { contractAddress, contractName } = cfg.getContractId();
    this.contractAddress = contractAddress;
    this.contractName = contractName;
  }

  async callReadOnly(functionName: string, functionArgs: any[]): Promise<any> {
    return callReadOnlyFunction({
      contractAddress: this.contractAddress,
      contractName: this.contractName,
      functionName,
      functionArgs,
      network: this.network,
    });
  }

  async readInvoiceStatus(
    idHex: string,
  ): Promise<'not-found' | 'paid' | 'canceled' | 'expired' | 'unpaid'> {
    const idBuf = this.cvAdapter.guardHex32(idHex);
    const cv = await callReadOnlyFunction({
      contractAddress: this.contractAddress,
      contractName: this.contractName,
      functionName: 'get-invoice-status',
      functionArgs: [bufferCV(idBuf)],
      network: this.network,
    });
    const j: any = cvToJSON(cv);
    const val = String(j.value);
    return val as any;
  }

  async readSbtcToken(): Promise<{ contractAddress: string; contractName: string } | undefined> {
    const cv = await callReadOnlyFunction({
      contractAddress: this.contractAddress,
      contractName: this.contractName,
      functionName: 'get-sbtc',
      functionArgs: [],
      network: this.network,
    });
    return this.cvAdapter.decodeOptionalContractPrincipal(cv);
  }

  async readSubscription(idHex: string): Promise<OnChainSubscription | undefined> {
    const idBuf = this.cvAdapter.guardHex32(idHex);
    const cv = await callReadOnlyFunction({
      contractAddress: this.contractAddress,
      contractName: this.contractName,
      functionName: 'get-subscription',
      functionArgs: [bufferCV(idBuf)],
      network: this.network,
    });
    return this.cvAdapter.decodeOptionalSubscriptionTuple(cv, idHex);
  }

  async getTip(): Promise<{ height: number; blockHash: string }> {
    const core = (this.network as any).coreApiUrl as string;
    const infoResp = await axios.get(`${core}/v2/info`);
    const height = Number(infoResp.data?.stacks_tip_height);
    const blkResp = await axios.get(`${core}/extended/v1/block/by_height/${height}`);
    const blockHash = String(blkResp.data?.hash);
    return { height, blockHash };
  }

  async getTipHeight(): Promise<number> {
    const tip = await this.getTip();
    return tip.height;
  }

  async getFungibleBalance(
    assetContract: { contractAddress: string; contractName: string },
    principal: string,
  ): Promise<bigint> {
    const core = (this.network as any).coreApiUrl as string;
    const url = `${core}/extended/v1/address/${encodeURIComponent(principal)}/balances`;
    const resp = await axios.get(url);
    const tokens: Record<string, any> = resp.data?.fungible_tokens ?? {};
    const fqPrefix = `${assetContract.contractAddress}.${assetContract.contractName}::`;
    let balanceStr = '0';
    for (const [key, entry] of Object.entries(tokens)) {
      if (key.startsWith(fqPrefix)) {
        balanceStr = String((entry as any)?.balance ?? '0');
        break;
      }
    }
    return BigInt(balanceStr);
  }

  async getContractCallEvents(params: { fromHeight: number }): Promise<any[]> {
    const core = (this.network as any).coreApiUrl as string;
    const contractId = `${this.contractAddress}.${this.contractName}`;
    const url = `${core}/extended/v1/contract/${contractId}/transactions`;
    const resp = await axios.get(url, { params: { from_height: params.fromHeight } });
    return resp.data?.results ?? [];
  }

  async getBlockHeader(
    height: number,
  ): Promise<{ parent_block_hash: string; block_hash: string }> {
    const core = (this.network as any).coreApiUrl as string;
    const url = `${core}/extended/v1/block/by_height/${height}`;
    const resp = await axios.get(url);
    return {
      parent_block_hash: String(resp.data?.parent_block_hash),
      block_hash: String(resp.data?.hash),
    };
  }

  async isMerchantRegisteredOnChain(_principal: string): Promise<boolean> {
    // Duck-typed helper used by MerchantOnchainSyncPlanner. Returning false ensures planner includes registration call.
    return false;
  }
}
