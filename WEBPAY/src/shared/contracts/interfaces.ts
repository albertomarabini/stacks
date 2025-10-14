/**
 * Canonical source for all TypeScript interfaces and DI contracts
 * referenced throughout the codebase.
 * Exports interfaces for all services, middleware, and utility contracts per Static Report.
 * Imported throughout the server/client modules; never redefined elsewhere.
 */
import type { Request, Response, NextFunction } from "express";
import type { Branding, InvoiceDTO, MagicLinkPayload, SubscriptionDTO } from "../models/dto";

// IBrandingService: Responsible for retrieving/sanitizing/injecting branding
export interface IBrandingService {
  fetchBranding(storeId: string): Promise<Branding>;
  sanitizeBrandColor(brandColor: string | null | undefined): string;
  injectFallbackBranding(): Branding;
}

// IErrorMiddleware: Global error handler for Express
export interface IErrorMiddleware {
  handleError(
    err: Error,
    req: Express.Request,
    res: Express.Response,
    next: NextFunction
  ): void;
}

// ISSRViewRenderer: EJS/SSR template rendering contract
export interface ISSRViewRenderer {
  renderFormWithCSRFToken(req: Express.Request): string;
  injectStaticAssetLinks(islands?: string[]): string;
  renderPartialWithContext(partial: string, context: Record<string, any>): string;
  setTitleFromBrandingOrOverride(title: string | undefined, branding: Branding): string;
}

// IBridgeClient: Adapter for all Bridge API calls
export interface IBridgeClient {
  // Public/Merchant invoices
  prepareInvoice(
    storeId: string,
    data: Record<string, unknown>
  ): Promise<any>; // typically { invoice, unsignedCall?, magicLink? }

  fetchInvoice(invoiceId: string): Promise<any>; // public/merchant DTO
  fetchStoreInvoice(storeId: string, invoiceId: string): Promise<any>; // non optional alt

  // Store branding/profile
  fetchPublicProfile(storeId: string): Promise<any>;
  fetchStoreProfile(storeId: string): Promise<any>;

  // Invoice actions (merchant)
  cancelInvoiceCreateTx(
    storeId: string,
    invoiceId: string,
    apiKey?: string
  ): Promise<any>;

  cancelInvoiceDTO(
    storeId: string,
    invoiceId: string,
    apiKey?: string
  ): Promise<any>;

  createTx(
    invoiceId: string,
  ): Promise<any>;

  createRefundTx(
    storeId: string,
    invoiceId: string,
    amountSats: number,
    memo: string,
    apiKey?: string
  ): Promise<any>;

  archiveInvoice(
    storeId: string,
    invoiceId: string,
    apiKey?: string
  ): Promise<any>;

  listStoreInvoices(storeId: string, params: Record<string, any>): Promise<any[]>;

  // Subscriptions (merchant)
  createSubscription(
    storeId: string,
    dto: Record<string, unknown>,
    apiKey?: string
  ): Promise<any>;

  createSubscriptionInvoice(
    storeId: string,
    subscriptionId: string,
    ttlSeconds: number,
    memo: string,
    apiKey?: string
  ): Promise<any>; // { invoice, magicLink?, unsignedCall? }

  // Admin
  listStores(): Promise<any[]>;
  createStore(dto: Record<string, unknown>): Promise<any>;
  rotateApiKeys(storeId: string): Promise<{ apiKey: string; hmacSecret: string }>;
  setSbtcTokenConfig(input: { contractAddress: string; contractName: string }): Promise<{ unsignedCall: any }>;
  bootstrap(): Promise<{ unsignedCall: any; bootstrapState?: any }>;
  syncOnchain(storeId: string): Promise<{ unsignedCalls: any[]; syncState?: any }>;
  restartPoller(): Promise<{ pollerStatus: any }>;
  fetchWebhooks(filters?: { status?: string; storeId?: string }): Promise<any[]>;
  retryWebhook(webhookLogId: string): Promise<{ enqueued: boolean; alreadyDelivered?: boolean }>;
  updateSettings(dto: Record<string, unknown>): Promise<void>;

  patchStoreActivate(storeId: string, active: boolean): Promise<{ active: boolean }>;

  // Utils
  normalizeBridgeResponse(res: any): any;
  mapBridgeError(error: any): { message: string; code?: string | number };
  getProfile(storeId: string): Promise<any>;
  getPublicProfile(storeId: string): Promise<any>;
  getPollerStatus(): Promise<any>;
}


// IHydrationInjector: Injects hydration objects into SSR templates
export interface IHydrationInjector {
  inject(hydrationObject: Record<string, any>): string;
}

// IMerchantRouteHandlers: Merchant SSR endpoints & actions
export interface IMerchantRouteHandlers {
  handleMerchantGet(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleMerchantPost(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleCancelInvoice(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleRefundInvoice(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleArchiveInvoice(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleGenerateInvoiceNow(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleSendEmail(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleCreateSubscription(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleCancelSubscription(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleManageSubscriptionGet(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handlePrepareInvoicePost(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleSaveBrandingProfile(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleRotateApiKeys(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleFilterSubmit(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  setNoCacheHeaders(req: Express.Request, res: Express.Response, next: NextFunction): void;
  refetchAfterAction(action: string, req: Express.Request, res: Express.Response): Promise<void>;
  handleApiKeysMaskOnReload(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  refetchPublicProfileAfterSave(storeId: string, req: Express.Request, res: Express.Response): Promise<void>;
  handlePrepareInvoiceJson(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
}

// IAdminRouteHandlers: Admin SSR endpoints & actions
export interface IAdminRouteHandlers {
  handleLoginPost(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleStoresPost(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleRotateKeysPost(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleTokenConfigPost(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleBootstrapPost(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleSyncOnchainPost(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handlePollerRestartPost(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleWebhooksRetryPost(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleAdminGet(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleStoreActivatePatch(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleSettingsPost(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  omitSecretsFromViewPropsAndHydration(props: object): object;
  enforceAdminContextDataScopes(req: Express.Request, res: Express.Response): void;
  handleWebhooksGet(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
}

// IPublicRouteHandlers: Public SSR endpoints & actions
export interface IPublicRouteHandlers {
  handleCheckoutPost(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleMagicLinkGet(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleStatusGet(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleInvoiceGet(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  handleLandingGet(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
  setNoCacheHeaders(res: Express.Response): void;
  handleCreateTx(req: Express.Request, res: Express.Response, next: NextFunction): Promise<void>;
}

// IExpressApp: Express app-wide middleware contracts
export interface IExpressApp {
  csrfExemptionMiddleware(): void;
  helmetCSPMiddleware(): void;
}

// IInvoiceService: Invoice business logic
export interface IInvoiceService {
  createInvoice(storeId: string, amount: number, ttl: number, memo: string): Promise<InvoiceDTO>;
  fetchInvoice(invoiceId: string): Promise<InvoiceDTO>;
  fetchInvoices(storeId: string, filterParams: object): Promise<InvoiceDTO[]>;
}

// ISubscriptionService: Subscription business logic
export interface ISubscriptionService {
  createSubscription(storeId: string, dto: object, apiKey: string): Promise<SubscriptionDTO>;
  cancelSubscription(storeId: string, subscriptionId: string): Promise<SubscriptionDTO>;
  fetchSubscriptions(storeId: string): Promise<SubscriptionDTO[]>;
  fetchSubscriptionDetail(storeId: string, subscriptionId: string): Promise<SubscriptionDTO>;
  fetchFilteredSubscriptions(storeId: string, filterParams: object): Promise<SubscriptionDTO[]>;
}

// IStoreService: Store/key rotation logic
export interface IStoreService {
  rotateApiKeys(storeId: string): Promise<{ apiKey: string; hmacSecret: string }>;
}

// IMagicLinkService: Magic-link parsing & validation
export interface IMagicLinkService {
  validateAndParse(
    u_blob: string,
    context: { storeId: string; invoiceId: string }
  ): Promise<{ payload: MagicLinkPayload; invoice: InvoiceDTO }>;
}

// IAuthService: Session and admin authentication control
export interface IAuthService {
  requireSession(
    req: Express.Request,
    res: Express.Response,
    next: NextFunction
  ): void;
  requireAdminSession(
    req: Express.Request,
    res: Express.Response,
    next: NextFunction
  ): void;
}

// NoCacheHeaderSetter: Utility for setting response headers
export interface NoCacheHeaderSetter {
  set(res: Express.Response): void;
}

// BrandColorSanitizer: Utility for sanitizing brandColor with regex and fallback
export interface BrandColorSanitizer {
  sanitize(brandColor: string | undefined): string;
}

// BrandingSSRInjector: Utility for SSR branding context injection
export interface BrandingSSRInjector {
  injectBranding(res: Express.Response, storeId?: string): Promise<void>;
}
