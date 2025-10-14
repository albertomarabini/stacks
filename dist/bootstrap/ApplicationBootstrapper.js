"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApplicationBootstrapper = void 0;
// src/bootstrap/ApplicationBootstrapper.ts
const path_1 = __importDefault(require("path"));
const express_1 = __importDefault(require("express"));
require("dotenv/config");
process.on('uncaughtException', (err) => {
    console.error('[FATAL] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('[FATAL] unhandledRejection:', reason);
});
const ConfigService_1 = require("../config/ConfigService");
const SqliteStore_1 = require("../db/SqliteStore");
const InvoiceIdCodec_1 = require("../utils/InvoiceIdCodec");
const PricingCache_1 = require("../services/PricingCache");
const PricingService_1 = require("../services/PricingService");
const AssetInfoFactory_1 = require("../factories/AssetInfoFactory");
const PostConditionFactory_1 = require("../factories/PostConditionFactory");
const StacksChainClient_1 = require("../clients/StacksChainClient");
const ContractCallBuilder_1 = require("../builders/ContractCallBuilder");
const WebhookRetryScheduler_1 = require("../webhooks/WebhookRetryScheduler");
const WebhookDispatcher_1 = require("../webhooks/WebhookDispatcher");
const ExpirationMonitor_1 = require("../services/ExpirationMonitor");
const PaymentPoller_1 = require("../poller/PaymentPoller");
const PollerAdminBridge_1 = require("../poller/PollerAdminBridge");
const SubscriptionScheduler_1 = require("../schedulers/SubscriptionScheduler");
const AdminAuth_1 = require("../middleware/AdminAuth");
const StoreApiAuth_1 = require("../middleware/StoreApiAuth");
const CrossTenantMask_1 = require("../middleware/CrossTenantMask");
const CorsPolicy_1 = require("../middleware/CorsPolicy");
const RateLimitPolicy_1 = require("../middleware/RateLimitPolicy");
const InvoiceService_1 = require("../services/InvoiceService");
const RefundService_1 = require("../services/RefundService");
const SubscriptionService_1 = require("../services/SubscriptionService");
const PublicApiController_1 = require("../controllers/PublicApiController");
const MerchantApiController_1 = require("../controllers/MerchantApiController");
const AdminApiController_1 = require("../controllers/AdminApiController");
const HealthController_1 = require("../controllers/HealthController");
const AdminStaticServer_1 = require("../servers/AdminStaticServer");
const HttpApiServer_1 = require("../server/HttpApiServer");
// ✅ import the address helper by name (no default-destructure)
const transactions_1 = require("@stacks/transactions");
// Support both ESM and CJS shapes for @stacks/network
const stacksNetworkPkg = __importStar(require("@stacks/network"));
const Net = stacksNetworkPkg.default ?? stacksNetworkPkg;
const { networkFromName, clientFromNetwork } = Net;
function log(step, msg) {
    console.log(`[BOOT:${step}] ${msg}`);
}
const mask = (s) => typeof s === 'string' && s.length > 10 ? `${s.slice(0, 10)}…[${s.length}b]` : String(s ?? '');
function env(k) {
    return process.env[k];
}
function cleanHexPk(s) {
    if (!s)
        return '';
    return s.replace(/^0x/i, '');
}
/**
 * Derive & log an address from a secret key if present.
 * Accepts 64/66-hex (trailing '01' compressed ok) and trims to 64 for derivation.
 * Uses network NAME (mainnet|testnet|devnet|mocknet), which is what stacks.js expects.
 */
function logAddrIfPresent(label, skRaw, netName) {
    if (!skRaw)
        return;
    try {
        const sk = cleanHexPk(skRaw);
        const addr = (0, transactions_1.getAddressFromPrivateKey)(sk.slice(0, 64), netName);
        log('ADDR', `${label}=${addr} (from ${mask(sk)})`);
    }
    catch (e) {
        log('ADDR', `${label}=<failed to derive> (${e?.message || e})`);
    }
}
class ApplicationBootstrapper {
    constructor() {
        this.serverRef = null;
    }
    async waitFor(fn, ok, ms = 15000) {
        const end = Date.now() + ms;
        while (Date.now() < end) {
            try {
                const v = await fn();
                if (v && ok(v))
                    return v;
            }
            catch { /* best-effort; keep polling */ }
            await new Promise(r => setTimeout(r, 400));
        }
        throw new Error('timeout waiting for on-chain state');
    }
    async boot() {
        log('START', 'starting…');
        // 1) Config
        const cfg = new ConfigService_1.ConfigService();
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
        }
        catch {
            /* non-fatal */
        }
        log('CONFIG', `network=${netName}`);
        log('CONFIG', `stacksApi=${stacksApiBase || '<unset>'}`);
        log('CONFIG', `paymentContract=${contractAddress || '?'}.${contractName || '?'}`);
        // sBTC token (if preconfigured via env)
        if (env('SBTC_CONTRACT_ADDRESS') && env('SBTC_CONTRACT_NAME')) {
            log('CONFIG', `sbtcToken=${env('SBTC_CONTRACT_ADDRESS')}.${env('SBTC_CONTRACT_NAME')}`);
        }
        else {
            log('CONFIG', 'sbtcToken=<unset> (admin must call set-sbtc-token)');
        }
        // Broadcast/poller knobs
        log('CONFIG', `confirmations=${poll.minConfirmations} reorgWindow=${poll.reorgWindowBlocks} pollInterval=${poll.pollIntervalSecs}s avgBlockSecs=${avgBlockSecs}`);
        log('CONFIG', `AUTO_BOOTSTRAP_ADMIN=${env('AUTO_BOOTSTRAP_ADMIN') ?? 'false'} GLOBAL_DEBUGGING=${env('GLOBAL_DEBUGGING') ?? '0'}`);
        // Derive & log addresses from any provided secret keys (purely for debugging)
        logAddrIfPresent('ADMIN_SECRET_KEY', env('ADMIN_SECRET_KEY'), netName);
        logAddrIfPresent('MERCHANT_SECRET_KEY', env('MERCHANT_SECRET_KEY'), netName);
        logAddrIfPresent('PAYER_SECRET_KEY', env('PAYER_SECRET_KEY'), netName);
        // Server signer (used only if AUTO_BOOTSTRAP_ADMIN=true)
        logAddrIfPresent('SIGNER_PRIVATE_KEY', env('SIGNER_PRIVATE_KEY'), netName);
        // 2) Database
        const dbPath = env('DB_PATH') ? String(env('DB_PATH')) : path_1.default.join(process.cwd(), 'data.sqlite');
        log('DB', `opening sqlite at ${dbPath}`);
        const store = (0, SqliteStore_1.openDatabaseAndMigrate)(dbPath);
        log('DB', 'migrations up-to-date');
        // 3) Core helpers/services
        const codec = new InvoiceIdCodec_1.InvoiceIdCodec();
        const corsPolicy = new CorsPolicy_1.CorsPolicy();
        corsPolicy.bindStore(store);
        const priceTtlMs = Number(env('PRICE_TTL_MS') ?? 60000);
        const pricingCache = new PricingCache_1.PricingCache(priceTtlMs);
        pricingCache.initCache();
        log('PRICING', `cache TTL = ${priceTtlMs}ms`);
        const pricing = new PricingService_1.PricingService();
        pricing.bindDependencies(pricingCache, cfg);
        const aif = new AssetInfoFactory_1.AssetInfoFactory(cfg);
        const pcf = new PostConditionFactory_1.PostConditionFactory();
        // 4) Chain client
        const chain = new StacksChainClient_1.StacksChainClient(cfg);
        log('CHAIN', 'StacksChainClient initialized');
        // 5) Builder
        const builder = new ContractCallBuilder_1.ContractCallBuilder(cfg, aif, pcf, codec);
        log('BUILDER', 'ContractCallBuilder ready');
        // 6) Webhooks / schedulers / poller
        const webhookRetry = new WebhookRetryScheduler_1.WebhookRetryScheduler();
        const dispatcher = new WebhookDispatcher_1.WebhookDispatcher();
        dispatcher.initCaches();
        dispatcher.bindStoreAndScheduler(store, webhookRetry);
        webhookRetry.bindDependencies(store, dispatcher);
        log('WEBHOOK', 'dispatcher + retry scheduler wired');
        const expirations = new ExpirationMonitor_1.ExpirationMonitor();
        const poller = new PaymentPoller_1.PaymentPoller();
        poller.bindDependencies(chain, store, dispatcher, expirations, cfg);
        log('POLLER', 'PaymentPoller bound to deps');
        const pollerBridge = new PollerAdminBridge_1.PollerAdminBridge();
        pollerBridge.bindPoller(poller);
        const subScheduler = new SubscriptionScheduler_1.SubscriptionScheduler();
        subScheduler.bindDependencies({
            chain: chain,
            builder,
            store: store,
            pricing,
            cfg: cfg,
            dispatcher: dispatcher,
            codec,
        });
        log('SCHED', 'SubscriptionScheduler wired');
        // 7) Middlewares/policies
        const adminAuth = new AdminAuth_1.AdminAuth();
        adminAuth.bindCredentialsFromEnv(cfg);
        const storeAuth = new StoreApiAuth_1.StoreApiAuth();
        storeAuth.bindStore(store);
        const crossTenant = new CrossTenantMask_1.CrossTenantMask();
        const rateLimit = new RateLimitPolicy_1.RateLimitPolicy();
        rateLimit.initLimiters();
        // 8) Domain services
        const invService = new InvoiceService_1.InvoiceService();
        invService.bindDependencies({
            store: store,
            chain: chain,
            builder,
            cfg: cfg,
            pricing,
            codec,
        });
        const refundService = new RefundService_1.RefundService();
        refundService.bindDependencies({
            chain: chain,
            builder,
            pcf,
            aif,
            codec,
            cfg: cfg,
        });
        const subsService = new SubscriptionService_1.SubscriptionService();
        subsService.bindDependencies({
            store: store,
            builder,
            chain: chain,
            cfg: cfg,
            codec,
            pricing,
        });
        log('DOMAIN', 'Invoice/Refund/Subscription services bound');
        // 9) Controllers / static server
        const publicCtrl = new PublicApiController_1.PublicApiController();
        publicCtrl.bindDependencies({
            store: store,
            chain: chain,
            builder,
            aif,
            cfg: cfg,
            codec,
        });
        publicCtrl.bindCorsPolicy(corsPolicy);
        const merchantCtrl = new MerchantApiController_1.MerchantApiController();
        merchantCtrl.bindDependencies({
            store: store,
            chain: chain,
            builder,
            pricing,
            cfg: cfg,
            codec,
            subs: subsService,
            inv: invService,
            refund: refundService,
            aif,
        });
        const adminCtrl = new AdminApiController_1.AdminApiController();
        adminCtrl.bindDependencies({
            store: store,
            chain: chain,
            builder,
            dispatcher: dispatcher,
            pollerBridge,
            cfg: cfg,
        });
        if (process.env.AUTO_BOOTSTRAP_ADMIN === '1' && process.env.SIGNER_PRIVATE_KEY) {
            try {
                // 1) Admin
                const adminNow = await chain.readAdminPrincipal();
                if (!adminNow) {
                    const unsigned = builder.buildBootstrapAdmin();
                    await chain.signAndBroadcast(unsigned, env('SIGNER_PRIVATE_KEY'));
                    await this.waitFor(() => chain.readAdminPrincipal(), v => !!v);
                    log('BOOTSTRAP', 'on-chain admin set');
                }
                // 2) sBTC token
                const sbtc = await chain.readSbtcToken();
                if (!sbtc && env('SBTC_CONTRACT_ADDRESS') && env('SBTC_CONTRACT_NAME')) {
                    const unsigned = builder.buildSetSbtcToken({
                        contractAddress: env('SBTC_CONTRACT_ADDRESS'),
                        contractName: env('SBTC_CONTRACT_NAME'),
                    });
                    await chain.signAndBroadcast(unsigned, env('SIGNER_PRIVATE_KEY'));
                    await this.waitFor(() => chain.readSbtcToken(), v => !!v);
                    log('BOOTSTRAP', 'sbtc-token configured');
                }
            }
            catch (e) {
                // idempotent safety + visibility if it races
                log('BOOTSTRAP', `skipped or failed: ${e?.message || e}`);
            }
        }
        else {
            log('BOOTSTRAP', 'skipped (set AUTO_BOOTSTRAP_ADMIN=true and provide SIGNER_PRIVATE_KEY)');
        }
        const healthCtrl = new HealthController_1.HealthController();
        const staticServer = new AdminStaticServer_1.AdminStaticServer();
        const adminStaticRoot = env('ADMIN_STATIC_DIR')
            ? String(env('ADMIN_STATIC_DIR'))
            : path_1.default.join(process.cwd(), 'admin');
        staticServer.configureStaticDir(adminStaticRoot);
        log('CTRL', `controllers + static server ready (admin dir: ${adminStaticRoot})`);
        // 10) HTTP composition
        const app = (0, express_1.default)();
        const httpServer = new HttpApiServer_1.HttpApiServer();
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
            config: cfg,
        });
        log('HTTP', 'HttpApiServer.start completed');
        // 12) Listen (single authoritative binding with EADDRINUSE fallback)
        const port = Number(env('PORT') ?? 3000);
        const host = env('HOST') ?? '0.0.0.0';
        await this.listenWithFallback(app, port, host);
        log('READY', 'service is up');
    }
    async listenWithFallback(app, port, host) {
        try {
            this.serverRef = await new Promise((resolve, reject) => {
                const srv = app
                    .listen(port, host, () => {
                    log('HTTP', `listening on http://${host}:${port}`);
                    resolve(srv);
                })
                    .on('error', (err) => reject(err));
            });
            this.installShutdownHooks();
        }
        catch (err) {
            if (err && err.code === 'EADDRINUSE') {
                log('HTTP', `port ${port} already in use — assuming HttpApiServer already bound the port; skipping app.listen`);
                this.installShutdownHooks();
                return;
            }
            throw err;
        }
    }
    installShutdownHooks() {
        const shutdown = async (signal) => {
            log('SHUTDOWN', `received ${signal}, closing…`);
            try {
                if (this.serverRef) {
                    await new Promise((resolve) => this.serverRef.close(() => resolve()));
                    log('SHUTDOWN', 'HTTP server closed');
                }
            }
            catch (e) {
                console.error('[SHUTDOWN] error while closing HTTP server:', e);
            }
            finally {
                process.exit(0);
            }
        };
        ['SIGINT', 'SIGTERM'].forEach((sig) => {
            process.on(sig, () => void shutdown(sig));
        });
    }
}
exports.ApplicationBootstrapper = ApplicationBootstrapper;
// run when executed directly
(async () => {
    try {
        await new ApplicationBootstrapper().boot();
        log('DONE', 'ready');
    }
    catch (e) {
        console.error('[BOOT] failed:', e);
        process.exit(1);
    }
})();
//# sourceMappingURL=ApplicationBootstrapper.js.map