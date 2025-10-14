"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AssetInfoFactory = void 0;
class AssetInfoFactory {
    constructor(cfg) {
        this.cfg = cfg;
    }
    getSbtcAssetInfo() {
        if (this.cached)
            return this.cached;
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
exports.AssetInfoFactory = AssetInfoFactory;
//# sourceMappingURL=AssetInfoFactory.js.map