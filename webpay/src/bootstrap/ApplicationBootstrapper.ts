import { ExpressServer } from '../server/ExpressServer';
import { BridgeApiClient } from '../api/BridgeApiClient';
import { ErrorHandler } from '../error/ErrorHandler';
import { SessionManager } from '../session/SessionManager';
import { BrandingProfileManager } from '../services/BrandingProfileManager';
import { QRRenderer } from '../qr/QRRenderer';
import { StaticAssetHandler } from '../static/StaticAssetHandler';
import { MagicLinkValidator } from '../validation/MagicLinkValidator';
import { MagicLinkPageRenderer } from '../views/MagicLinkPageRenderer';
import { CheckoutHandler } from '../handlers/CheckoutHandler';
import { PosRouteHandler } from '../handlers/PosRouteHandler';
import { MerchantConsoleHandler } from '../handlers/MerchantConsoleHandler';
import { AdminConsoleHandler } from '../handlers/AdminConsoleHandler';
import { EmailDeliveryHandler } from '../email/EmailDeliveryHandler';
import { InvoiceStatusPoller } from '../poller/InvoiceStatusPoller';
import { WalletIntegration } from '../wallet/WalletIntegration';
import { MagicLinkClientScript } from '../client/MagicLinkClientScript';
import { SubscriptionManager } from '../subscriptions/SubscriptionManager';
import { PublicProfileFetcher } from '../profile/PublicProfileFetcher';
import { config } from '../config/config';
import {
  IBridgeApiClient,
  IMagicLinkValidator,
  IMagicLinkPageRenderer,
  IBrandingProfileManager,
  IWalletIntegration,
  IMagicLinkClientScript,
  IErrorHandler,
  ISessionManager
} from '../contracts/interfaces';

class ApplicationBootstrapper {
  private static ensureConfigPresent() {
    const required = [
      'SENDER_DOMAIN',
      'POSTMARK_API_KEY',
      'BRIDGE_API_BASE_URL',
      'WEBPAY_BASE_URL'
    ];
    for (const key of required) {
      if (!config[key]) {
        throw new Error(`Missing required configuration: ${key}`);
      }
    }
  }

  public static bootstrap(): void {
    ApplicationBootstrapper.ensureConfigPresent();

    const errorHandler: IErrorHandler = new ErrorHandler();

    const bridgeApiClient: IBridgeApiClient = new BridgeApiClient();

    const sessionManager: ISessionManager = new SessionManager();

    const brandingProfileManager: IBrandingProfileManager = new BrandingProfileManager({ bridgeApiClient });

    const qrRenderer = new QRRenderer();

    // StaticAssetHandler: handled via registration, no explicit instance needed.

    const magicLinkValidator: IMagicLinkValidator = new MagicLinkValidator({
      bridgeApiClient,
      config: {
        getHmacSecretForStore: (storeId: string) => {
          const secrets = config.STORE_SECRETS[storeId];
          return secrets ? secrets.hmacSecret : undefined;
        }
      }
    });

    const magicLinkPageRenderer: IMagicLinkPageRenderer = new MagicLinkPageRenderer({ brandingProfileManager });

    const checkoutHandler = new CheckoutHandler({
      bridgeApiClient,
      errorHandler
    });

    const posRouteHandler = new PosRouteHandler({
      sessionManager,
      bridgeApiClient,
      brandingProfileManager
    });

    const merchantConsoleHandler = new MerchantConsoleHandler({
      bridgeApiClient,
      brandingProfileManager,
      errorHandler,
      sessionManager
    });

    const adminConsoleHandler = new AdminConsoleHandler({
      bridgeApiClient,
      brandingProfileManager,
      errorHandler,
      sessionManager
    });

    // PostmarkApiClient is instantiated internally by EmailDeliveryHandler; here undefined is passed for conformity.
    const emailDeliveryHandler = new EmailDeliveryHandler({
      bridgeApiClient,
      postmarkApiClient: undefined,
      brandingProfileManager,
      errorHandler
    });

    const invoiceStatusPoller = new InvoiceStatusPoller();

    const magicLinkClientScript = new MagicLinkClientScript(
      undefined as unknown as IWalletIntegration
    );
    const walletIntegration = new WalletIntegration({ magicLinkClientScript });

    const subscriptionManager = new SubscriptionManager({
      bridgeApiClient,
      brandingProfileManager,
      errorHandler,
      sessionManager
    });

    const publicProfileFetcher = new PublicProfileFetcher({ bridgeApiClient });

    const staticAssetsDir = require('path').join(__dirname, '..', '..', 'public');
    const expressServer = new ExpressServer({
      bridgeApiClient,
      magicLinkValidator,
      magicLinkPageRenderer,
      brandingProfileManager,
      sessionManager,
      errorHandler,
      checkoutHandler,
      staticAssetsDir
    });

    const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
    expressServer.app.listen(port);
  }
}

export { ApplicationBootstrapper };
