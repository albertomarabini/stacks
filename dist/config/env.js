"use strict";
// src/config/env.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadEnvSnapshot = loadEnvSnapshot;
function loadEnvSnapshot() {
    return Object.freeze({
        network: process.env.STACKS_NETWORK ?? 'testnet',
        contractAddress: String(process.env.CONTRACT_ADDRESS),
        contractName: String(process.env.CONTRACT_NAME),
        sbtcContract: process.env.SBTC_CONTRACT_ADDRESS && process.env.SBTC_CONTRACT_NAME
            ? {
                contractAddress: String(process.env.SBTC_CONTRACT_ADDRESS),
                contractName: String(process.env.SBTC_CONTRACT_NAME),
            }
            : undefined,
        avgBlockSecs: Number(process.env.AVG_BLOCK_SECONDS ?? 30),
        minConfirmations: Number(process.env.MIN_CONFIRMATIONS ?? 2),
        reorgWindowBlocks: Number(process.env.REORG_WINDOW_BLOCKS ?? 6),
        pollIntervalSecs: Number(process.env.POLL_INTERVAL_SECS ?? 30),
        priceApiUrl: process.env.PRICE_API_URL ? String(process.env.PRICE_API_URL) : undefined,
        autoBroadcastOnChain: String(process.env.AUTO_BROADCAST_ONCHAIN ?? '1') === '1',
        serverSignerPrivKey: process.env.SIGNER_PRIVATE_KEY ? String(process.env.SIGNER_PRIVATE_KEY) : undefined,
        adminToken: process.env.ADMIN_TOKEN ? String(process.env.ADMIN_TOKEN) : undefined,
        HiroAPIKey: process.env.HIRO_API_KEY ? String(process.env.HIRO_API_KEY) : undefined,
    });
}
//# sourceMappingURL=env.js.map