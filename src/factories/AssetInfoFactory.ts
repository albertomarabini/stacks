// src/factories/AssetInfoFactory.ts
import type { IAssetInfoFactory, IConfigService } from '../contracts/interfaces';

type SbtcAssetInfo = {
  contractAddress: string;
  contractName: string;
  assetName: string;
};

export class AssetInfoFactory implements IAssetInfoFactory {
  private readonly cfg: IConfigService;
  private cached?: SbtcAssetInfo;

  constructor(cfg: IConfigService) {
    this.cfg = cfg;
  }

  getSbtcAssetInfo(): SbtcAssetInfo {
    if (this.cached) return this.cached;

    const token = this.cfg.getSbtcContractId();
    if (!token) {
      throw new Error('sbtc_token_not_set');
    }

    const { contractAddress, contractName } = token;

    if (typeof contractAddress !== 'string' || !contractAddress.startsWith('S')) {
      throw new TypeError('invalid_sbtc_contract_address');
    }
    if (!contractName || typeof contractName !== 'string') {
      throw new TypeError('invalid_sbtc_contract_name');
    }

    const assetName = 'sbtc';

    this.cached = { contractAddress, contractName, assetName };
    return this.cached;
  }
}
