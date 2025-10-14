"use strict";
// src/config/ConfigService.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigService = void 0;
const env_1 = require("./env");
class ConfigService {
    constructor() {
        this.snap = (0, env_1.loadEnvSnapshot)();
    }
    getNetwork() {
        return this.snap.network;
    }
    getContractId() {
        return {
            contractAddress: this.snap.contractAddress,
            contractName: this.snap.contractName,
        };
    }
    getSbtcContractId() {
        return this.snap.sbtcContract;
    }
    getPollingConfig() {
        return {
            minConfirmations: this.snap.minConfirmations,
            reorgWindowBlocks: this.snap.reorgWindowBlocks,
            pollIntervalSecs: this.snap.pollIntervalSecs,
        };
    }
    getAvgBlockSecs() {
        return this.snap.avgBlockSecs;
    }
    getPriceApiUrl() {
        return this.snap.priceApiUrl;
    }
    isAutoBroadcastOnChainEnabled() {
        return this.snap.autoBroadcastOnChain;
    }
    getServerSignerPrivKey() {
        return this.snap.serverSignerPrivKey;
    }
    getAdminToken() {
        return this.snap.adminToken;
    }
    getHiroAPIKey() {
        return this.snap.HiroAPIKey;
    }
}
exports.ConfigService = ConfigService;
//# sourceMappingURL=ConfigService.js.map