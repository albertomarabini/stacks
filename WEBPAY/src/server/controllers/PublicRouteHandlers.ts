// PublicRouteHandlers.ts

import {
  IBridgeClient,
  IBrandingService,
  IHydrationInjector,
  ISSRViewRenderer,
  IErrorMiddleware,
  IMagicLinkService,
  IPublicRouteHandlers,
} from "../../shared/contracts/interfaces";
import { MagicLinkValidationService } from "../services/MagicLinkValidationService";
import { BrandColorSanitizer } from "../utils/BrandColorSanitizer";
import { NoCacheHeaderSetter } from "../utils/NoCacheHeaderSetter";
import { BrandingSSRInjector } from "../utils/BrandingSSRInjector";
import { resolveServerBaseUrl } from "../utils/UrlUtils";


/**
 * Handles all public SSR endpoints and API surfaces: magic-link, checkout, status, invoice, and landing pages.
 * Implements contract-compliant validation, BridgeClient integration, branding/hydration injection, cache headers,
 * and propagates errors to ErrorMiddleware. Delegates magic-link validation/parsing to MagicLinkValidationService and other delegates.
 */
export class PublicRouteHandlers implements IPublicRouteHandlers {
  private bridgeClient: IBridgeClient;
  private brandingService: IBrandingService;
  private hydrationInjector: IHydrationInjector;
  private ssrViewRenderer: ISSRViewRenderer;
  private errorMiddleware: IErrorMiddleware;
  private magicLinkValidationService: MagicLinkValidationService;
  private brandColorSanitizer: typeof BrandColorSanitizer;
  private noCacheHeaderSetter: typeof NoCacheHeaderSetter;
  private brandingSSRInjector: typeof BrandingSSRInjector;

  constructor(deps: {
    bridgeClient: IBridgeClient;
    brandingService: IBrandingService;
    hydrationInjector: IHydrationInjector;
    ssrViewRenderer: ISSRViewRenderer;
    errorMiddleware: IErrorMiddleware;
    magicLinkValidationService: MagicLinkValidationService;
    brandColorSanitizer: typeof BrandColorSanitizer;
    noCacheHeaderSetter: typeof NoCacheHeaderSetter;
    brandingSSRInjector: typeof BrandingSSRInjector;
  }) {
    this.bridgeClient = deps.bridgeClient;
    this.brandingService = deps.brandingService;
    this.hydrationInjector = deps.hydrationInjector;
    this.ssrViewRenderer = deps.ssrViewRenderer;
    this.errorMiddleware = deps.errorMiddleware;
    this.magicLinkValidationService = deps.magicLinkValidationService;
    this.brandColorSanitizer = deps.brandColorSanitizer;
    this.noCacheHeaderSetter = deps.noCacheHeaderSetter;
    this.brandingSSRInjector = deps.brandingSSRInjector;
  }

  /**
   * Express route handler for POST `/checkout/:storeId`.
   * Validates required fields, calls BridgeClient.prepareInvoice, and responds with 302 redirect to magicLink.
   */
  public async handleCheckoutPost(req: any, res: any, next: any): Promise<void> {
    const { storeId } = req.params;
    const body = req.body || {};
    const amount_sats = Number(body.amount_sats);
    const ttl_seconds = Number(body.ttl_seconds);
    const memo = typeof body.memo === "string" ? body.memo : "";
    const orderId = typeof body.orderId === "string" ? body.orderId : undefined;
    const payerPrincipal = typeof body.payerPrincipal === "string" ? body.payerPrincipal : undefined;
    let returnUrl = typeof body.return === "string" ? body.return : undefined;
    if (process.env.AUTH_BYPASS === '1') {
      returnUrl = resolveServerBaseUrl(req) + "/__dev__/return-catcher";
    }
    if (!storeId || typeof storeId !== "string") {
      const err = new Error("Missing or invalid storeId.");
      (err as any).status = 400;
      return next(err);
    }
    if (
      typeof amount_sats !== "number" ||
      !isFinite(amount_sats) ||
      amount_sats <= 0
    ) {
      const err = new Error("amount_sats must be a positive number.");
      (err as any).status = 400;
      return next(err);
    }
    if (
      !Number.isInteger(ttl_seconds) ||
      ttl_seconds < 120 ||
      ttl_seconds > 1800
    ) {
      const err = new Error("ttl_seconds must be an integer between 120 and 1800.");
      (err as any).status = 400;
      return next(err);
    }
    if (typeof memo !== "string") {
      const err = new Error("memo must be a string.");
      (err as any).status = 400;
      return next(err);
    }

    const reqData: any = {
      amount_sats,
      ttl_seconds,
      memo,
    };
    if (orderId) reqData.orderId = orderId;
    if (payerPrincipal) reqData.payerPrincipal = payerPrincipal;
    if (returnUrl) reqData.return = returnUrl;

    try {
      const invoiceResp = await this.bridgeClient.prepareInvoice(storeId, reqData);
      if (
        !invoiceResp ||
        typeof invoiceResp.magicLink !== "string" ||
        !invoiceResp.magicLink
      ) {
        const err = new Error("Bridge failed to return a valid magicLink.");
        (err as any).status = 502;
        return next(err);
      }
      res.status(302).setHeader("Location", invoiceResp.magicLink);
      res.end();
    } catch (err: any) {
      return next(err);
    }
  }

  /**
   * Express GET handler for `/w/:storeId/:invoiceId`.
   * Delegates all magic-link parsing, validation, and SSR rendering.
   * Handles deactivation business logic with branding.
   */
  public async handleMagicLinkGet(req: any, res: any, next: any): Promise<void> {
    const { storeId, invoiceId } = req.params;
    const u = typeof req.query.u === "string" ? req.query.u : "";
    let returnUrl = typeof req.query.return === "string" ? req.query.return : null;

    if (!u) {
      const err = new Error("Missing required payment parameter.");
      (err as any).status = 400;
      return next(err);
    }

    try {
      const validated = await this.magicLinkValidationService.validateAndParse(u, { storeId, invoiceId });
      const invoice = validated.invoice;

      await this.brandingSSRInjector.injectBranding(res, storeId);
      this.noCacheHeaderSetter.set(res);

      const isInactive = res.locals.branding && res.locals.branding.active === false;
      const deactivationReason = isInactive ? (res.locals.branding.deactivationReason || "Store is inactive") : null;


      res.render("magic-link", {
        branding: res.locals.branding,
        invoice,
        magicLink: req.originalUrl, // includes ?u=&return=
        returnUrl,
        memo: invoice?.memo || "",
        hydration: {
          lastNetwork:process.env.DEPLOYMENT_NETWORK,
          env:(process.env.AUTH_BYPASS === '1')?"dev":"prod",
          invoiceId,
          magicLink: req.originalUrl,
          returnUrl,
          u,
          quoteExpiresAt: invoice?.quoteExpiresAt,
          storeId,
          memo: invoice?.memo || "",
        },
        deactivationReason
      });
    } catch (magicLinkErr: any) {
      let status = 400;
      if (magicLinkErr && typeof magicLinkErr.status === "number") status = magicLinkErr.status;
      (magicLinkErr as any).status = status;
      return next(magicLinkErr);
    }
  }

  // POST /create-tx
  public async handleCreateTx(req: any, res: any, next: any): Promise<void> {
    const { invoice_id } = req.body || {};
    if (!invoice_id || typeof invoice_id !== "string") {
      const err = new Error("Missing or invalid invoiceId.");
      (err as any).status = 400;
      return next(err);
    }
    try {
      const dto = await this.bridgeClient.createTx(invoice_id);
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.setHeader("Pragma", "no-cache");
      res.type("application/json").json(dto);
    } catch (err: any) {
      return next(err);
    }
  }

  // GET /status/:invoiceId
  public async handleStatusGet(req: any, res: any, next: any): Promise<void> {
    const { invoiceId, storeId } = req.params;
    if (!invoiceId || typeof invoiceId !== "string") {
      const err = new Error("Missing or invalid invoiceId.");
      (err as any).status = 400;
      return next(err);
    }
    if (!storeId || typeof storeId !== "string") {
      const err = new Error("Missing or invalid storeId.");
      (err as any).status = 400;
      return next(err);
    }
    try {
      const dto = await this.bridgeClient.fetchStoreInvoice(storeId, invoiceId);
      res.setHeader("Cache-Control", "no-store, max-age=0");
      res.setHeader("Pragma", "no-cache");
      res.type("application/json").json(dto);
    } catch (err: any) {
      return next(err);
    }
  }

  // GET /invoice/:invoiceId
  public async handleInvoiceGet(req: any, res: any, next: any): Promise<void> {
    const { invoiceId } = req.params;
    if (!invoiceId || typeof invoiceId !== "string") {
      const err = new Error("Missing or invalid invoiceId.");
      (err as any).status = 400;
      return next(err);
    }

    try {
      const invoice = await this.bridgeClient.fetchInvoice(invoiceId);
      const storeId = invoice.storeId;

      await this.brandingSSRInjector.injectBranding(res, storeId);
      if (res.locals.branding?.brandColor) {
        res.locals.branding.brandColor = this.brandColorSanitizer.sanitize(res.locals.branding.brandColor);
      }
      this.noCacheHeaderSetter.set(res);

      res.render("invoice", {
        branding: res.locals.branding,
        invoice,
        hydration: { invoiceId }
      });
    } catch (err: any) {
      return next(err);
    }
  }
  /**
   * Express GET handler for `/` (root landing) (Debug)
   * Fetches and sanitizes branding. SSR-renders landing.ejs.
   */
  public async handleLandingGet(req: any, res: any, next: any): Promise<void> {
    try {
      let branding = this.brandingService.injectFallbackBranding();
      branding.brandColor = this.brandColorSanitizer.sanitize((branding as any).brandColor);
      (branding as any).baseURL = resolveServerBaseUrl(req);
      res.render("landing.ejs", {
        branding,
      });
    } catch (err: any) {
      return next(err);
    }
  }

  /**
   * Sets HTTP no-store, no-cache headers on SSR responses for sensitive payment pages.
   * Refactored to delegate to NoCacheHeaderSetter utility.
   */
  public setNoCacheHeaders(res: any): void {
    this.noCacheHeaderSetter.set(res);
  }
}
