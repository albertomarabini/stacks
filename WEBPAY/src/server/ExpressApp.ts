//ExpressApp.ts

import express from 'express';
import session from 'express-session';
import type {
  IBrandingService,
  IBridgeClient,
  IHydrationInjector,
  IMerchantRouteHandlers,
  IPublicRouteHandlers,
  IAdminRouteHandlers,
  IAuthService,
  IErrorMiddleware,
  ISSRViewRenderer,
  IInvoiceService,
  ISubscriptionService,
  IStoreService,
  IMagicLinkService,
} from '../shared/contracts/interfaces';
import { CSRFandSecurityMiddleware } from './middleware/CSRFandSecurityMiddleware';
import { StaticAssetMiddleware } from './middleware/StaticAssetMiddleware';
import { ExpressCSPHashManager } from './middleware/ExpressCSPHashManager';
import { BrandingSSRInjector } from './utils/BrandingSSRInjector';
import { retrieveUrl } from "./utils/tinyUrlService";
import path from 'path';
import ejsMate from 'ejs-mate';

export class ExpressApp {
  public app: express.Express;

  constructor(deps: {
    brandingService: IBrandingService;
    bridgeClient: IBridgeClient;
    hydrationInjector: IHydrationInjector;
    ssrViewRenderer: ISSRViewRenderer;
    merchantRouteHandlers: IMerchantRouteHandlers;
    publicRouteHandlers: IPublicRouteHandlers;
    adminRouteHandlers: IAdminRouteHandlers;
    authService: IAuthService;
    errorMiddleware: IErrorMiddleware;
    invoiceService: IInvoiceService;
    subscriptionService: ISubscriptionService;
    storeService: IStoreService;
    magicLinkService: IMagicLinkService;
    sessionOptions: session.SessionOptions;
  }) {
    this.app = express();

    // Attach references for utilities/delegates to app.locals for delegates/middleware
    this.app.locals.brandingService = deps.brandingService;
    this.app.locals.bridgeClient = deps.bridgeClient;
    this.app.locals.hydrationInjector = deps.hydrationInjector;
    this.app.locals.ssrViewRenderer = deps.ssrViewRenderer;
    this.app.locals.invoiceService = deps.invoiceService;
    this.app.locals.subscriptionService = deps.subscriptionService;
    this.app.locals.storeService = deps.storeService;
    this.app.locals.magicLinkService = deps.magicLinkService;

    // Parse JSON and urlencoded forms for all requests
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Session middleware (must precede CSRF)
    this.app.use(session(deps.sessionOptions));

    // Security headers (CSP etc.) — run BEFORE static + routes
    this.app.use(CSRFandSecurityMiddleware.helmetCSP());
    // If you need hashes/nonces, run the hash manager AFTER helmet,
    // and make sure it MERGES with existing header (see step 3).
    this.app.use(ExpressCSPHashManager.middleware());

    // Static assets under /static/*
    this.app.use('/static', StaticAssetMiddleware);
    if (process.env.AUTH_BYPASS === '1') {
      this.app.use('/__dev__', express.static(path.join(process.cwd(), 'public', '__dev__')));
    }
    // Register CSRF exemption logic before all route registrations
    this.csrfExemptionMiddleware();
    this.app.use((req, res, next) => {
      const t = (req as any).csrfToken;
      if (typeof t === 'function') {
        try {
          res.locals.csrfToken = t();  // put it in locals for all views
        } catch {
          // token might throw on exempted routes; ignore
        }
      }
      next();
    });

    // Set cache-control headers on all SSR admin and merchant responses
    this.app.use([/^\/admin(?:\/|$)/, /^\/merchant(?:\/|$)/], (req, res, next) => {
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.setHeader('Pragma', 'no-cache');
      next();
    });

    this.app.set("views", path.join(process.cwd(), "src", "server", "views"));
    this.app.engine('ejs', ejsMate);
    this.app.set('view engine', 'ejs');

    // --- Public routes ---
    const publicRouter = express.Router();
    if (process.env.AUTH_BYPASS === '1') {
      this.app.get('/__dev__/login-admin', (req, res) => {
        (req.session as any).admin = { id: 'dev-admin', email: 'admin@local' };
        res.redirect('/admin');
      });

      this.app.get('/__dev__/login-merchant/:storeId', (req, res) => {
        (req.session as any).storeId = req.params.storeId;
        (req.session as any).merchant = { id: `dev-${req.params.storeId}`, storeId: req.params.storeId };
        res.redirect('/merchant');
      });

      // dev return forwarder — accepts GET or POST and forwards all params as query string
      publicRouter.all(
        '/__dev__/return-catcher',
        CSRFandSecurityMiddleware.disableCsrf(),
        (req, res) => {
        // Merge query + body; POST wins if keys overlap
        const merged: Record<string, any> = { ...(req.query || {}) , ...(req.body || {}) };

        // Build query string (support arrays by appending multiple entries)
        const qs = new URLSearchParams();
        for (const [key, value] of Object.entries(merged)) {
          if (Array.isArray(value)) {
            for (const v of value) qs.append(key, String(v));
          } else if (value != null && typeof value === 'object') {
            // flatten object-ish values as JSON
            qs.append(key, JSON.stringify(value));
          } else if (value != null) {
            qs.append(key, String(value));
          }
        }

        // Use 303 so browsers will do a GET to the viewer regardless of original method
        res.redirect(303, `/__dev__/return-view.html${qs.toString() ? '?' + qs.toString() : ''}`);
      });
    }
    //E-Commerce Checkout
    publicRouter.post(
      '/checkout/:storeId',
      CSRFandSecurityMiddleware.disableCsrf(),
      (req, res, next) => deps.publicRouteHandlers.handleCheckoutPost(req, res, next)
    );
    //Magicklink
    publicRouter.get(
      '/w/:storeId/:invoiceId',
      CSRFandSecurityMiddleware.disableCsrf(),
      (req, res, next) => deps.publicRouteHandlers.handleMagicLinkGet(req, res, next)
    );
    //Magicklink proxy for Store
    publicRouter.get("/t/:tinyId", (req, res) => {
      const { tinyId } = req.params;
      const fullUrl = retrieveUrl(tinyId);
      if (!fullUrl) {
        console.warn(`[tinyurl] invalid id: ${tinyId}`);
        return res.status(404).send("Not found");
      }
      // just redirect to the real route
      return res.redirect(fullUrl);
    });
    //Status
    publicRouter.get(
      '/status/:storeId/:invoiceId',
      CSRFandSecurityMiddleware.disableCsrf(),
      (req, res, next) => deps.publicRouteHandlers.handleStatusGet(req, res, next)
    );
    publicRouter.post(
      '/create-tx',
      CSRFandSecurityMiddleware.disableCsrf(),
      (req, res, next) => deps.publicRouteHandlers.handleCreateTx(req, res, next)
    );
    publicRouter.get(
      '/invoice/:invoiceId',
      CSRFandSecurityMiddleware.disableCsrf(),
      (req, res, next) => deps.publicRouteHandlers.handleInvoiceGet(req, res, next)
    );
    //Landing Page
    publicRouter.get(
      '/',
      (req, res, next) => deps.publicRouteHandlers.handleLandingGet(req, res, next)
    );
    // MagicLink return proxy
    publicRouter.post(
      '/w/return-proxy/:storeId',
      CSRFandSecurityMiddleware.disableCsrf(),
      async (req, res) => {
        try {
          const { returnUrl, status, invoiceId, memo } = req.body;

          if (!returnUrl || typeof returnUrl !== 'string') {
            return res.status(400).json({ error: 'Missing returnUrl' });
          }

          // ---- Background POST forwarding ----
          const body = new URLSearchParams({
            status: status || '',
            invoiceId: invoiceId || '',
            memo: memo || '',
          }).toString();

          const fwd = await fetch(returnUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
            },
            body,
          });

          // You can log or propagate merchant response if needed
          if (!fwd.ok) {
            const text = await fwd.text();
            console.warn(`Return-proxy forward failed ${fwd.status}: ${text}`);
          }

          // Respond to the browser; stay on same page
          const sep = returnUrl.includes('?') ? '&' : '?';
          const redirectTo = `${returnUrl}${sep}${body}`;
          res.json({ ok: true, redirectTo });
        } catch (err) {
          console.error('Return proxy error:', err);
          res.status(500).json({ error: 'Return proxy failed' });
        }
      }
    );


    this.app.use(publicRouter);

    // --- Merchant routes ---
    const merchantRouter = express.Router();
    merchantRouter.use(deps.authService.requireSession.bind(deps.authService));

    // Merchant landing: /merchant  → dashboard for the current session’s store
    merchantRouter.get('/', async (req, res, next) => {
      try {
        const storeId = (req.session as any).storeId; // Required by your handlers; if absent, auth middleware should block
        // Fetch branding like other merchant pages do
        const branding = await this.app.locals.brandingService.fetchBranding(storeId);
        res.locals.branding = branding;
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        return res.render('merchant/dashboard.ejs', {
          branding,
          storeId,
          title: branding?.displayName || 'Merchant Console' // fallback text
        });
      } catch (err) {
        next(err);
      }
    });

    // Invoices ledger page
    merchantRouter.get('/:storeId/invoices', async (req, res, next) => {
      try {
        const storeId = req.params.storeId;
        const branding = await this.app.locals.brandingService.fetchBranding(storeId);
        res.locals.branding = branding;
        res.locals.csrfToken = req.csrfToken?.();
        // initial empty list; the filter island will POST to /merchant/:storeId/invoices/filter
        return res.render('merchant/invoices-ledger.ejs', { branding, storeId, list: [] });
      } catch (err) { next(err); }
    });

    // Subscriptions ledger page
    merchantRouter.get('/:storeId/subscriptions', async (req, res, next) => {
      try {
        const storeId = req.params.storeId;
        const branding = await this.app.locals.brandingService.fetchBranding(storeId);
        res.locals.branding = branding;
        res.locals.csrfToken = req.csrfToken?.();
        // initial empty list; the filter island will POST to /merchant/:storeId/subscriptions/filter
        return res.render('merchant/subscriptions-ledger.ejs', { branding, storeId, list: [] });
      } catch (err) { next(err); }
    });

    // Merchant settings (branding/api keys page shell)
    merchantRouter.get('/:storeId/settings', async (req, res, next) => {
      try {
        const storeId = req.params.storeId;
        const branding = await this.app.locals.brandingService.fetchBranding(storeId);
        const storeProfile  = await this.app.locals.bridgeClient.fetchStoreProfile(storeId);
        res.locals.branding = branding;
        res.locals.csrfToken = req.csrfToken?.();

        return res.render('merchant/settings.ejs', { branding, storeId, storeProfile  });
      } catch (err) { next(err); }
    });

    merchantRouter.post('/:storeId/settings', async (req, res, next) => {
      try {
        const storeId = req.params.storeId;
        const payload = {
          displayName: (req.body.display_name),
          logoUrl: (req.body.logo_url),
          brandColor: (req.body.brand_color),
          supportEmail: (req.body.support_email),
          supportUrl: (req.body.support_url),
          principal: (req.body.principal),
          stx_private_key: (req.body.stx_private_key || ""),
        };
        await this.app.locals.bridgeClient.patchStoreProfile(storeId, payload);
        //res.redirect(303, `/merchant/${encodeURIComponent(storeId)}/settings`);
        res.redirect(303, `/merchant`);
      } catch (err) { next(err); }
    });


    merchantRouter.get('/:storeId/key', async (req, res, next) => {
      try {
        const storeId = req.params.storeId;
        const branding = await this.app.locals.brandingService.fetchBranding(storeId);
        res.locals.branding = branding;
        res.locals.csrfToken = req.csrfToken?.();
        return res.render('merchant/key.ejs', { branding, storeId });
      } catch (err) { next(err); }
    });

    merchantRouter.get('/:storeId', (req,res,next) =>
      deps.merchantRouteHandlers.handleMerchantGet(req,res,next)
    );
    merchantRouter.post('/:storeId', (req,res,next) =>
      deps.merchantRouteHandlers.handleMerchantPost(req,res,next)
    );

    // JSON BFF: POS create (browser → WEBPAY → Bridge)
    merchantRouter.post(
      '/stores/:storeId/prepare-invoice',
      CSRFandSecurityMiddleware.disableCsrf(), // POC: island fetch has no CSRF token
      (req, res, next) => deps.merchantRouteHandlers.handlePrepareInvoiceJson(req, res, next)
    );

    // Create invoice (server-rendered flow separate from the generic POST /:storeId)
    // Renders merchant/pos-payment.ejs via handlePrepareInvoicePost
    merchantRouter.post(
      '/:storeId/invoices/prepare',
      (req, res, next) => deps.merchantRouteHandlers.handlePrepareInvoiceJson(req, res, next)
    );

    // Cancel an invoice (renders merchant/invoice-canceled.ejs)
    merchantRouter.post(
      '/:storeId/invoices/:invoiceId/cancel',
      (req, res, next) => deps.merchantRouteHandlers.handleCancelInvoice(req, res, next)
    );

    // Refund an invoice (renders merchant/invoice-refunded.ejs)
    // expects body: { amount, memo? }
    merchantRouter.post(
      '/:storeId/invoices/:invoiceId/refund',
      (req, res, next) => deps.merchantRouteHandlers.handleRefundInvoice(req, res, next)
    );

    // Archive an invoice (renders merchant/invoice-archived.ejs)
    merchantRouter.post(
      '/:storeId/invoices/:invoiceId/archive',
      (req, res, next) => deps.merchantRouteHandlers.handleArchiveInvoice(req, res, next)
    );

    // Filter/search invoices (renders merchant/invoices-ledger.ejs)
    merchantRouter.post(
      '/:storeId/invoices/filter',
      async (req, res, next) => {
        try {
          const storeId = req.params.storeId;
          const status = typeof req.body.status === 'string' ? req.body.status : '';
          const list = await this.app.locals.invoiceService.fetchInvoices(storeId, { status });
          // render the same partial you already use
          res.render('merchant/invoices-ledger.ejs', {
            branding: res.locals.branding,
            list,
            layout: false,        // IMPORTANT: return fragment only
            partial: true         // (optional) flag if your EJS checks this
          });
        } catch (err) { next(err); }
      }
    );

    // ─────────────────────────────────────────────────────────────────────────────
    // Merchant: SUBSCRIPTION management routes
    // ─────────────────────────────────────────────────────────────────────────────

    // Create a subscription (renders merchant/subscription-created.ejs)
    merchantRouter.post(
      '/:storeId/subscriptions',
      (req, res, next) => deps.merchantRouteHandlers.handleCreateSubscription(req, res, next)
    );

    // Cancel a subscription (renders merchant/subscription-canceled.ejs)
    merchantRouter.post(
      '/:storeId/subscriptions/:subscriptionId/cancel',
      (req, res, next) => deps.merchantRouteHandlers.handleCancelSubscription(req, res, next)
    );

    // Manage subscription (detail/manage screen; renders merchant/manage-subscription.ejs)
    merchantRouter.get(
      '/:storeId/subscriptions/:subscriptionId/manage',
      (req, res, next) => deps.merchantRouteHandlers.handleManageSubscriptionGet(req, res, next)
    );

    // Generate an invoice now for a subscription (renders merchant/invoice-success.ejs)
    // expects body: { ttl, memo? }
    merchantRouter.post(
      '/:storeId/subscriptions/:subscriptionId/invoice-now',
      (req, res, next) => deps.merchantRouteHandlers.handleGenerateInvoiceNow(req, res, next)
    );
    merchantRouter.post(
      '/:storeId/subscriptions/filter',
      (req, res, next) => deps.merchantRouteHandlers.handleFilterSubmit(req, res, next)
    );



    this.app.use('/merchant', merchantRouter);


    // POS (canonical)
    const posRouter = express.Router();
    posRouter.use(deps.authService.requireSession.bind(deps.authService));
    posRouter.get('/:storeId', (req,res,next) =>
      deps.merchantRouteHandlers.handleMerchantGet(req,res,next)
    );
    this.app.use('/pos', posRouter);

    // POS alias under merchant → redirect to canonical
    this.app.get('/merchant/:storeId/pos', (req,res) =>
      res.redirect(302, `/pos/${req.params.storeId}`)
    );


    // --- Admin routes ---
    const adminRouter = express.Router();
    adminRouter.use(deps.authService.requireAdminSession.bind(deps.authService));

    // GET views (keep the catch-all to render admin pages)
    adminRouter.get('/webhooks', (req, res, next) =>
      deps.adminRouteHandlers.handleWebhooksGet(req, res, next)
    );
    adminRouter.get('*', (req, res, next) =>
      deps.adminRouteHandlers.handleAdminGet(req, res, next)
    );

    // Explicit POST/PATCH actions wired to the correct handlers
    adminRouter.post('/stores', (req, res, next) =>
      deps.adminRouteHandlers.handleStoresPost(req, res, next)
    );
    adminRouter.post('/stores/:storeId/rotate-keys', (req, res, next) =>
      deps.adminRouteHandlers.handleRotateKeysPost(req, res, next)
    );
    adminRouter.patch('/stores/:storeId/activate', (req, res, next) =>
      deps.adminRouteHandlers.handleStoreActivatePatch(req, res, next)
    );
    adminRouter.post('/stores/:storeId/activate', (req, res, next) =>
      deps.adminRouteHandlers.handleStoreActivatePatch(req, res, next)
    );
    adminRouter.post('/token', (req, res, next) =>
      deps.adminRouteHandlers.handleTokenConfigPost(req, res, next)
    );
    adminRouter.post('/bootstrap', (req, res, next) =>
      deps.adminRouteHandlers.handleBootstrapPost(req, res, next)
    );
    adminRouter.post('/stores/:storeId/sync-onchain', (req, res, next) =>
      deps.adminRouteHandlers.handleSyncOnchainPost(req, res, next)
    );

    adminRouter.post('/poller/restart', (req, res, next) =>
      deps.adminRouteHandlers.handlePollerRestartPost(req, res, next)
    );
    adminRouter.post('/webhooks/retry', (req, res, next) =>
      deps.adminRouteHandlers.handleWebhooksRetryPost(req, res, next)
    );

    // Keep settings as a dedicated endpoint (optional, since template may be missing)
    adminRouter.post('/settings', (req, res, next) =>
      deps.adminRouteHandlers.handleSettingsPost(req, res, next)
    );

    this.app.use('/admin', adminRouter);

    // --- Global error middleware (must be last) ---
    this.app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
      deps.errorMiddleware.handleError(err, req, res, next);
    });
  }

  /**
   * Configures global CSRF protection using csurf middleware,
   * but programmatically excludes public routes from CSRF checks.
   */
  public csrfExemptionMiddleware(): void {
    this.app.use((req, res, next) => {
      const path = req.path;
      if (
        /^\/checkout\/[^/]+$/.test(path) ||
        /^\/status\/[^/]+$/.test(path) ||
        /^\/w\/[^/]+\/[^/]+$/.test(path) ||
        /^\/invoice\/[^/]+$/.test(path) ||
        /^\/__dev__\/return-catcher$/.test(path) ||
        /^\/create-tx$/.test(path)
      ) {
        return CSRFandSecurityMiddleware.disableCsrf()(req, res, next);
      }
      return CSRFandSecurityMiddleware.csrfProtection()(req, res, next);
    });
  }

  /**
   * Ensures that CSP headers are correctly set for all SSR responses using
   * the ExpressCSPHashManager delegate.
   */
  public helmetCSPMiddleware(): void {
    // 1) set baseline CSP with Helmet
    this.app.use(CSRFandSecurityMiddleware.helmetCSP());
    // 2) then let the hash manager adjust/append to it (must not overwrite)
    this.app.use(ExpressCSPHashManager.middleware());
  }
}
