import type {
  IBridgeClient,
  IBrandingService,
  IHydrationInjector,
  ISSRViewRenderer,
  IErrorMiddleware,
  IAuthService,
  IAdminRouteHandlers,
} from '../../shared/contracts/interfaces';
import { StoreCreationValidator } from './admin/StoreCreationValidator';
import { SecretFieldOmitter } from './admin/SecretFieldOmitter';
import { AdminContextScopeEnforcer } from './admin/AdminContextScopeEnforcer';
import { BrandingCssVariableInjector } from './admin/BrandingCssVariableInjector';
import { resolveServerBaseUrl } from '../utils/UrlUtils'
import { Branding } from '../../shared/models/dto';

export class AdminRouteHandlers implements IAdminRouteHandlers{
  private bridgeClient: IBridgeClient;
  private brandingService: IBrandingService;
  private hydrationInjector: IHydrationInjector;
  private ssrViewRenderer: ISSRViewRenderer;
  private errorMiddleware: IErrorMiddleware;
  private authService: IAuthService;
  private storeCreationValidator: StoreCreationValidator;
  private secretFieldOmitter: SecretFieldOmitter;
  private adminContextScopeEnforcer: AdminContextScopeEnforcer;
  private brandingCssVariableInjector: BrandingCssVariableInjector;
  private fallbackColor: string = '111827';

  constructor(deps: {
    bridgeClient: IBridgeClient;
    brandingService: IBrandingService;
    hydrationInjector: IHydrationInjector;
    ssrViewRenderer: ISSRViewRenderer;
    errorMiddleware: IErrorMiddleware;
    authService: IAuthService;
    storeCreationValidator: StoreCreationValidator;
    secretFieldOmitter: SecretFieldOmitter;
    adminContextScopeEnforcer: AdminContextScopeEnforcer;
    brandingCssVariableInjector: BrandingCssVariableInjector;
  }) {
    this.bridgeClient = deps.bridgeClient;
    this.brandingService = deps.brandingService;
    this.hydrationInjector = deps.hydrationInjector;
    this.ssrViewRenderer = deps.ssrViewRenderer;
    this.errorMiddleware = deps.errorMiddleware;
    this.authService = deps.authService;
    this.storeCreationValidator = deps.storeCreationValidator;
    this.secretFieldOmitter = deps.secretFieldOmitter;
    this.adminContextScopeEnforcer = deps.adminContextScopeEnforcer;
    this.brandingCssVariableInjector = deps.brandingCssVariableInjector;
  }

  async handleLoginPost(req: any, res: any, next: any): Promise<void> {
    try {
      const { username, password } = req.body;
      if (typeof username !== 'string' || typeof password !== 'string') {
        res.status(400);
        const branding = await this.fetchAdminBranding();
        return res.render('error.ejs', {
          error: { message: 'Missing credentials.', code: 400 },
          branding,
        });
      }
      const expectedUser = process.env.ADMIN_USER || 'admin';
      const expectedPass = process.env.ADMIN_PASS || '';
      if (
        username === expectedUser &&
        (expectedPass ? password === expectedPass : true)
      ) {
        (req.session as any).admin = { id: 'admin', name: username };
        return res.redirect('/admin');
      }
      const branding = await this.fetchAdminBranding();
      res.status(401);
      return res.render('error.ejs', {
        error: { message: 'Invalid credentials.', code: 401 },
        branding,
      });
    } catch (err) {
      next(err);
    }
  }
  private getTemplateDefaults(req: any) {
    // return { principal: process.env.MERCHANT_PRINCIPAL || '' }; I think the principal for the store has to be created for the store
    return {
      principal: '',
      allowed_origins: resolveServerBaseUrl(req)
    };
  }
  async handleStoresPost(req: any, res: any, next: any): Promise<void> {
    try {
      // 1) Build the exact snake_case payload the harness uses
      const b = req.body || {};
      const dto = {
        principal: typeof b.principal === 'string' ? b.principal.trim() : '',
        name: typeof b.name === 'string' ? b.name.trim() : '',
        display_name: typeof b.display_name === 'string' ? b.display_name.trim() : '',
        logo_url: typeof b.logo_url === 'string' ? b.logo_url.trim() : '',
        brand_color: typeof b.brand_color === 'string' ? b.brand_color.trim() : '',
        allowed_origins: typeof b.allowed_origins === 'string' ? b.allowed_origins.trim() : '',
        webhook_url: typeof b.webhook_url === 'string' ? b.webhook_url.trim() : '',
      };

      // (Optional) light sanity: require principal + name
      if (!dto.principal || !dto.name) {
        throw { status: 400, message: 'principal and name are required' };
      }

      // 2) Keep your uniqueness check (existingPrincipals) if you want local UX guard
      const stores = await this.bridgeClient.listStores();
      const existingPrincipals = stores.map((s) => s.principal);
      if (existingPrincipals.includes(dto.principal)) {
        throw { status: 409, message: 'Principal already exists' };
      }

      // 3) Call Bridge exactly like the harness
      await this.bridgeClient.createStore(dto as Record<string, unknown>);

      // 4) Re-list and render
      const newStores = await this.bridgeClient.listStores();
      const branding = await this.fetchAdminBranding();
      this.enforceAdminContextDataScopes(req, res, [newStores]);
      res.render('admin/stores.ejs', {
        branding,
        stores: newStores,
        brandCssStyle: this.brandingCssVariableInjector.generateBrandCssVariableStyle(
          branding.brandColor || undefined, this.fallbackColor
        ),
        csrfToken: typeof req.csrfToken === 'function' ? req.csrfToken() : undefined,
        defaults: this.getTemplateDefaults(req),
      });
    } catch (err) {
      next(err);
    }
  }


  async handleRotateKeysPost(req: any, res: any, next: any): Promise<void> {
    try {
      const { storeId } = req.params;
      if (typeof storeId !== 'string') throw new Error('Invalid storeId');
      const branding = await this.brandingService.fetchBranding(storeId);
      const keys = await this.bridgeClient.rotateApiKeys(storeId);
      if (req.session) (req.session as any).latestApiKeys = { ...keys, revealed: true };
      res.render('admin/keys.ejs', {
        branding,
        apiKey: keys.apiKey,
        hmacSecret: keys.hmacSecret,
        oneTimeReveal: true,
        brandCssStyle: this.brandingCssVariableInjector.generateBrandCssVariableStyle(
          branding.brandColor || undefined, this.fallbackColor
        ),
      });
    } catch (err) {
      next(err);
    }
  }

  async handleTokenConfigPost(req: any, res: any, next: any): Promise<void> {
    try {
      const { contractAddress, contractName } = req.body;
      if (
        typeof contractAddress !== 'string' ||
        typeof contractName !== 'string'
      ) {
        throw { status: 400, message: 'Invalid contract address or name' };
      }
      const result = await this.bridgeClient.setSbtcTokenConfig({
        contractAddress,
        contractName,
      });
      const branding = await this.fetchAdminBranding();
      const hydration = { unsignedCall: result.unsignedCall };
      res.render('admin/token.ejs', {
        branding,
        hydrationScript: this.hydrationInjector.inject(hydration),
        unsignedCall: result.unsignedCall,
        brandCssStyle: this.brandingCssVariableInjector.generateBrandCssVariableStyle(
          branding.brandColor || undefined, this.fallbackColor
        ),
      });
    } catch (err) {
      next(err);
    }
  }

  async handleBootstrapPost(req: any, res: any, next: any): Promise<void> {
    try {
      const result = await this.bridgeClient.bootstrap();
      const branding = await this.fetchAdminBranding();
      const hydration = { unsignedCall: result.unsignedCall };
      res.render('admin/bootstrap.ejs', {
        branding,
        hydrationScript: this.hydrationInjector.inject(hydration),
        unsignedCall: result.unsignedCall,
        bootstrapState: result.bootstrapState,
        brandCssStyle: this.brandingCssVariableInjector.generateBrandCssVariableStyle(
          branding.brandColor || undefined, this.fallbackColor
        ),
      });
    } catch (err) {
      next(err);
    }
  }

  async handleSyncOnchainPost(req: any, res: any, next: any): Promise<void> {
    try {
      const { storeId } = req.params;
      if (typeof storeId !== 'string') throw new Error('Invalid storeId');
      const result = await this.bridgeClient.syncOnchain(storeId);
      const branding = await this.brandingService.fetchBranding(storeId);
      const hydration = { unsignedCalls: result.unsignedCalls };
      res.render('admin/sync.ejs', {
        branding,
        hydrationScript: this.hydrationInjector.inject(hydration),
        unsignedCalls: result.unsignedCalls,
        syncState: result.syncState,
        brandCssStyle: this.brandingCssVariableInjector.generateBrandCssVariableStyle(
          branding.brandColor || undefined, this.fallbackColor
        ),
      });
    } catch (err) {
      next(err);
    }
  }

  async handlePollerRestartPost(req: any, res: any, next: any): Promise<void> {
    try {
      const result = await this.bridgeClient.restartPoller();
      const branding = await this.fetchAdminBranding();
      res.render('admin/poller.ejs', {
        branding,
        pollerStatus: result.pollerStatus,
        brandCssStyle: this.brandingCssVariableInjector.generateBrandCssVariableStyle(
          branding.brandColor || undefined, this.fallbackColor
        ),
      });
    } catch (err) {
      next(err);
    }
  }

  async handleWebhooksRetryPost(req: any, res: any, next: any): Promise<void> {
    try {
      const { webhookLogId } = req.body;
      if (typeof webhookLogId !== 'string' || !webhookLogId)
        throw new Error('Invalid webhookLogId');
      await this.bridgeClient.retryWebhook(webhookLogId);
      const branding = await this.fetchAdminBranding();
      const webhooks = await this.bridgeClient.fetchWebhooks();
      res.render('admin/webhooks.ejs', {
        branding,
        webhooks,
        brandCssStyle: this.brandingCssVariableInjector.generateBrandCssVariableStyle(
          branding.brandColor || undefined, this.fallbackColor
        ),
      });
    } catch (err) {
      next(err);
    }
  }

  async handleAdminGet(req: any, res: any, next: any): Promise<void> {
    try {
      this.enforceAdminContextDataScopes(req, res);

      const p = req.path; // '/', '/stores', ...
      let viewName = 'admin/admin-home.ejs';
      const viewProps: Record<string, any> = {};

      if (p.startsWith('/stores')) {
        viewName = 'admin/stores.ejs';
        // const envPrincipal = process.env.MERCHANT_PRINCIPAL || '';
        viewProps.defaults = this.getTemplateDefaults(req);
        viewProps.stores = await this.bridgeClient.listStores();
      } else if (p.startsWith('/keys')) {
        viewName = 'admin/keys.ejs';
      } else if (p.startsWith('/token')) {
        viewName = 'admin/token.ejs';
        // defaults so the template variables always exist
        viewProps.unsignedCall = null;
        viewProps.hydrationScript = '';
      } else if (p.startsWith('/bootstrap')) {
        viewName = 'admin/bootstrap.ejs';
      } else if (p.startsWith('/sync')) {
        viewName = 'admin/sync.ejs';
      } else if (p.startsWith('/poller')) {
        viewName = 'admin/poller.ejs';
        viewProps.pollerStatus = await this.bridgeClient.getPollerStatus();
      }else if (p.startsWith('/webhooks')) {
        viewName = 'admin/webhooks.ejs';
        viewProps.webhooks = await this.bridgeClient.fetchWebhooks();
      }
      // const branding = await this.fetchAdminBranding(); //Here we fetch the default configuration

      // ✅ Only pass scoping targets that actually exist
      const scopingTargets: any[] = [];
      if (Array.isArray(viewProps.stores)) scopingTargets.push(viewProps.stores);
      this.enforceAdminContextDataScopes(req, res, scopingTargets);
      const branding = await this.fetchAdminBranding();
      viewProps.branding = branding;
      viewProps.brandCssStyle = this.brandingCssVariableInjector.generateBrandCssVariableStyle(
        branding.brandColor || undefined, this.fallbackColor
      );
      if (typeof req.csrfToken === 'function') {
        viewProps.csrfToken = req.csrfToken();
      }
      res.render(viewName, viewProps);
    } catch (err) { next(err); }
  }


  async handleStoreActivatePatch(req: any, res: any, next: any): Promise<void> {
    try {
      const { storeId } = req.params;
      let { active } = req.body;

      if (typeof storeId !== 'string' || !storeId) {
        throw { status: 400, message: 'Invalid storeId' };
      }

      // Accept form posts ("true"/"false") and JSON booleans
      if (typeof active === 'string') {
        active = active === 'true' || active === '1';
      }
      if (typeof active !== 'boolean') {
        throw { status: 400, message: 'Invalid activation flag' };
      }

      await this.bridgeClient.patchStoreActivate(storeId, active);

      const branding = await this.fetchAdminBranding();
      const stores = await this.bridgeClient.listStores();
      this.enforceAdminContextDataScopes(req, res, [stores]);
      res.render('admin/stores.ejs', {
        branding,
        stores,
        brandCssStyle: this.brandingCssVariableInjector.generateBrandCssVariableStyle(
          branding.brandColor || undefined, this.fallbackColor
        ),
        csrfToken: typeof req.csrfToken === 'function' ? req.csrfToken() : undefined,
        defaults: this.getTemplateDefaults(req),
      });
    } catch (err) {
      next(err);
    }
  }


  async handleSettingsPost(req: any, res: any, next: any): Promise<void> {
    try {
      const { brandColor, displayName, logoUrl, supportEmail, supportUrl } = req.body;
      const brandingUpdate = {
        brandColor:
          typeof brandColor === 'string' &&
            /^#[0-9A-Fa-f]{6}$/.test(brandColor)
            ? brandColor
            : this.fallbackColor,
        displayName: typeof displayName === 'string' ? displayName.trim() : '',
        logoUrl: typeof logoUrl === 'string' ? logoUrl.trim() : null,
        supportEmail:
          typeof supportEmail === 'string' ? supportEmail.trim() : null,
        supportUrl:
          typeof supportUrl === 'string' ? supportUrl.trim() : null,
      };
      await this.bridgeClient.updateSettings(brandingUpdate);
      const branding = await this.fetchAdminBranding();
      res.render('admin/settings.ejs', {
        branding,
        brandCssStyle: this.brandingCssVariableInjector.generateBrandCssVariableStyle(
          branding.brandColor || undefined, this.fallbackColor
        ),
      });
    } catch (err) {
      next(err);
    }
  }

  omitSecretsFromViewPropsAndHydration(props: Record<string, any>): Record<string, any> {
    return this.secretFieldOmitter.omitSecretsFromProps(props);
  }

  enforceAdminContextDataScopes(req: any, res: any, dtos?: any[]): void {
    this.adminContextScopeEnforcer.enforceScope(req, res, dtos);
  }

  async handleWebhooksGet(req: any, res: any, next: any): Promise<void> {
    try {
      const branding = await this.fetchAdminBranding();
      const filters: Record<string, string> = {};
      if (req.query.status) filters['status'] = req.query.status;//[ts] Element implicitly has an 'any' type because expression of type '"status"' can't be used to index type '{}'. Property 'status' does not exist on type '{}'.
      if (req.query.storeId) filters['storeId'] = req.query.storeId;
      const webhooks = await this.bridgeClient.fetchWebhooks(filters);
      res.render('admin/webhooks.ejs', {
        branding,
        webhooks,
        brandCssStyle: this.brandingCssVariableInjector.generateBrandCssVariableStyle(
          branding.brandColor || undefined, this.fallbackColor
        ),
      });
    } catch (err) {
      next(err);
    }
  }
  async fetchAdminBranding(): Promise<Branding> {
    const branding = {
      displayName: process.env.ADMIN_DISPLAY_NAME ?? "WEBPAY",
      brandColor: process.env.ADMIN_COLOR ?? "111827",
      logoUrl: process.env.ADMIN_LOGO_URL ?? null,
      supportEmail: process.env.ADMIN_SUPPORT_EMAIL ?? null,
      supportUrl: process.env.ADMIN_SUPPORT_URL ?? null,
    };
    return branding;
  }
}
