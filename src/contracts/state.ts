// src/contracts/state.ts

import type { PollerMetrics } from './domain';

// Global state access for poller metrics and control
export interface IPollerState {
  getMetrics(): PollerMetrics;
}

export interface IPollerControl {
  restart(): { running: boolean };
}

// Immutable configuration snapshot
export interface IConfigSnapshot {
  network: 'mainnet' | 'testnet' | 'devnet';
  contractAddress: string;
  contractName: string;
  sbtcContract?: { contractAddress: string; contractName: string };
  avgBlockSecs: number;
  minConfirmations: number;
  reorgWindowBlocks: number;
  pollIntervalSecs: number;
  priceApiUrl?: string;
  autoBroadcastOnChain: boolean;
  serverSignerPrivKey:string | undefined;
  adminToken:string | undefined;
  HiroAPIKey:string | undefined;
}
