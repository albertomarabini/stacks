// src/clients/StacksChainClient.ts

import axios from 'axios';
import { fetchCallReadOnlyFunction as callReadOnlyFunction, bufferCV, cvToJSON } from '@stacks/transactions';
import type { IStacksChainClient, IConfigService } from '../contracts/interfaces';
import type { OnChainSubscription } from '../contracts/domain';
import { ClarityCvAdapter } from '../delegates/ClarityCvAdapter';

type NetworkName = 'mainnet' | 'testnet' | 'devnet' | 'mocknet';

export class StacksChainClient implements IStacksChainClient {
  private readonly cvAdapter = new ClarityCvAdapter();

  // v7: use simple network name + baseUrl (client), not @stacks/network classes
  private network!: NetworkName;
  private baseUrl!: string;

  private contractAddress!: string;
  private contractName!: string;

  constructor(cfg: IConfigService) {
    this.initializeNetwork(cfg);
  }

  initializeNetwork(cfg: IConfigService): void {
    const net = (cfg.getNetwork() as NetworkName) ?? 'testnet';
    const customApiUrl =
      // prefer config methods if present
      (cfg as any).getStacksApiBaseUrl?.() ??
      (cfg as any).getApiBaseUrl?.() ??
      // fallback to env override
      process.env.STACKS_API_URL ??
      // sane defaults per network
      (net === 'mainnet'
        ? 'https://api.hiro.so'
        : net === 'testnet'
        ? 'https://api.testnet.hiro.so'
        : 'http://localhost:3999');

    this.network = net;
    this.baseUrl = customApiUrl.replace(/\/+$/, ''); // trim trailing slash

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
      // v7 shape: pass simple network name + client with baseUrl
      network: this.network,
      client: { baseUrl: this.baseUrl },
      // sender is required by some nodes; safe default: contract address
      senderAddress: this.contractAddress,
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
      client: { baseUrl: this.baseUrl },
      senderAddress: this.contractAddress,
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
      client: { baseUrl: this.baseUrl },
      senderAddress: this.contractAddress,
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
      client: { baseUrl: this.baseUrl },
      senderAddress: this.contractAddress,
    });
    return this.cvAdapter.decodeOptionalSubscriptionTuple(cv, idHex);
  }

  async getTip(): Promise<{ height: number; blockHash: string }> {
    const infoResp = await axios.get(`${this.baseUrl}/v2/info`);
    const height = Number(infoResp.data?.stacks_tip_height);
    const blkResp = await axios.get(`${this.baseUrl}/extended/v1/block/by_height/${height}`);
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
    const url = `${this.baseUrl}/extended/v1/address/${encodeURIComponent(principal)}/balances`;
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
    const contractId = `${this.contractAddress}.${this.contractName}`;
    const url = `${this.baseUrl}/extended/v1/contract/${contractId}/transactions`;
    const resp = await axios.get(url, { params: { from_height: params.fromHeight } });
    return resp.data?.results ?? [];
  }

  async getBlockHeader(
    height: number,
  ): Promise<{ parent_block_hash: string; block_hash: string }> {
    const url = `${this.baseUrl}/extended/v1/block/by_height/${height}`;
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
