import { IBridgeApiClient, IBrandingProfileManager, IErrorHandler, ISessionManager } from '../contracts/interfaces';
import { StoreProfileFormDelegate } from '../views/StoreProfileFormDelegate';
import { StoreListUiDelegate } from '../views/StoreListUiDelegate';
import { WebhookLogUiRenderer } from '../views/WebhookLogUiRenderer';
import { PollerStatusUiDelegate } from '../views/PollerStatusUiDelegate';
import { Store, WebhookLog, PollerStatus } from '../models/core';

class AdminConsoleHandler {
  private bridgeApiClient: IBridgeApiClient;
  private brandingProfileManager: IBrandingProfileManager;
  private errorHandler: IErrorHandler;
  private sessionManager: ISessionManager;

  private storeProfileFormDelegate: StoreProfileFormDelegate;
  private storeListUiDelegate: StoreListUiDelegate;
  private webhookLogUiRenderer: WebhookLogUiRenderer;
  private pollerStatusUiDelegate: PollerStatusUiDelegate;

  constructor(deps: {
    bridgeApiClient: IBridgeApiClient,
    brandingProfileManager: IBrandingProfileManager,
    errorHandler: IErrorHandler,
    sessionManager: ISessionManager
  }) {
    this.bridgeApiClient = deps.bridgeApiClient;
    this.brandingProfileManager = deps.brandingProfileManager;
    this.errorHandler = deps.errorHandler;
    this.sessionManager = deps.sessionManager;

    this.storeProfileFormDelegate = new StoreProfileFormDelegate();
    this.storeListUiDelegate = new StoreListUiDelegate();
    this.webhookLogUiRenderer = new WebhookLogUiRenderer();
    this.pollerStatusUiDelegate = new PollerStatusUiDelegate();
  }

  async handleCreateStoreFormSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const result = this.storeProfileFormDelegate.extractAndValidateFormInput(form);
    if ('error' in result) {
      this.errorHandler.handleValidationError(window, { error: result.error });
      return;
    }
    const principalInput = form.querySelector('[name="principal"]') as HTMLInputElement;
    const nameInput = form.querySelector('[name="name"]') as HTMLInputElement;
    const principal = principalInput.value;
    const name = nameInput.value;
    if (!principal) {
      this.errorHandler.handleValidationError(window, { error: "Principal is required." });
      return;
    }
    if (!name) {
      this.errorHandler.handleValidationError(window, { error: "Name is required." });
      return;
    }
    const payload: any = {
      principal,
      name,
      ...result.payload
    };
    try {
      await this.bridgeApiClient.createStore(payload);
      const storeList = await this.bridgeApiClient.getStoreList();
      this.renderStoreListPage(storeList);
    } catch (err: any) {
      if (err && err.statusCode === 409 && err.existingStore) {
        this.errorHandler.handleDuplicateStore(window, { existingStore: err.existingStore });
      } else {
        this.errorHandler.handleBridgeError(window, err);
      }
    }
  }

  renderStoreListPage(data: Store[]): void {
    const container = document.getElementById('admin-store-list');
    this.storeListUiDelegate.renderStoreList(container, data, {
      onActivateToggle: (storeId: string, newState: boolean) => this.handleActivateStoreToggle(storeId, newState),
      onRotateKeys: (storeId: string) => this.handleRotateKeys(storeId),
      onEditBranding: (storeId: string) => {
        this.bridgeApiClient.getStoreProfile(storeId)
          .then(profile => this.renderBrandingProfilePage(profile))
          .catch(err => this.errorHandler.handleBridgeApiError(err));
      },
      onSetSbtc: (storeId: string) => {
        const sbtcForm = document.getElementById('set-sbtc-form') as HTMLFormElement;
        if (sbtcForm) sbtcForm.dataset['storeId'] = storeId;
      }
    });
  }

  async handleActivateStoreToggle(storeId: string, newState: boolean): Promise<void> {
    try {
      await this.bridgeApiClient.setStoreActiveState(storeId, newState);
      const storeList = await this.bridgeApiClient.getStoreList();
      this.renderStoreListPage(storeList);
    } catch (err: any) {
      this.errorHandler.handleBridgeApiError(err);
    }
  }

  renderBrandingProfilePage(data: Store): void {
    const form = document.getElementById('branding-profile-form') as HTMLFormElement;
    this.storeProfileFormDelegate.renderFormFields(form, data);
    form.dataset['storeId'] = data.storeId;
    form.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', (e) => {
        this.brandingProfileManager.handleInputChange(e);
      });
    });
  }

  async handleBrandingProfileFormSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const storeId = form.dataset['storeId']!;
    const result = this.storeProfileFormDelegate.extractAndValidateFormInput(form);
    if ('error' in result) {
      this.errorHandler.handleValidationError(window, { error: result.error });
      return;
    }
    try {
      const updated = await this.bridgeApiClient.updateStoreProfile(storeId, result.payload);
      this.renderBrandingProfilePage(updated);
    } catch (err) {
      this.errorHandler.handleBridgeApiError(err);
    }
  }

  async handleRotateKeys(storeId: string): Promise<void> {
    try {
      const secrets = await this.bridgeApiClient.rotateKeys(storeId);
      const modal = document.getElementById('reveal-secrets-modal');
      const apiKeyField = modal.querySelector('.api-key') as HTMLInputElement;
      const hmacSecretField = modal.querySelector('.hmac-secret') as HTMLInputElement;
      const copyApiKeyBtn = modal.querySelector('.copy-api-key') as HTMLButtonElement;
      const copyHmacSecretBtn = modal.querySelector('.copy-hmac-secret') as HTMLButtonElement;
      apiKeyField.value = secrets.apiKey;
      hmacSecretField.value = secrets.hmacSecret;
      copyApiKeyBtn.onclick = () => this.handleCopySecret(secrets.apiKey);
      copyHmacSecretBtn.onclick = () => this.handleCopySecret(secrets.hmacSecret);
      modal.classList.remove('hidden');
      const warning = modal.querySelector('.secrets-warning') as HTMLElement;
      warning.textContent = "These secrets will not be shown again. Copy and store them securely now.";
    } catch (err) {
      this.errorHandler.handleBridgeApiError(err);
    }
  }

  handleCopySecret(secret: string): void {
    navigator.clipboard.writeText(secret)
      .then(() => {
        let toast = document.getElementById('admin-secrets-toast');
        if (!toast) {
          toast = document.createElement('div');
          toast.id = 'admin-secrets-toast';
          toast.className = 'fixed top-4 right-4 bg-blue-700 text-white px-4 py-2 rounded shadow z-50';
          document.body.appendChild(toast);
        }
        toast.textContent = "Copied!";
        toast.style.display = '';
        setTimeout(() => {
          toast.style.display = 'none';
        }, 1200);
      })
      .catch(() => {
        let toast = document.getElementById('admin-secrets-toast');
        if (!toast) {
          toast = document.createElement('div');
          toast.id = 'admin-secrets-toast';
          toast.className = 'fixed top-4 right-4 bg-red-700 text-white px-4 py-2 rounded shadow z-50';
          document.body.appendChild(toast);
        }
        toast.textContent = "Unable to copy.";
        toast.style.display = '';
        setTimeout(() => {
          toast.style.display = 'none';
        }, 1200);
      });
  }

  async handleSetSbtcTokenFormSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const contractAddressInput = form.querySelector('[name="contractAddress"]') as HTMLInputElement;
    const contractNameInput = form.querySelector('[name="contractName"]') as HTMLInputElement;
    const contractAddress = contractAddressInput.value;
    const contractName = contractNameInput.value;
    if (!contractAddress) {
      this.errorHandler.handleValidationError(window, { error: "contractAddress is required." });
      return;
    }
    if (!contractName) {
      this.errorHandler.handleValidationError(window, { error: "contractName is required." });
      return;
    }
    try {
      const result = await this.bridgeApiClient.setSbtcToken({ contractAddress, contractName });
      if ((result as any).unsignedCall) {
        // Integration point for wallet connect logic (see WalletIntegration)
        // (window as any).walletIntegration.openWallet((result as any).unsignedCall);
      } else if ((result as any).error) {
        this.errorHandler.handleBridgeApiError(result);
      }
    } catch (err) {
      this.errorHandler.handleBridgeApiError(err);
    }
  }

  renderWebhookLogPage(data: WebhookLog[]): void {
    const container = document.getElementById('webhook-log-table');
    this.webhookLogUiRenderer.renderWebhookLogTable(container, data, (logId) => this.handleWebhookRetry(logId));
  }

  async handleWebhookRetry(webhookLogId: string): Promise<void> {
    try {
      await this.bridgeApiClient.retryWebhook(webhookLogId);
      const data = await this.bridgeApiClient.getWebhooksLog({ status: 'all' });
      this.renderWebhookLogPage(data);
    } catch (err) {
      this.errorHandler.handleBridgeApiError(err);
    }
  }

  renderPollerStatusPage(data: PollerStatus): void {
    const container = document.getElementById('poller-status-panel');
    this.pollerStatusUiDelegate.renderPollerStatus(container, data);
  }

  async handlePollerRestart(): Promise<void> {
    try {
      await this.bridgeApiClient.restartPoller();
      const status = await this.bridgeApiClient.getPollerStatus();
      this.renderPollerStatusPage(status);
    } catch (err) {
      this.errorHandler.handleBridgeApiError(err);
    }
  }

  async handleBootstrapProtocol(event: Event): Promise<void> {
    event.preventDefault();
    try {
      const result = await this.bridgeApiClient.bootstrapProtocol();
      // If result contains unsignedCall, trigger wallet connect (integration point)
      // (window as any).walletIntegration.handleBootstrapProtocolResult(result);
      // If result is idempotent abort, show message (UI logic elsewhere)
    } catch (err) {
      this.errorHandler.handleBridgeApiError(err);
    }
  }

  async handleSyncOnchain(event: Event, storeId: string): Promise<void> {
    event.preventDefault();
    try {
      const result = await this.bridgeApiClient.syncOnchain(storeId);
      // If result.calls exists, iterate and call wallet integration for each unsignedCall
      // (window as any).walletIntegration.handleSyncCallResult for each call
      // If idempotent abort, show message (UI logic elsewhere)
    } catch (err) {
      this.errorHandler.handleBridgeApiError(err);
    }
  }

  async fetchAndUpdateWebhookLogs(storeId: string): Promise<void> {
    try {
      const logs = await this.bridgeApiClient.getWebhooksLog({ status: 'all', storeId });
      this.renderWebhookLogPage(logs);
    } catch (err) {
      this.errorHandler.handleBridgeApiError(err);
    }
  }
}

export { AdminConsoleHandler };
