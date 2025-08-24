// src/server/HttpApiServer.ts
import express, { Express, RequestHandler } from 'express';
import { PublicApiController } from '/src/controllers/PublicApiController';
import { MerchantApiController } from '/src/controllers/MerchantApiController';
import { AdminApiController } from '/src/controllers/AdminApiController';
import { HealthController } from '/src/controllers/HealthController';
import { AdminAuth } from '/src/middleware/AdminAuth';
import { StoreApiAuth } from '/src/middleware/StoreApiAuth';
import { CrossTenantMask } from '/src/middleware/CrossTenantMask';
import { RateLimitPolicy } from '/src/middleware/RateLimitPolicy';
import { CorsPolicy } from '/src/middleware/CorsPolicy';
import { AdminStaticServer } from '/src/servers/AdminStaticServer';
import { PaymentPoller } from '/src/poller/PaymentPoller';
import { WebhookRetryScheduler } from '/src/webhooks/WebhookRetryScheduler';
import { SubscriptionScheduler } from '/src/schedulers/SubscriptionScheduler';
import { AdminSurfaceBinder } from '/src/delegates/AdminSurfaceBinder';
import { WebhookInboundSurfaceBinder } from '/src/delegates/WebhookInboundSurfaceBinder';
import { RootRouteBinder } from '/src/delegates/RootRouteBinder';
import { SchedulerStartupCoordinator } from '/src/delegates/SchedulerStartupCoordinator';
import { CorsMiddlewareFactory } from '/src/delegates/CorsMiddlewareFactory';
import type { IConfigService } from '/src/contracts/interfaces';

type AdminGuard = { authenticateAdmin(req: any, res: any, next: any): void };

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
    staticServer: AdminStaticServer;
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
      express.json(),
      (req, res) => deps.publicCtrl.createTx(req, res),
    );

    app.options('/api/v1/stores/:storeId/public-profile', corsPublicProfile);
    app.get(
      '/api/v1/stores/:storeId/public-profile',
      deps.rateLimit.publicProfileLimiter,
      corsPublicProfile,
      (req, res) => deps.publicCtrl.getStorePublicProfile(req, res),
    );

    // Merchant-scoped routes
    const auth = (req: any, res: any, next: any) => deps.storeAuth.verifyApiKey(req, res, next);
    const mask = (req: any, res: any, next: any) => deps.crossTenantMask.enforce(req, res, next);

    app.post(
      '/api/v1/stores/:storeId/invoices',
      auth,
      mask,
      deps.rateLimit.createInvoiceLimiter,
      express.json(),
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

    app.post(
      '/api/v1/stores/:storeId/refunds',
      auth,
      mask,
      express.json(),
      (req, res) => deps.merchantCtrl.buildRefund(req, res),
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
      express.json(),
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
      express.json(),
      (req, res) => deps.merchantCtrl.createSubscription(req, res),
    );

    app.post(
      '/api/v1/stores/:storeId/subscriptions/:id/invoice',
      auth,
      mask,
      deps.rateLimit.subInvoiceLimiter,
      express.json(),
      (req, res) => deps.merchantCtrl.genSubscriptionInvoice(req, res),
    );

    app.post(
      '/api/v1/stores/:storeId/subscriptions/:id/mode',
      auth,
      mask,
      express.json(),
      (req, res) => deps.merchantCtrl.setSubscriptionMode(req, res),
    );

    app.post(
      '/api/v1/stores/:storeId/subscriptions/:id/cancel',
      auth,
      mask,
      express.json(),
      (req, res) => deps.merchantCtrl.cancelSubscription(req, res),
    );

    app.post(
      '/api/v1/stores/:storeId/subscriptions/:id/create-tx',
      auth,
      mask,
      express.json(),
      (req, res) => deps.merchantCtrl.buildDirectSubscriptionPaymentTx(req, res),
    );

    // Admin API
    const adminGuard = (req: any, res: any, next: any) =>
      deps.adminAuth.authenticateAdmin(req, res, next);

    app.get('/api/admin/stores', adminGuard, (req, res) => deps.adminCtrl.listStores(req, res));

    app.post(
      '/api/admin/stores',
      adminGuard,
      express.json(),
      (req, res) => deps.adminCtrl.createStore(req, res),
    );

    app.patch(
      '/api/admin/stores/:storeId/activate',
      adminGuard,
      express.json(),
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
      express.json(),
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
      express.json(),
      (req, res) => deps.adminCtrl.retryWebhook(req, res),
    );

    app.post(
      '/api/admin/invoices/:invoiceId/cancel',
      adminGuard,
      (req, res) => deps.adminCtrl.cancelInvoice(req, res),
    );

    // Admin SPA (static + index)
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
