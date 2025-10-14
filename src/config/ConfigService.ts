// src/config/ConfigService.ts

import type { IConfigService } from '../contracts/interfaces';
import type { IConfigSnapshot } from '../contracts/state';
import { loadEnvSnapshot } from './env';

export class ConfigService implements IConfigService {
  private readonly snap: IConfigSnapshot;

  constructor() {
    this.snap = loadEnvSnapshot();
  }

  getNetwork(): 'mainnet' | 'testnet' | 'devnet' {
    return this.snap.network;
  }

  getContractId(): { contractAddress: string; contractName: string } {
    return {
      contractAddress: this.snap.contractAddress,
      contractName: this.snap.contractName,
    };
  }

  getSbtcContractId():
    | { contractAddress: string; contractName: string }
    | undefined {
    return this.snap.sbtcContract;
  }

  getPollingConfig(): {
    minConfirmations: number;
    reorgWindowBlocks: number;
    pollIntervalSecs: number;
  } {
    return {
      minConfirmations: this.snap.minConfirmations,
      reorgWindowBlocks: this.snap.reorgWindowBlocks,
      pollIntervalSecs: this.snap.pollIntervalSecs,
    };
  }

  getAvgBlockSecs(): number {
    return this.snap.avgBlockSecs;
  }

  getPriceApiUrl(): string | undefined {
    return this.snap.priceApiUrl;
  }

  isAutoBroadcastOnChainEnabled(): boolean {
    return this.snap.autoBroadcastOnChain;
  }

  getServerSignerPrivKey(): string | undefined{
    return this.snap.serverSignerPrivKey;
  }

  getAdminToken():string | undefined{
    return this.snap.adminToken;
  }

  getHiroAPIKey():string | undefined{
    return this.snap.HiroAPIKey;
  }
}
