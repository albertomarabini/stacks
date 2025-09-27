// src/server/HttpApiServer.ts
import express, { Express, RequestHandler } from 'express';
import { PublicApiController } from '../controllers/PublicApiController';
import { MerchantApiController } from '../controllers/MerchantApiController';
import { AdminApiController } from '../controllers/AdminApiController';
import { HealthController } from '../controllers/HealthController';
import { AdminAuth } from '../middleware/AdminAuth';
import { StoreApiAuth } from '../middleware/StoreApiAuth';
import { CrossTenantMask } from '../middleware/CrossTenantMask';
import { RateLimitPolicy } from '../middleware/RateLimitPolicy';
import { CorsPolicy } from '../middleware/CorsPolicy';
import { AdminStaticServer } from '../servers/AdminStaticServer';
import { PaymentPoller } from '../poller/PaymentPoller';
import { WebhookRetryScheduler } from '../webhooks/WebhookRetryScheduler';
import { SubscriptionScheduler } from '../schedulers/SubscriptionScheduler';
import { AdminSurfaceBinder } from '../delegates/AdminSurfaceBinder';
import { WebhookInboundSurfaceBinder } from '../delegates/WebhookInboundSurfaceBinder';
import { RootRouteBinder } from '../delegates/RootRouteBinder';
import { SchedulerStartupCoordinator } from '../delegates/SchedulerStartupCoordinator';
import { CorsMiddlewareFactory } from '../delegates/CorsMiddlewareFactory';
import type { IConfigService } from '../contracts/interfaces';

type AdminGuard = { authenticateAdmin(req: any, res: any, next: any): void };
const JSON_LIMIT = process.env.HTTP_JSON_LIMIT || '256kb';

export class HttpApiServer {
  private readonly adminBinder = new AdminSurfaceBinder();
  private readonly inboundBinder = new WebhookInboundSurfaceBinder();
  private readonly rootBinder = new RootRouteBinder();
  private readonly schedulerCoordinator = new SchedulerStartupCoordinator();
  private readonly corsFactory = new CorsMiddlewareFactory();

  mountAdminAuth(app: Express, adminAuth: AdminGuard): void {
    this.adminBinder.bindAdminAuth(app, adminAuth);
  }

  mountAdminStatic(
    app: Express,
    adminAuth: AdminGuard,
    staticMiddleware: RequestHandler,
  ): void {
    this.adminBinder.bindAdminStatic(app, adminAuth, staticMiddleware);
  }

  mountRoot(app: Express, handler: { getRoot(req: any, res: any): void }): void {
    this.rootBinder.bindRoot(app, handler);
  }

  mountAdminIndex(
    app: Express,
    adminAuth: AdminGuard,
    serveIndex: (req: any, res: any) => void,
  ): void {
    this.adminBinder.bindAdminIndex(app, adminAuth, serveIndex);
  }

  mountInboundWebhookVerifier(app: Express, verifierMw: RequestHandler): void {
    this.inboundBinder.bind(app, verifierMw);
  }

  composeRoutesAndMiddleware(app: Express, deps: {
    publicCtrl: PublicApiController;
    merchantCtrl: MerchantApiController;
    adminCtrl: AdminApiController;
    healthCtrl: HealthController;
    adminAuth: AdminAuth;
    storeAuth: StoreApiAuth;
    crossTenantMask: CrossTenantMask;
    rateLimit: RateLimitPolicy;
    corsPolicy: CorsPolicy;
    staticServer: AdminStaticServer; // <-- ensure this exists in the type
    webhookVerifier: RequestHandler;
  }): void {
    deps.rateLimit.initLimiters();

    this.mountAdminAuth(app, deps.adminAuth);
    this.mountInboundWebhookVerifier(app, deps.webhookVerifier);

    const corsGetInvoice = this.corsFactory.create(['GET', 'OPTIONS'], deps.corsPolicy as any);
    const corsCreateTx = this.corsFactory.create(['POST', 'OPTIONS'], deps.corsPolicy as any);
    const corsPublicProfile = this.corsFactory.create(['GET', 'OPTIONS'], deps.corsPolicy as any);

    // Public routes + preflights

    app.options('/i/:invoiceId', corsGetInvoice);
    app.get(
      '/i/:invoiceId',
      deps.rateLimit.publicInvoiceViewLimiter,
      corsGetInvoice,
      (req, res) => deps.publicCtrl.getInvoice(req, res),
    );

    app.options('/create-tx', corsCreateTx);
    app.post(
      '/create-tx',
      deps.rateLimit.publicCreateTxLimiter,
      corsCreateTx,
      express.json({ limit: JSON_LIMIT }),
      (req, res) => deps.publicCtrl.createTx(req, res),
    );

    app.get(
      '/api/v1/stores/:storeId/public-profile',
      deps.rateLimit.publicProfileLimiter,
      corsPublicProfile,
      // Guarantee ACAO on GET (fallback if CORS layer didn’t set it)
      (req, res, next) => {
        if (!res.getHeader('Access-Control-Allow-Origin')) {
          res.setHeader('Access-Control-Allow-Origin', '*');
        }
        next();
      },
      (req, res) => deps.publicCtrl.getStorePublicProfile(req, res),
    );

    app.options('/api/v1/stores/:storeId/public-profile', corsPublicProfile);

    // Merchant-scoped routes
    const auth = (req: any, res: any, next: any) => deps.storeAuth.verifyApiKey(req, res, next);
    const mask = (req: any, res: any, next: any) => deps.crossTenantMask.enforce(req, res, next);

    // NEW: one-shot “prepare invoice” that returns invoice + unsigned tx + deeplink
    app.post(
      '/api/v1/stores/:storeId/prepare-invoice',
      auth,                  // ← merchant API key
      mask,                  // ← cross-tenant guard
      deps.rateLimit.createInvoiceLimiter,
      express.json({ limit: JSON_LIMIT }),
      (req, res) => deps.merchantCtrl.prepareInvoice(req, res),  // ← new action
    );


    app.post(
      '/api/v1/stores/:storeId/invoices',
      auth,
      mask,
      deps.rateLimit.createInvoiceLimiter,
      express.json({ limit: JSON_LIMIT }),
      (req, res) => deps.merchantCtrl.createInvoice(req, res),
    );

    app.get(
      '/api/v1/stores/:storeId/invoices',
      auth,
      mask,
      (req, res) => deps.merchantCtrl.listInvoices(req, res),
    );

    app.get(
      '/api/v1/stores/:storeId/invoices/:invoiceId',
      auth,
      mask,
      (req, res) => deps.merchantCtrl.getInvoice(req, res),
    );

    app.post(
      '/api/v1/stores/:storeId/invoices/:invoiceId/cancel',
      auth,
      mask,
      (req, res) => deps.merchantCtrl.cancelInvoice(req, res),
    );

    // Builder first (test tries this one initially)
    app.post(
      '/api/v1/stores/:storeId/invoices/:invoiceId/cancel/create-tx',
      auth, mask,
      (req, res) => deps.merchantCtrl.cancelInvoiceCreateTx(req, res),
    );

    app.post(
      '/api/v1/stores/:storeId/refunds',
      auth,
      mask,
      express.json({ limit: JSON_LIMIT }),
      (req, res) => deps.merchantCtrl.buildRefund(req, res),
    );

    app.post(
      '/api/v1/stores/:storeId/refunds/create-tx',
      auth, mask,
      deps.rateLimit.createInvoiceLimiter,
      express.json({ limit: JSON_LIMIT }),
      (req, res) => deps.merchantCtrl.buildRefundTx(req, res),
    );

    app.get(
      '/api/v1/stores/:storeId/webhooks',
      auth,
      mask,
      (req, res) => deps.merchantCtrl.listWebhooks(req, res),
    );

    app.get(
      '/api/v1/stores/:storeId/profile',
      auth,
      mask,
      (req, res) => deps.merchantCtrl.getStoreProfile(req, res),
    );

    app.patch(
      '/api/v1/stores/:storeId/profile',
      auth,
      mask,
      express.json({ limit: JSON_LIMIT }),
      (req, res) => deps.merchantCtrl.updateStoreProfile(req, res),
    );

    app.post(
      '/api/v1/stores/:storeId/rotate-keys',
      auth,
      mask,
      (req, res) => deps.merchantCtrl.rotateKeys(req, res),
    );

    app.post(
      '/api/v1/stores/:storeId/subscriptions',
      auth,
      mask,
      express.json({ limit: JSON_LIMIT }),
      (req, res) => deps.merchantCtrl.createSubscription(req, res),
    );

    app.post(
      '/api/v1/stores/:storeId/subscriptions/:id/invoice',
      auth,
      mask,
      deps.rateLimit.subInvoiceLimiter,
      express.json({ limit: JSON_LIMIT }),
      (req, res) => deps.merchantCtrl.genSubscriptionInvoice(req, res),
    );

    app.post(
      '/api/v1/stores/:storeId/subscriptions/:id/mode',
      auth,
      mask,
      express.json({ limit: JSON_LIMIT }),
      (req, res) => deps.merchantCtrl.setSubscriptionMode(req, res),
    );

    app.post(
      '/api/v1/stores/:storeId/subscriptions/:id/cancel',
      auth,
      mask,
      express.json({ limit: JSON_LIMIT }),
      (req, res) => deps.merchantCtrl.cancelSubscription(req, res),
    );

    app.post(
      '/api/v1/stores/:storeId/subscriptions/:id/create-tx',
      auth,
      mask,
      express.json({ limit: JSON_LIMIT }),
      (req, res) => deps.merchantCtrl.buildDirectSubscriptionPaymentTx(req, res),
    );

    // Admin API
    const adminGuard = (req: any, res: any, next: any) =>
      deps.adminAuth.authenticateAdmin(req, res, next);

    app.post('/api/admin/bootstrap', adminGuard, (req, res) =>
      deps.adminCtrl.bootstrapAdmin(req, res)
    );
    app.get('/api/admin/invoices', adminGuard, (req, res) => deps.adminCtrl.listInvoices(req, res));


    // LIST stores (missing → adds support for test 55)
    app.get(
      '/api/admin/stores',
      adminGuard,
      (req, res) => deps.adminCtrl.listStores(req, res),
    );

    // CREATE store (keep a single registration)
    app.post(
      '/api/admin/stores',
      express.json({ limit: JSON_LIMIT }),
      adminGuard,
      (req, res) => deps.adminCtrl.createStore(req, res),
    );

    app.patch(
      '/api/admin/stores/:storeId/activate',
      adminGuard,
      express.json({ limit: JSON_LIMIT }),
      (req, res) => deps.adminCtrl.activateStore(req, res),
    );

    app.post(
      '/api/admin/stores/:storeId/rotate-keys',
      adminGuard,
      (req, res) => deps.adminCtrl.rotateKeys(req, res),
    );

    app.post(
      '/api/admin/stores/:storeId/sync-onchain',
      adminGuard,
      (req, res) => deps.adminCtrl.syncOnchain(req, res),
    );

    app.post(
      '/api/admin/set-sbtc-token',
      adminGuard,
      express.json({ limit: JSON_LIMIT }),
      (req, res) => deps.adminCtrl.setSbtcToken(req, res),
    );

    app.get('/api/admin/poller', adminGuard, (req, res) => deps.adminCtrl.getPoller(req, res));

    app.post(
      '/api/admin/poller/restart',
      adminGuard,
      (req, res) => deps.adminCtrl.restartPoller(req, res),
    );

    app.get(
      '/api/admin/webhooks',
      adminGuard,
      (req, res) => deps.adminCtrl.listWebhooks(req, res),
    );

    app.post(
      '/api/admin/webhooks/retry',
      adminGuard,
      express.json({ limit: JSON_LIMIT }),
      (req, res) => deps.adminCtrl.retryWebhook(req, res),
    );

    app.post(
      '/api/admin/invoices/:invoiceId/cancel',
      adminGuard,
      (req, res) => deps.adminCtrl.cancelInvoice(req, res),
    );

    // Admin SPA (static + index) — safe if directory missing (middleware no-ops)
    this.mountAdminStatic(app, deps.adminAuth, deps.staticServer.serveStatic());
    this.mountAdminIndex(app, deps.adminAuth, (req, res) => deps.staticServer.serveIndex(req, res));

    // Health/root
    this.mountRoot(app, deps.healthCtrl);
  }

  async start(deps: {
    app: Express;
    poller: PaymentPoller;
    webhookRetry: WebhookRetryScheduler;
    subscriptionScheduler?: SubscriptionScheduler;
    config: IConfigService;
  }): Promise<void> {
    await this.schedulerCoordinator.startSchedulers({
      poller: deps.poller,
      webhookRetry: deps.webhookRetry,
      subscriptionScheduler: deps.subscriptionScheduler,
      config: deps.config,
    });
  }
}
