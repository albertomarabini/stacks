import express from 'express';
import {
  IBridgeApiClient,
  IMagicLinkValidator,
  IMagicLinkPageRenderer,
  IBrandingProfileManager,
  IErrorHandler,
  ISessionManager,
} from '../contracts/interfaces';
import { CorsPolicyEnforcer } from '../middleware/CorsPolicyEnforcer';
import { CheckoutHandler } from '../handlers/CheckoutHandler';
import { MagicLinkValidator } from '../validation/MagicLinkValidator';
import { MagicLinkPageRenderer } from '../views/MagicLinkPageRenderer';
import { BrandingProfileManager } from '../services/BrandingProfileManager';
import { SessionManager } from '../session/SessionManager';
import { StaticAssetHandler } from '../static/StaticAssetHandler';
import { ErrorHandler } from '../error/ErrorHandler';

class ExpressServer {
  public app: express.Express;
  private bridgeApiClient: IBridgeApiClient;
  private magicLinkValidator: IMagicLinkValidator;
  private magicLinkPageRenderer: IMagicLinkPageRenderer;
  private brandingProfileManager: IBrandingProfileManager;
  private errorHandler: IErrorHandler;
  private sessionManager: ISessionManager;
  private corsPolicyEnforcer: CorsPolicyEnforcer;
  private checkoutHandler: CheckoutHandler;

  constructor(deps: {
    bridgeApiClient: IBridgeApiClient;
    magicLinkValidator: IMagicLinkValidator;
    magicLinkPageRenderer: IMagicLinkPageRenderer;
    brandingProfileManager: IBrandingProfileManager;
    sessionManager: ISessionManager;
    errorHandler: IErrorHandler;
    checkoutHandler: CheckoutHandler;
    staticAssetsDir: string;
  }) {
    this.bridgeApiClient = deps.bridgeApiClient;
    this.magicLinkValidator = deps.magicLinkValidator;
    this.magicLinkPageRenderer = deps.magicLinkPageRenderer;
    this.brandingProfileManager = deps.brandingProfileManager;
    this.sessionManager = deps.sessionManager;
    this.errorHandler = deps.errorHandler;
    this.checkoutHandler = deps.checkoutHandler;
    this.app = express();

    // Express built-in middleware for JSON and urlencoded parsing
    this.app.use(express.json({ limit: '1mb' }));
    this.app.use(express.urlencoded({ extended: true }));

    // Session middleware (must be before protected/protected routes)
    this.app.use((this.sessionManager as any).getSessionMiddleware());

    // Dynamic CORS Policy middleware
    this.corsPolicyEnforcer = new CorsPolicyEnforcer(this.bridgeApiClient);
    this.app.use(this.corsMiddleware.bind(this));

    // Static asset middleware (Tailwind, JS, images)
    StaticAssetHandler.register(this.app, deps.staticAssetsDir);

    // POST /checkout/:storeId — merchant web checkout flow
    this.app.post(
      '/checkout/:storeId',
      this.checkoutHandler.handleCheckoutPost.bind(this.checkoutHandler)
    );

    // Magic-link payment page (invoice flow)
    this.app.get(
      '/w/:storeId/:invoiceId',
      (this.magicLinkValidator as any).validateU.bind(this.magicLinkValidator),
      (req: express.Request, res: express.Response, next: express.NextFunction) =>
        (this.magicLinkPageRenderer as any).renderCheckoutPage(
          req,
          res,
          (req as any).validatedUData
        )
    );

    // Magic-link payment page (subscription flow)
    this.app.get(
      '/s/:storeId/:subscriptionId',
      (this.magicLinkValidator as any).validateU.bind(this.magicLinkValidator),
      (req: express.Request, res: express.Response, next: express.NextFunction) =>
        (this.magicLinkPageRenderer as any).renderCheckoutPage(
          req,
          res,
          (req as any).validatedUData
        )
    );

    // Branding/public profile endpoint
    this.app.get(
      '/api/v1/stores/:storeId/public-profile',
      (req: express.Request, res: express.Response, next: express.NextFunction) =>
        (this.brandingProfileManager as any).handlePublicProfileRequest(req, res, next)
    );

    // Error handling middleware (must be last)
    this.app.use(
      (this.errorHandler as any).handleError.bind(this.errorHandler)
    );
  }

  /**
   * Thin wrapper binding for dynamic CORS policy enforcement.
   * All logic is delegated to CorsPolicyEnforcer.enforceCorsPolicy.
   */
  async corsMiddleware(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ): Promise<void> {
    return this.corsPolicyEnforcer.enforceCorsPolicy(req, res, next);
  }
}

export { ExpressServer };
