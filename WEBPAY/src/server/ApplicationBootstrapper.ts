// ApplicationBootstrapper.ts

import { ExpressApp } from './ExpressApp';
import { ShutdownCoordinator } from './ShutdownCoordinator';
import { BrandingService } from './services/BrandingService';
import { BridgeClient } from './services/BridgeClient';
import { HydrationInjector } from './utils/HydrationInjector';
import { MerchantRouteHandlers } from './controllers/MerchantRouteHandlers';
import { PublicRouteHandlers } from './controllers/PublicRouteHandlers';
import { AdminRouteHandlers } from './controllers/AdminRouteHandlers';
import { AuthService } from './services/AuthService';
import { ErrorMiddleware } from './middleware/ErrorMiddleware';
import { SSRViewRenderer } from './views/SSRViewRenderer';
import { InvoiceService } from './services/InvoiceService';
import { SubscriptionService } from './services/SubscriptionService';
import { StoreService } from './services/StoreService';
import { MagicLinkService } from './services/MagicLinkService';
import { CSRFandSecurityMiddleware } from './middleware/CSRFandSecurityMiddleware';
import { StaticAssetMiddleware } from './middleware/StaticAssetMiddleware';
import { ExpressCSPHashManager } from './middleware/ExpressCSPHashManager';
import { BrandingSSRInjector } from './utils/BrandingSSRInjector';

import { InputValidationDelegate } from './controllers/merchant/InputValidationDelegate';
import { ApiKeyRevealStateManager } from './controllers/merchant/ApiKeyRevealStateManager';
import { HydrationObjectBuilder } from './controllers/merchant/HydrationObjectBuilder';
import { BrandingContextFetcher } from './controllers/merchant/BrandingContextFetcher';

import { MagicLinkValidationService } from './services/MagicLinkValidationService';
import { BrandColorSanitizer } from './utils/BrandColorSanitizer';
import { NoCacheHeaderSetter } from './utils/NoCacheHeaderSetter';

import { StoreCreationValidator } from './controllers/admin/StoreCreationValidator';
import { SecretFieldOmitter } from './controllers/admin/SecretFieldOmitter';
import { AdminContextScopeEnforcer } from './controllers/admin/AdminContextScopeEnforcer';
import { BrandingCssVariableInjector } from './controllers/admin/BrandingCssVariableInjector';

import { Config } from './config';

export class ApplicationBootstrapper {
  public static bootstrapApplication(): void {
    // 1. Load config/env
    const PORT = process.env.PORT ? Number(process.env.PORT) : (Config.PORT || 3000);
    const SESSION_SECRET = process.env.SESSION_SECRET || (Config.SESSION_SECRET ?? 'changeme-please');
    const BRIDGE_BASE_URL = process.env.BRIDGE_BASE_URL || Config.BRIDGE_BASE_URL;
    const BRIDGE_API_KEY = process.env.BRIDGE_API_KEY || Config.BRIDGE_API_KEY;
    const BRIDGE_ADMIN_KEY = process.env.BRIDGE_ADMIN_KEY || Config.BRIDGE_ADMIN_KEY;
    const DEPLOYMENT_NETWORK = process.env.DEPLOYMENT_NETWORK || Config.DEPLOYMENT_NETWORK || 'testnet';

    if (!SESSION_SECRET || !BRIDGE_BASE_URL) {
      throw new Error('Required configuration missing: SESSION_SECRET or BRIDGE_BASE_URL');
    }

    // 2. Instantiate singletons/services per DI contract
    const bridgeClient = new BridgeClient({
      baseUrl: BRIDGE_BASE_URL,
      apiKey: BRIDGE_API_KEY,
      adminKey: BRIDGE_ADMIN_KEY,
      network: DEPLOYMENT_NETWORK,
      timeoutMs: 60000,
    });

    const brandingService = new BrandingService(bridgeClient);

    const hydrationInjector = HydrationInjector;
    const ssrViewRenderer = SSRViewRenderer;

    const invoiceService = new InvoiceService(bridgeClient);
    const subscriptionService = new SubscriptionService(bridgeClient);
    const storeService = new StoreService(bridgeClient);
    const magicLinkService = new MagicLinkService(bridgeClient, DEPLOYMENT_NETWORK);

    const inputValidator = new InputValidationDelegate();
    const apiKeyRevealStateManager = new ApiKeyRevealStateManager();
    const hydrationBuilder = new HydrationObjectBuilder();
    const brandingFetcher = new BrandingContextFetcher();

    const magicLinkValidationService = new MagicLinkValidationService(bridgeClient, DEPLOYMENT_NETWORK);

    const brandColorSanitizer = BrandColorSanitizer;
    const noCacheHeaderSetter = NoCacheHeaderSetter;
    const brandingSSRInjector = BrandingSSRInjector;

    const storeCreationValidator = new StoreCreationValidator();
    const secretFieldOmitter = new SecretFieldOmitter();
    const adminContextScopeEnforcer = new AdminContextScopeEnforcer();
    const brandingCssVariableInjector = new BrandingCssVariableInjector();

    const errorMiddleware = new ErrorMiddleware(brandingService, ssrViewRenderer);
    const authService = new AuthService();

    // RouteHandlers with all dependencies wired in
    const merchantRouteHandlers = new MerchantRouteHandlers({
      bridgeClient,
      brandingService,
      hydrationInjector,
      ssrViewRenderer,
      errorMiddleware,
      authService,
      invoiceService,
      subscriptionService,
      storeService,
      inputValidator,
      apiKeyRevealStateManager,
      hydrationBuilder,
      brandingFetcher,
    });

    const publicRouteHandlers = new PublicRouteHandlers({
      bridgeClient,
      brandingService,
      hydrationInjector,
      ssrViewRenderer,
      errorMiddleware,
      magicLinkValidationService,
      brandColorSanitizer,
      noCacheHeaderSetter,
      brandingSSRInjector,
    });

    const adminRouteHandlers = new AdminRouteHandlers({
      bridgeClient,
      brandingService,
      hydrationInjector,
      ssrViewRenderer,
      errorMiddleware,
      authService,
      storeCreationValidator,
      secretFieldOmitter,
      adminContextScopeEnforcer,
      brandingCssVariableInjector,
    });

    // ExpressApp instantiation (DI all handlers and services as needed)
    const expressApp = new ExpressApp({
      brandingService,
      bridgeClient,
      hydrationInjector,
      ssrViewRenderer,
      merchantRouteHandlers,
      publicRouteHandlers,
      adminRouteHandlers,
      authService,
      errorMiddleware,
      invoiceService,
      subscriptionService,
      storeService,
      magicLinkService,
      sessionOptions: {
        secret: SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
        },
      },
    });

    const server = expressApp.app.listen(PORT, () => {
      // eslint-disable-next-line no-console
      console.log(`WEBPAY Express server started on port ${PORT}`);
    });

    const shutdownCoordinator = new ShutdownCoordinator(server);

    // No return; the app remains running and ready to accept HTTP requests
  }
}
