/**
 * TypeScript interface contracts for core system dependencies.
 * This file exports all interfaces for BridgeApiClient, MagicLink validation/renderer, Branding, Wallet, Client Script, Error Handler, Session.
 * All implementation files must import interfaces from here, not define/re-export them.
 */

import type { Request, Response, NextFunction } from 'express';

// --- Core Data Models (as types for interface signatures) ---
type Store = import('../models/core').Store;
type Invoice = import('../models/core').Invoice;
type MagicLinkDTO = import('../models/core').MagicLinkDTO;
type PublicProfile = import('../models/core').PublicProfile;
type MagicLinkU = import('../models/core').MagicLinkU;
type UnsignedCall = import('../models/core').UnsignedCall;

// --- Bridge API Client Contract ---
interface IBridgeApiClient {
  prepareInvoice(
    storeId: string,
    payload: {
      amount_sats: number;
      ttl_seconds: number;
      memo: string;
      orderId?: string;
      payerPrincipal?: string;
    }
  ): Promise<MagicLinkDTO>;

  createStore(
    payload: {
      principal: string;
      name: string;
      display_name?: string;
      logo_url?: string;
      brand_color?: string;
      allowed_origins?: string[];
      webhook_url?: string;
    }
  ): Promise<Store>;

  getStoreList(): Promise<Store[]>;

  setStoreActiveState(storeId: string, newState: boolean): Promise<{ active: boolean }>;

  getStoreProfile(storeId: string): Promise<Store>;

  updateStoreProfile(
    storeId: string,
    payload: {
      displayName?: string;
      logoUrl?: string;
      brandColor?: string;
      allowedOrigins?: string[];
      webhookUrl?: string;
    }
  ): Promise<Store>;

  getPublicProfile(storeId: string): Promise<PublicProfile>;

  rotateKeys(storeId: string): Promise<{ apiKey: string; hmacSecret: string }>;

  setSbtcToken(payload: { contractAddress: string; contractName: string }): Promise<object>;

  getWebhooksLog(query: { status: 'all' | 'failed'; storeId?: string }): Promise<any[]>;

  retryWebhook(webhookLogId: string): Promise<object>;

  getPollerStatus(): Promise<any>;

  restartPoller(): Promise<{ running: boolean }>;

  bootstrapProtocol(): Promise<object>;

  syncOnchain(storeId: string): Promise<{ calls: UnsignedCall[] }>;
}

// --- Magic-link Validation Middleware ---
interface IMagicLinkValidator {
  validateU(req: Request, res: Response, next: NextFunction): void;
}

// --- MagicLink Page Renderer ---
interface IMagicLinkPageRenderer {
  renderCheckoutPage(req: Request, res: Response, validatedUData: MagicLinkU): void;
}

// --- Branding/Public Profile Manager ---
interface IBrandingProfileManager {
  fetchBranding(storeId: string): Promise<PublicProfile>;
  handleInputChange(event: Event): void;
  applyBrandingToUI(brandingData: PublicProfile): void;
  handlePublicProfileRequest(req: Request, res: Response, next: NextFunction): Promise<void>;
  fetchAndUpdateBrandingProfile(storeId: string): Promise<void>;
}

// --- Wallet Integration (Client-side Connect) ---
interface IWalletIntegration {
  openWallet(unsignedCall: UnsignedCall): Promise<void>;
  handleWalletResult(result: { txid?: string; txId?: string; [key: string]: any }): void;
  handleSbtcTokenConfigResult(result: object): void;
  handleBootstrapProtocolResult(result: object): void;
  handleSyncCallResult(result: object, callIndex: number, totalCalls: number): void;
  handleRefundSignResult(result: object): void;
  handleOnSignResult(result: object): void;
  handleOnSignError(error: any): void;
}

// --- MagicLink Client Script (browser) ---
interface IMagicLinkClientScript {
  validateU(uBlob: string): boolean;
  handlePostWalletRedirect(txid: string): void;
}

// --- Error Handling ---
interface IErrorHandler {
  handleValidationError(res: Response, errorDetails: any): void;
  handleBridgeError(res: Response, bridgeError: any): void;
  handleDuplicateStore(res: Response, context: { existingStore: Store }): void;
  handleError(err: any, req: Request, res: Response, next: NextFunction): void;
  handleBridgeApiError(error: any): void;
}

// --- Session Management ---
interface ISessionManager {
  validateSession(req: Request, res: Response, next: NextFunction): void;
  authMiddleware: any;
}

export {
  IBridgeApiClient,
  IMagicLinkValidator,
  IMagicLinkPageRenderer,
  IBrandingProfileManager,
  IWalletIntegration,
  IMagicLinkClientScript,
  IErrorHandler,
  ISessionManager
};
