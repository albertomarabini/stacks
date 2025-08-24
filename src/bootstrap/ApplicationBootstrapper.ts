// src/bootstrap/ApplicationBootstrapper.ts
import path from 'path';
import express from 'express';

import { ConfigService } from '/src/config/ConfigService';
import { openDatabaseAndMigrate } from '/src/db/SqliteStore';
import { InvoiceIdCodec } from '/src/utils/InvoiceIdCodec';
import { PricingCache } from '/src/services/PricingCache';
import { PricingService } from '/src/services/PricingService';
import { AssetInfoFactory } from '/src/factories/AssetInfoFactory';
import { PostConditionFactory } from '/src/factories/PostConditionFactory';
import { StacksChainClient } from '/src/clients/StacksChainClient';
import { ContractCallBuilder } from '/src/builders/ContractCallBuilder';
import { WebhookRetryScheduler } from '/src/webhooks/WebhookRetryScheduler';
import { WebhookDispatcher } from '/src/webhooks/WebhookDispatcher';
import { ExpirationMonitor } from '/src/services/ExpirationMonitor';
import { PaymentPoller } from '/src/poller/PaymentPoller';
import { PollerAdminBridge } from '/src/poller/PollerAdminBridge';
import { SubscriptionScheduler } from '/src/schedulers/SubscriptionScheduler';
import { AdminAuth } from '/src/middleware/AdminAuth';
import { StoreApiAuth } from '/src/middleware/StoreApiAuth';
import { CrossTenantMask } from '/src/middleware/CrossTenantMask';
import { CorsPolicy } from '/src/middleware/CorsPolicy';
import { RateLimitPolicy } from '/src/middleware/RateLimitPolicy';
import { InvoiceService } from '/src/services/InvoiceService';
import { RefundService } from '/src/services/RefundService';
import { SubscriptionService } from '/src/services/SubscriptionService';
import { PublicApiController } from '/src/controllers/PublicApiController';
import { MerchantApiController } from '/src/controllers/MerchantApiController';
import { AdminApiController } from '/src/controllers/AdminApiController';
import { HealthController } from '/src/controllers/HealthController';
import { AdminStaticServer } from '/src/servers/AdminStaticServer';
import { HttpApiServer } from '/src/server/HttpApiServer';
import type { IConfigService } from '/src/contracts/interfaces';

export class ApplicationBootstrapper {
  public async boot(): Promise<void> {
    // 1) Config
    const cfg = new ConfigService();

    // 2) Database
    const dbPath = process.env.DB_PATH ? String(process.env.DB_PATH) : path.join(process.cwd(), 'data.sqlite');
    const store = openDatabaseAndMigrate(dbPath);

    // 3) Core helpers/services
    const codec = new InvoiceIdCodec();

    const priceTtlMs = Number(process.env.PRICE_TTL_MS ?? 60_000);
    const pricingCache = new PricingCache(priceTtlMs);
    pricingCache.initCache();

    const pricing = new PricingService();
    pricing.bindDependencies(pricingCache, cfg);

    const aif = new AssetInfoFactory(cfg);
    const pcf = new PostConditionFactory();

    // 4) Chain client
    const chain = new StacksChainClient(cfg);

    // 5) Builder
    const builder = new ContractCallBuilder(cfg, aif, pcf, codec);

    // 6) Webhooks/schedulers/poller
    const webhookRetry = new WebhookRetryScheduler();
    const dispatcher = new WebhookDispatcher();
    dispatcher.initCaches();
    dispatcher.bindStoreAndScheduler(store as any, webhookRetry as any);
    webhookRetry.bindDependencies(store as any, dispatcher as any);

    const expirations = new ExpirationMonitor();

    const poller = new PaymentPoller();
    poller.bindDependencies(chain as any, store as any, dispatcher as any, expirations, cfg as IConfigService);

    const pollerBridge = new PollerAdminBridge();
    pollerBridge.bindPoller(poller);

    const subScheduler = new SubscriptionScheduler();
    subScheduler.bindDependencies({
      chain: chain as any,
      builder,
      store: store as any,
      pricing,
      cfg: cfg as IConfigService,
      dispatcher: dispatcher as any,
      codec,
    });

    // 7) Middlewares/policies
    const adminAuth = new AdminAuth();
    adminAuth.bindCredentialsFromEnv(cfg);

    const storeAuth = new StoreApiAuth();
    storeAuth.bindStore(store as any);

    const crossTenant = new CrossTenantMask();

    const corsPolicy = new CorsPolicy();
    corsPolicy.bindStore(store as any);

    const rateLimit = new RateLimitPolicy();
    rateLimit.initLimiters();

    // 8) Domain services
    const invService = new InvoiceService();
    invService.bindDependencies({
      store: store as any,
      chain: chain as any,
      builder,
      cfg: cfg as IConfigService,
      pricing,
      codec,
    });

    const refundService = new RefundService();
    refundService.bindDependencies({
      chain: chain as any,
      builder,
      pcf,
      aif,
      codec,
      cfg: cfg as IConfigService,
    });

    const subsService = new SubscriptionService();
    subsService.bindDependencies({
      store: store as any,
      builder,
      chain: chain as any,
      cfg: cfg as IConfigService,
      codec,
      pricing,
    });

    // 9) Controllers/static server
    const publicCtrl = new PublicApiController();
    publicCtrl.bindDependencies({
      store: store as any,
      chain: chain as any,
      builder,
      aif,
      cfg: cfg as IConfigService,
      codec,
    });
    publicCtrl.bindCorsPolicy(corsPolicy as any);

    const merchantCtrl = new MerchantApiController();
    merchantCtrl.bindDependencies({
      store: store as any,
      chain: chain as any,
      builder,
      pricing,
      cfg: cfg as IConfigService,
      codec,
      subs: subsService,
      inv: invService,
      refund: refundService,
    });

    const adminCtrl = new AdminApiController();
    adminCtrl.bindDependencies({
      store: store as any,
      chain: chain as any,
      builder,
      dispatcher: dispatcher as any,
      pollerBridge,
    });

    const healthCtrl = new HealthController();

    const staticServer = new AdminStaticServer();
    const adminStaticRoot = process.env.ADMIN_STATIC_DIR
      ? String(process.env.ADMIN_STATIC_DIR)
      : path.join(process.cwd(), 'admin');
    staticServer.configureStaticDir(adminStaticRoot);

    // 10) HTTP composition
    const app = express();
    const httpServer = new HttpApiServer();
    httpServer.composeRoutesAndMiddleware(app, {
      publicCtrl,
      merchantCtrl,
      adminCtrl,
      healthCtrl,
      adminAuth,
      storeAuth,
      crossTenantMask: crossTenant,
      rateLimit,
      corsPolicy,
      staticServer,
      webhookVerifier: dispatcher.verifyWebhookSignature.bind(dispatcher),
    });

    // 11) Start schedulers/poller
    await poller.startPoller();
    await httpServer.start({
      app,
      poller,
      webhookRetry,
      subscriptionScheduler: subScheduler,
      config: cfg as IConfigService,
    });

    // 12) Listen
    const port = Number(process.env.PORT ?? 3000);
    app.listen(port, () => {
      // give a simple stdout hint so the developer knows the server bound successfully
      // and can open the browser — helpful when running via ts-node
      // eslint-disable-next-line no-console
      console.log(`Server listening on http://localhost:${port}`);
    });
  }
}
