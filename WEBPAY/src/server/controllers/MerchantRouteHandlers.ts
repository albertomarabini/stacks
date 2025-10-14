import type {
  IBridgeClient,
  IBrandingService,
  IHydrationInjector,
  IMerchantRouteHandlers,
  ISSRViewRenderer,
  IErrorMiddleware,
  IAuthService,
  IInvoiceService,
  ISubscriptionService,
  IStoreService
} from '../../shared/contracts/interfaces';
import { InputValidationDelegate } from './merchant/InputValidationDelegate';
import { ApiKeyRevealStateManager } from './merchant/ApiKeyRevealStateManager';
import { HydrationObjectBuilder } from './merchant/HydrationObjectBuilder';
import { BrandingContextFetcher } from './merchant/BrandingContextFetcher';
import { resolveServerBaseUrl } from '../utils/UrlUtils'
import { getTinyUrl} from'../utils/tinyUrlService'
import type { Request, Response, NextFunction } from "express";


export class MerchantRouteHandlers implements IMerchantRouteHandlers{
  private bridgeClient: IBridgeClient;
  private brandingService: IBrandingService;
  private hydrationInjector: IHydrationInjector;
  private ssrViewRenderer: typeof import('../../server/views/SSRViewRenderer').SSRViewRenderer;
  private errorMiddleware: IErrorMiddleware;
  private authService: IAuthService;
  private invoiceService: IInvoiceService;
  private subscriptionService: ISubscriptionService;
  private storeService: IStoreService;
  private inputValidator: InputValidationDelegate;
  private apiKeyRevealStateManager: ApiKeyRevealStateManager;
  private hydrationBuilder: HydrationObjectBuilder;
  private brandingFetcher: BrandingContextFetcher;

  constructor(deps: {
    bridgeClient: IBridgeClient,
    brandingService: IBrandingService,
    hydrationInjector: IHydrationInjector,
    ssrViewRenderer: typeof import('../../server/views/SSRViewRenderer').SSRViewRenderer,
    errorMiddleware: IErrorMiddleware,
    authService: IAuthService,
    invoiceService: IInvoiceService,
    subscriptionService: ISubscriptionService,
    storeService: IStoreService,
    inputValidator: InputValidationDelegate,
    apiKeyRevealStateManager: ApiKeyRevealStateManager,
    hydrationBuilder: HydrationObjectBuilder,
    brandingFetcher: BrandingContextFetcher
  }) {
    this.bridgeClient = deps.bridgeClient;
    this.brandingService = deps.brandingService;
    this.hydrationInjector = deps.hydrationInjector;
    this.ssrViewRenderer = deps.ssrViewRenderer;
    this.errorMiddleware = deps.errorMiddleware;
    this.authService = deps.authService;
    this.invoiceService = deps.invoiceService;
    this.subscriptionService = deps.subscriptionService;
    this.storeService = deps.storeService;
    this.inputValidator = deps.inputValidator;
    this.apiKeyRevealStateManager = deps.apiKeyRevealStateManager;
    this.hydrationBuilder = deps.hydrationBuilder;
    this.brandingFetcher = deps.brandingFetcher;
  }

  public async handleMerchantGet(req: any, res: any, next: any): Promise<void> {
    try {
      const storeId = req.params.storeId || (req.session as any).storeId;
      const branding = await this.brandingService.fetchBranding(storeId);
      branding.brandColor = this.inputValidator.sanitizeBrandColor(branding.brandColor);
      res.locals.branding = branding;

      this.setNoCacheHeaders(req, res, () => {});

      const isPos = req.originalUrl.startsWith('/pos/') || req.path.endsWith('/pos');
      if (isPos) {
        res.locals.csrfToken =  req.csrfToken();
        const hydration = this.hydrationBuilder.buildPosHydration(storeId);
        return res.render('merchant/pos.ejs', { branding: res.locals.branding, hydration, title: 'POS' });
      }

      // Merchant dashboard (landing for the console)
      // View exists in spec as merchant/dashboard.ejs
      return res.render('merchant/dashboard.ejs', { branding, storeId });
    } catch (err) {
      next(err);
    }
  }


  public async handleMerchantPost(req: any, res: any, next: any): Promise<void> {
    try {
      const { amount, ttl, memo } = this.inputValidator.validateInvoiceInput(req.body);
      const invoice = await this.invoiceService.createInvoice(
        (req.session as any).storeId,
        amount,
        ttl,
        memo
      );
      const hydration = this.hydrationBuilder.buildInvoiceHydration(invoice.invoiceId);
      res.render('merchant/invoice.ejs', { branding: res.locals.branding, invoice, hydration, title: 'Invoice' });
    } catch (err) {
      next(err);
    }
  }

  public async handleCancelInvoice(req: any, res: any, next: any): Promise<void> {
    try {
      const storeId = (req.session as any).storeId;
      const invoiceId = req.body.invoiceId || req.params.invoiceId;
      await this.bridgeClient.cancelInvoiceCreateTx(storeId, invoiceId, (req.session as any).apiKey);
      return res.status(204).end();
    } catch (err) {
      next(err);
    }
  }

  public async handleRefundInvoice(req: any, res: any, next: any): Promise<void> {
    try {
      const storeId = (req.session as any).storeId;
      const invoiceId = req.body.invoiceId || req.params.invoiceId;
      const refundAmount = Number(req.body.amount);
      const refundMemo = typeof req.body.memo === 'string' ? req.body.memo : '';
      const result = await this.bridgeClient.createRefundTx(
        storeId,
        invoiceId,
        refundAmount,
        refundMemo,
        (req.session as any).apiKey
      );
      const updatedInvoice = await this.invoiceService.fetchInvoice(invoiceId);
      res.render('merchant/invoice-refunded.ejs', {
        branding: res.locals.branding,
        invoice: updatedInvoice
      });
    } catch (err) {
      next(err);
    }
  }

  public async handleArchiveInvoice(req: any, res: any, next: any): Promise<void> {
    try {
      const storeId = (req.session as any).storeId;
      const invoiceId = req.body.invoiceId || req.params.invoiceId;
      await this.bridgeClient.archiveInvoice(storeId, invoiceId, (req.session as any).apiKey);
      res.render('merchant/invoice-archived.ejs', {
        branding: res.locals.branding
      });
    } catch (err) {
      next(err);
    }
  }

  public async handleGenerateInvoiceNow(req: any, res: any, next: any): Promise<void> {
    try {
      const validated = this.inputValidator.validateInvoiceInput(req.body);
      const invoice = await this.bridgeClient.createSubscriptionInvoice(
        (req.session as any).storeId,
        req.body.subscriptionId,
        validated.ttl,
        validated.memo,
        (req.session as any).apiKey
      );
      const hydration = this.hydrationBuilder.buildInvoiceHydration(invoice.invoiceId);
      res.render('merchant/invoice-success.ejs', {
        branding: res.locals.branding,
        invoice,
        hydration
      });
    } catch (err) {
      next(err);
    }
  }

  public async handleSendEmail(req: any, res: any, next: any): Promise<void> {
    try {
      res.render('merchant/send-email-success.ejs', {
        branding: res.locals.branding
      });
    } catch (err) {
      next(err);
    }
  }

  public async handleCreateSubscription(req: any, res: any, next: any): Promise<void> {
    try {
      const dto = this.inputValidator.validateSubscriptionInput(req.body);
      const sub = await this.subscriptionService.createSubscription(
        (req.session as any).storeId,
        dto,
        (req.session as any).apiKey
      );
      res.render('merchant/subscription-created.ejs', {
        branding: res.locals.branding,
        subscription: sub
      });
    } catch (err) {
      next(err);
    }
  }

  public async handleCancelSubscription(req: any, res: any, next: any): Promise<void> {
    try {
      const storeId = (req.session as any).storeId;
      const subscriptionId = req.body.subscriptionId || req.params.subscriptionId;
      const canceled = await this.subscriptionService.cancelSubscription(storeId, subscriptionId);
      const subs = await this.subscriptionService.fetchSubscriptions(storeId);
      res.render('merchant/subscription-canceled.ejs', {
        branding: res.locals.branding,
        canceled,
        subscriptions: subs
      });
    } catch (err) {
      next(err);
    }
  }

  public async handleManageSubscriptionGet(req: any, res: any, next: any): Promise<void> {
    try {
      const storeId = (req.session as any).storeId;
      const subscriptionId = req.params.subscriptionId;
      const subscription = await this.subscriptionService.fetchSubscriptionDetail(storeId, subscriptionId);
      const branding = await this.brandingService.fetchBranding(storeId);
      res.render('merchant/manage-subscription.ejs', {
        branding,
        subscription
      });
    } catch (err) {
      next(err);
    }
  }

  public async handlePrepareInvoicePost(req: any, res: any, next: any): Promise<void> {
    try {
      const { amount, ttl, memo } = this.inputValidator.validateInvoiceInput(req.body);
      const invoice = await this.invoiceService.createInvoice(
        (req.session as any).storeId,
        amount,
        ttl,
        memo
      );
      const hydration = this.hydrationBuilder.buildInvoiceHydration(invoice.invoiceId);
      res.render('merchant/pos-payment.ejs', {
        branding: res.locals.branding,
        invoice,
        hydration
      });
    } catch (err) {
      next(err);
    }
  }

  public async handleSaveBrandingProfile(req: any, res: any, next: any): Promise<void> {
    try {
      const validatedProfile = this.inputValidator.validateBrandingProfileInput(req.body);
      await (this.brandingService as any).saveBrandingProfile((req.session as any).storeId, validatedProfile);
      const branding = await this.brandingFetcher.fetchPublicBrandingOrFallback((req.session as any).storeId, this.brandingService);
      res.render('merchant/branding.ejs', { branding });
    } catch (err) {
      next(err);
    }
  }

  public async handleRotateApiKeys(req: any, res: any, next: any): Promise<void> {
    try {
      const { apiKey, hmacSecret } = await this.storeService.rotateApiKeys((req.session as any).storeId);
      const result = this.apiKeyRevealStateManager.handleApiKeysRevealAndMask(
        req,
        res.locals.branding,
        apiKey,
        hmacSecret
      );
      res.render('merchant/api-keys.ejs', result);
    } catch (err) {
      next(err);
    }
  }

  public async handleFilterSubmit(req: any, res: any, next: any): Promise<void> {
    try {
      const storeId = (req.session as any).storeId;
      const filterParams = req.body || req.query || {};
      let filtered: any[] = [];
      if (req.path.includes('subscriptions')) {
        filtered = await this.subscriptionService.fetchFilteredSubscriptions(storeId, filterParams);
      } else {
        filtered = await this.invoiceService.fetchInvoices(storeId, filterParams);
      }
      res.render('merchant/invoices-ledger.ejs', {
        branding: res.locals.branding,
        list: filtered
      });
    } catch (err) {
      next(err);
    }
  }

  public setNoCacheHeaders(_req: any, res: any, next: any): void {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    if (typeof next === 'function') next();
  }

  public async refetchAfterAction(action: string, req: any, res: any): Promise<void> {
    const storeId = (req.session as any).storeId;
    const invoiceId = req.params.invoiceId || req.body.invoiceId;
    const subscriptionId = req.params.subscriptionId || req.body.subscriptionId;

    if (action === 'invoice') {
      const invoice = await this.invoiceService.fetchInvoice(invoiceId);
      res.render('merchant/invoice.ejs', {
        branding: res.locals.branding,
        invoice
      });
      return;
    }
    if (action === 'subscription') {
      const subscription = await this.subscriptionService.fetchSubscriptionDetail(storeId, subscriptionId);
      res.render('merchant/subscription.ejs', {
        branding: res.locals.branding,
        subscription
      });
      return;
    }
    if (action === 'branding') {
      const branding = await this.brandingService.fetchBranding(storeId);
      res.render('merchant/branding.ejs', { branding });
      return;
    }
    res.render('merchant/unknown-action.ejs', { branding: res.locals.branding });
  }

  public async handleApiKeysMaskOnReload(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      const result = this.apiKeyRevealStateManager
        .handleApiKeysRevealAndMask(req, res.locals.branding);

      res.render("merchant/api-keys.ejs", result);
    } catch (err) {
      next(err as Error);
    }
  }

  public async refetchPublicProfileAfterSave(storeId: string, req: any, res: any): Promise<void> {
    res.locals.branding = await this.brandingFetcher.fetchPublicBrandingOrFallback(storeId, this.brandingService);
  }

  private makeAbsoluteMagicLink(req: any, magicLinkPath?: string | null): string | null {
    if (!magicLinkPath) return null;
    // If Bridge already returned an absolute URL, keep it
    if (/^https?:\/\//i.test(magicLinkPath)) return magicLinkPath;

    // otherwise join base + path (magicLinkPath usually starts with '/w/...')
    const base = resolveServerBaseUrl(req);
    // ensure we don't double-up slashes
    if (magicLinkPath.startsWith('/')) {
      return `${base}${magicLinkPath}`;
    } else {
      return `${base}/${magicLinkPath}`;
    }
  }

  public async handlePrepareInvoiceJson(req: any, res: any, next: any): Promise<void> {
    try {
      const { amount, ttl, memo } = this.inputValidator.validateInvoiceInput(req.body);
      const storeId = req.params.storeId || (req.session as any).storeId;

      // Optional: prevent cross-store posts if URL storeId doesn't match session
      if (req.params.storeId && req.params.storeId !== (req.session as any).storeId) {
        res.status(403).json({ error: 'Store mismatch' });
        return;
      }

      const data = { amount_sats: amount, ttl_seconds: ttl, memo };

      // No-cache for this sensitive JSON
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.setHeader('Pragma', 'no-cache');

      // Pass the session API key through
      const prepared: any = await (this.bridgeClient as any).prepareInvoice(
        storeId,
        data,
        (req.session as any).apiKey
      );
      const tinyMagicLink = "/t/" + getTinyUrl(prepared?.magicLink);
      const absoluteMagicLink = this.makeAbsoluteMagicLink(req, prepared?.magicLink);
      const absoluteTinyLink = this.makeAbsoluteMagicLink(req, tinyMagicLink);

      res.status(200).json({
        magicLink: absoluteTinyLink,
        origLink:absoluteMagicLink,
        invoiceId: prepared?.invoice?.invoiceId ?? prepared?.invoiceId ?? null,
        invoice: prepared?.invoice ?? null,
      });
    } catch (err) {
      next(err);
    }
  }


}
