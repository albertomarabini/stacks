// src/bootstrap/ApplicationBootstrapper.ts
import path from 'path';
import express, { Express } from 'express';
import 'dotenv/config';

process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] unhandledRejection:', reason);
});

import { ConfigService } from '../config/ConfigService';
import { openDatabaseAndMigrate } from '../db/SqliteStore';
import { InvoiceIdCodec } from '../utils/InvoiceIdCodec';
import { PricingCache } from '../services/PricingCache';
import { PricingService } from '../services/PricingService';
import { AssetInfoFactory } from '../factories/AssetInfoFactory';
import { PostConditionFactory } from '../factories/PostConditionFactory';
import { StacksChainClient } from '../clients/StacksChainClient';
import { ContractCallBuilder } from '../builders/ContractCallBuilder';
import { WebhookRetryScheduler } from '../webhooks/WebhookRetryScheduler';
import { WebhookDispatcher } from '../webhooks/WebhookDispatcher';
import { ExpirationMonitor } from '../services/ExpirationMonitor';
import { PaymentPoller } from '../poller/PaymentPoller';
import { PollerAdminBridge } from '../poller/PollerAdminBridge';
import { SubscriptionScheduler } from '../schedulers/SubscriptionScheduler';
import { AdminAuth } from '../middleware/AdminAuth';
import { StoreApiAuth } from '../middleware/StoreApiAuth';
import { CrossTenantMask } from '../middleware/CrossTenantMask';
import { CorsPolicy } from '../middleware/CorsPolicy';
import { RateLimitPolicy } from '../middleware/RateLimitPolicy';
import { InvoiceService } from '../services/InvoiceService';
import { RefundService } from '../services/RefundService';
import { SubscriptionService } from '../services/SubscriptionService';
import { PublicApiController } from '../controllers/PublicApiController';
import { MerchantApiController } from '../controllers/MerchantApiController';
import { AdminApiController } from '../controllers/AdminApiController';
import { HealthController } from '../controllers/HealthController';
import { AdminStaticServer } from '../servers/AdminStaticServer';
import { HttpApiServer } from '../server/HttpApiServer';
import type { IConfigService } from '../contracts/interfaces';

// ✅ import the address helper by name (no default-destructure)
import { getAddressFromPrivateKey } from '@stacks/transactions';
// Support both ESM and CJS shapes for @stacks/network
import * as stacksNetworkPkg from '@stacks/network';
const Net = (stacksNetworkPkg as any).default ?? stacksNetworkPkg;
const { networkFromName, clientFromNetwork } = Net;

function log(step: string, msg: string) {
  console.log(`[BOOT:${step}] ${msg}`);
}
const mask = (s?: string) =>
  typeof s === 'string' && s.length > 10 ? `${s.slice(0, 10)}…[${s.length}b]` : String(s ?? '');

function env(k: string) {
  return process.env[k];
}
function cleanHexPk(s?: string) {
  if (!s) return '';
  return s.replace(/^0x/i, '');
}
/**
 * Derive & log an address from a secret key if present.
 * Accepts 64/66-hex (trailing '01' compressed ok) and trims to 64 for derivation.
 * Uses network NAME (mainnet|testnet|devnet|mocknet), which is what stacks.js expects.
 */
function logAddrIfPresent(label: string, skRaw: string | undefined, netName: string) {
  if (!skRaw) return;
  try {
    const sk = cleanHexPk(skRaw);
    const addr = getAddressFromPrivateKey(sk.slice(0, 64), netName as any);
    log('ADDR', `${label}=${addr} (from ${mask(sk)})`);
  } catch (e) {
    log('ADDR', `${label}=<failed to derive> (${(e as Error)?.message || e})`);
  }
}

export class ApplicationBootstrapper {
  private serverRef: import('http').Server | null = null;
  private async waitFor<T>(fn: () => Promise<T | undefined>, ok: (v: T) => boolean, ms = 15000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try {
        const v = await fn();
        if (v && ok(v)) return v;
      } catch {/* best-effort; keep polling */ }
      await new Promise(r => setTimeout(r, 400));
    }
    throw new Error('timeout waiting for on-chain state');
  }

  public async boot(): Promise<void> {
    log('START', 'starting…');

    // 1) Config
    const cfg = new ConfigService();
    const netName = cfg.getNetwork(); // 'mainnet' | 'testnet' | 'devnet' | 'mocknet'
    const { contractAddress, contractName } = cfg.getContractId();
    const poll = cfg.getPollingConfig();
    const avgBlockSecs = cfg.getAvgBlockSecs();

    // Try to surface the effective Stacks API base URL if available via @stacks/network helpers
    let stacksApiBase = env('STACKS_API_URL') || '';
    try {
      const n = networkFromName(netName);
      const client = clientFromNetwork(n);
      stacksApiBase = (client && (client.baseUrl || client.coreApiUrl)) || stacksApiBase || '';
    } catch {
      /* non-fatal */
    }

    log('CONFIG', `network=${netName}`);
    log('CONFIG', `stacksApi=${stacksApiBase || '<unset>'}`);
    log('CONFIG', `paymentContract=${contractAddress || '?'}.${contractName || '?'}`);

    // sBTC token (if preconfigured via env)
    if (env('SBTC_CONTRACT_ADDRESS') && env('SBTC_CONTRACT_NAME')) {
      log(
        'CONFIG',
        `sbtcToken=${env('SBTC_CONTRACT_ADDRESS')}.${env('SBTC_CONTRACT_NAME')}`
      );
    } else {
      log('CONFIG', 'sbtcToken=<unset> (admin must call set-sbtc-token)');
    }

    // Broadcast/poller knobs
    log(
      'CONFIG',
      `confirmations=${poll.minConfirmations} reorgWindow=${poll.reorgWindowBlocks} pollInterval=${poll.pollIntervalSecs}s avgBlockSecs=${avgBlockSecs}`
    );
    log('CONFIG', `AUTO_BOOTSTRAP_ADMIN=${env('AUTO_BOOTSTRAP_ADMIN') ?? 'false'} GLOBAL_DEBUGGING=${env('GLOBAL_DEBUGGING') ?? '0'}`);

    // Derive & log addresses from any provided secret keys (purely for debugging)
    logAddrIfPresent('ADMIN_SECRET_KEY', env('ADMIN_SECRET_KEY'), netName);
    logAddrIfPresent('MERCHANT_SECRET_KEY', env('MERCHANT_SECRET_KEY'), netName);
    logAddrIfPresent('PAYER_SECRET_KEY', env('PAYER_SECRET_KEY'), netName);
    // Server signer (used only if AUTO_BOOTSTRAP_ADMIN=true)
    logAddrIfPresent('SIGNER_PRIVATE_KEY', env('SIGNER_PRIVATE_KEY'), netName);

    // 2) Database
    const dbPath = env('DB_PATH') ? String(env('DB_PATH')) : path.join(process.cwd(), 'data.sqlite');
    log('DB', `opening sqlite at ${dbPath}`);
    const store = openDatabaseAndMigrate(dbPath);
    log('DB', 'migrations up-to-date');

    // 3) Core helpers/services
    const codec = new InvoiceIdCodec();
    const corsPolicy = new CorsPolicy();
    corsPolicy.bindStore(store);

    const priceTtlMs = Number(env('PRICE_TTL_MS') ?? 60_000);
    const pricingCache = new PricingCache(priceTtlMs);
    pricingCache.initCache();
    log('PRICING', `cache TTL = ${priceTtlMs}ms`);

    const pricing = new PricingService();
    pricing.bindDependencies(pricingCache, cfg);

    const aif = new AssetInfoFactory(cfg);
    const pcf = new PostConditionFactory();

    // 4) Chain client
    const chain = new StacksChainClient(cfg);
    log('CHAIN', 'StacksChainClient initialized');

    // 5) Builder
    const builder = new ContractCallBuilder(cfg, aif, pcf, codec);
    log('BUILDER', 'ContractCallBuilder ready');

    // 6) Webhooks / schedulers / poller
    const webhookRetry = new WebhookRetryScheduler();
    const dispatcher = new WebhookDispatcher();
    dispatcher.initCaches();
    dispatcher.bindStoreAndScheduler(store as any, webhookRetry as any);
    webhookRetry.bindDependencies(store as any, dispatcher as any);
    log('WEBHOOK', 'dispatcher + retry scheduler wired');

    const expirations = new ExpirationMonitor();

    const poller = new PaymentPoller();
    poller.bindDependencies(
      chain as any,
      store as any,
      dispatcher as any,
      expirations,
      cfg as IConfigService
    );
    log('POLLER', 'PaymentPoller bound to deps');

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
    log('SCHED', 'SubscriptionScheduler wired');

    // 7) Middlewares/policies
    const adminAuth = new AdminAuth();
    adminAuth.bindCredentialsFromEnv(cfg);

    const storeAuth = new StoreApiAuth();
    storeAuth.bindStore(store as any);

    const crossTenant = new CrossTenantMask();

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
    log('DOMAIN', 'Invoice/Refund/Subscription services bound');

    // 9) Controllers / static server
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
      aif,
    });

    const adminCtrl = new AdminApiController();
    adminCtrl.bindDependencies({
      store: store as any,
      chain: chain as any,
      builder,
      dispatcher: dispatcher as any,
      pollerBridge,
      cfg: cfg as IConfigService,
    });


    if (process.env.AUTO_BOOTSTRAP_ADMIN === '1' && process.env.SIGNER_PRIVATE_KEY) {
      try {
        // 1) Admin
        const adminNow = await chain.readAdminPrincipal();
        if (!adminNow) {
          const unsigned = builder.buildBootstrapAdmin();
          await chain.signAndBroadcast(unsigned, env('SIGNER_PRIVATE_KEY')!);
          await this.waitFor(() => chain.readAdminPrincipal(), v => !!v);
          log('BOOTSTRAP', 'on-chain admin set');
        }

        // 2) sBTC token
        const sbtc = await chain.readSbtcToken();
        if (!sbtc && env('SBTC_CONTRACT_ADDRESS') && env('SBTC_CONTRACT_NAME')) {
          const unsigned = builder.buildSetSbtcToken({
            contractAddress: env('SBTC_CONTRACT_ADDRESS')!,
            contractName: env('SBTC_CONTRACT_NAME')!,
          });
          await chain.signAndBroadcast(unsigned, env('SIGNER_PRIVATE_KEY')!);
          await this.waitFor(() => chain.readSbtcToken(), v => !!v);
          log('BOOTSTRAP', 'sbtc-token configured');
        }
      } catch (e: any) {
        // idempotent safety + visibility if it races
        log('BOOTSTRAP', `skipped or failed: ${e?.message || e}`);
      }
    } else {
      log('BOOTSTRAP', 'skipped (set AUTO_BOOTSTRAP_ADMIN=true and provide SIGNER_PRIVATE_KEY)');
    }

    const healthCtrl = new HealthController();

    const staticServer = new AdminStaticServer();
    const adminStaticRoot = env('ADMIN_STATIC_DIR')
      ? String(env('ADMIN_STATIC_DIR'))
      : path.join(process.cwd(), 'admin');
    staticServer.configureStaticDir(adminStaticRoot);
    log('CTRL', `controllers + static server ready (admin dir: ${adminStaticRoot})`);

    // 10) HTTP composition
    const app: Express = express();
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
    log('HTTP', 'routes and middleware composed');

    // 11) Start schedulers/poller & any server-managed services
    await poller.startPoller();
    log('POLLER', 'started');

    // Some HttpApiServer implementations may already bind a port; we handle that safely.
    await httpServer.start({
      app,
      poller,
      webhookRetry,
      subscriptionScheduler: subScheduler,
      config: cfg as IConfigService,
    });
    log('HTTP', 'HttpApiServer.start completed');

    // 12) Listen (single authoritative binding with EADDRINUSE fallback)
    const port = Number(env('PORT') ?? 3000);
    const host = env('HOST') ?? '0.0.0.0';

    await this.listenWithFallback(app, port, host);

    log('READY', 'service is up');
  }

  private async listenWithFallback(app: Express, port: number, host: string): Promise<void> {
    try {
      this.serverRef = await new Promise<import('http').Server>((resolve, reject) => {
        const srv = app
          .listen(port, host, () => {
            log('HTTP', `listening on http://${host}:${port}`);
            resolve(srv);
          })
          .on('error', (err: any) => reject(err));
      });
      this.installShutdownHooks();
    } catch (err: any) {
      if (err && err.code === 'EADDRINUSE') {
        log(
          'HTTP',
          `port ${port} already in use — assuming HttpApiServer already bound the port; skipping app.listen`
        );
        this.installShutdownHooks();
        return;
      }
      throw err;
    }
  }

  private installShutdownHooks() {
    const shutdown = async (signal: string) => {
      log('SHUTDOWN', `received ${signal}, closing…`);
      try {
        if (this.serverRef) {
          await new Promise<void>((resolve) => this.serverRef!.close(() => resolve()));
          log('SHUTDOWN', 'HTTP server closed');
        }
      } catch (e) {
        console.error('[SHUTDOWN] error while closing HTTP server:', e);
      } finally {
        process.exit(0);
      }
    };

    (['SIGINT', 'SIGTERM'] as NodeJS.Signals[]).forEach((sig) => {
      process.on(sig, () => void shutdown(sig));
    });
  }
}

// run when executed directly
(async () => {
  try {
    await new ApplicationBootstrapper().boot();
    log('DONE', 'ready');
  } catch (e) {
    console.error('[BOOT] failed:', e);
    process.exit(1);
  }
})();
