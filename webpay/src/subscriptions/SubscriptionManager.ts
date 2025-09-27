import {
  IBridgeApiClient,
  IBrandingProfileManager,
  IErrorHandler,
  ISessionManager
} from '../contracts/interfaces';
import { SubscriptionModalFormStateDelegate } from '../views/SubscriptionModalFormStateDelegate';
import { InvoiceSuccessSheetUiDelegate } from '../views/InvoiceSuccessSheetUiDelegate';
import { SubscriptionTablePollingDelegate } from '../views/SubscriptionTablePollingDelegate';
import { InvoiceDrawerUiDelegate } from '../views/InvoiceDrawerUiDelegate';

class SubscriptionManager {
  bridgeApiClient: IBridgeApiClient;
  brandingProfileManager: IBrandingProfileManager;
  errorHandler: IErrorHandler;
  sessionManager: ISessionManager;

  modalDelegate: SubscriptionModalFormStateDelegate;
  invoiceSheetDelegate: InvoiceSuccessSheetUiDelegate;
  tablePollingDelegate: SubscriptionTablePollingDelegate;
  invoiceDrawerUiDelegate: InvoiceDrawerUiDelegate;

  constructor(deps: {
    bridgeApiClient: IBridgeApiClient;
    brandingProfileManager: IBrandingProfileManager;
    errorHandler: IErrorHandler;
    sessionManager: ISessionManager;
  }) {
    this.bridgeApiClient = deps.bridgeApiClient;
    this.brandingProfileManager = deps.brandingProfileManager;
    this.errorHandler = deps.errorHandler;
    this.sessionManager = deps.sessionManager;

    this.modalDelegate = new SubscriptionModalFormStateDelegate();
    this.invoiceSheetDelegate = new InvoiceSuccessSheetUiDelegate();
    this.tablePollingDelegate = new SubscriptionTablePollingDelegate({
      bridgeApiClient: this.bridgeApiClient,
      errorHandler: this.errorHandler
    });
    this.invoiceDrawerUiDelegate = new InvoiceDrawerUiDelegate();
  }

  openCreateSubscriptionModal(): void {
    this.modalDelegate.openModal();
  }

  async handleSubmitSubscription(): Promise<void> {
    const { valid, errorMessage } = this.modalDelegate.validateForm();
    if (!valid) {
      this.modalDelegate.setError(errorMessage);
      return;
    }
    const { subscriberPrincipal, amountSats, intervalBlocks } = this.modalDelegate.getFormValues();

    let storeId: string | undefined = undefined;
    const storeIdElem = document.getElementById('subscriptionsTable') as HTMLElement | null;
    if (storeIdElem && storeIdElem.dataset && storeIdElem.dataset.storeId) {
      storeId = storeIdElem.dataset.storeId;
    } else if ((window as any).currentStoreId) {
      storeId = (window as any).currentStoreId;
    }
    if (!storeId) {
      this.modalDelegate.setError('Store ID not found.');
      return;
    }
    try {
      const resp = await fetch(`/api/v1/stores/${encodeURIComponent(storeId)}/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriberPrincipal, amountSats, intervalBlocks })
      });
      if (!resp.ok) {
        const err = await resp.json();
        this.errorHandler.handleBridgeApiError(err);
        this.modalDelegate.setError(err.error || 'Error creating subscription.');
        return;
      }
      await this.pollAndUpdateSubscriptionsTable();
      this.closeCreateSubscriptionModal();
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Subscription created.');
      }
    } catch (err: any) {
      this.errorHandler.handleBridgeApiError(err);
      this.modalDelegate.setError('Network or server error.');
    }
  }

  async handleGenerateInvoiceNow(): Promise<void> {
    let subscriptionId: string | undefined = undefined;
    let storeId: string | undefined = undefined;
    const sheet = document.getElementById('subscriptionInvoiceSheet');
    if (sheet && sheet.dataset) {
      subscriptionId = sheet.dataset.subscriptionId;
      storeId = sheet.dataset.storeId;
    }
    if (!subscriptionId || !storeId) {
      this.errorHandler.handleBridgeApiError({ error: 'Subscription or Store not found.' });
      return;
    }
    try {
      const resp = await fetch(`/api/v1/stores/${encodeURIComponent(storeId)}/subscriptions/${encodeURIComponent(subscriptionId)}/invoice`);
      if (!resp.ok) {
        const err = await resp.json();
        this.errorHandler.handleBridgeApiError(err);
        return;
      }
      const dto = await resp.json();
      this.invoiceSheetDelegate.renderSuccessSheet(
        dto,
        this.handleCopyInvoiceLink.bind(this),
        this.handleSendEmail.bind(this)
      );
    } catch (err: any) {
      this.errorHandler.handleBridgeApiError(err);
    }
  }

  async handleSendEmail(): Promise<void> {
    let magicLink: string | undefined = undefined;
    let storeId: string | undefined = undefined;
    let recipientEmail: string | undefined = undefined;
    const linkElem = document.getElementById('subscriptionInvoice-magicLink') as HTMLAnchorElement | null;
    if (linkElem) {
      magicLink = linkElem.href || linkElem.textContent || '';
    }
    const sheet = document.getElementById('subscriptionInvoiceSheet');
    if (sheet && sheet.dataset && sheet.dataset.storeId) {
      storeId = sheet.dataset.storeId;
    }
    const emailInput = document.getElementById('subscriptionInvoice-emailInput') as HTMLInputElement | null;
    if (emailInput) {
      recipientEmail = emailInput.value.trim();
    }
    if (!magicLink || !storeId || !recipientEmail) {
      this.errorHandler.handleBridgeApiError({ error: 'Missing required fields for send email.' });
      return;
    }
    try {
      const resp = await fetch(`/api/v1/stores/${encodeURIComponent(storeId)}/subscriptions/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientEmail, magicLink })
      });
      if (!resp.ok) {
        const err = await resp.json();
        this.errorHandler.handleBridgeApiError(err);
        return;
      }
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Subscription invoice email sent.');
      }
    } catch (err: any) {
      this.errorHandler.handleBridgeApiError(err);
    }
  }

  async handleCancelSubscription(): Promise<void> {
    let subscriptionId: string | undefined = undefined;
    let storeId: string | undefined = undefined;
    const activeRow = document.querySelector('.subscription-row.selected') as HTMLElement | null;
    if (activeRow) {
      subscriptionId = activeRow.dataset['subscriptionId'];
      storeId = activeRow.dataset['storeId'];
    }
    if (!subscriptionId || !storeId) {
      this.errorHandler.handleBridgeApiError({ error: 'Subscription or Store not found.' });
      return;
    }
    try {
      const resp = await fetch(`/api/v1/stores/${encodeURIComponent(storeId)}/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!resp.ok) {
        const err = await resp.json();
        this.errorHandler.handleBridgeApiError(err);
        return;
      }
      const body = await resp.json();
      if (body.unsignedCall) {
        if ((window as any).walletIntegration && typeof (window as any).walletIntegration.openWallet === 'function') {
          (window as any).walletIntegration.openWallet(body.unsignedCall);
        }
      }
      await this.pollAndUpdateSubscriptionsTable();
      if (typeof (window as any).showToast === 'function') {
        (window as any).showToast('Subscription cancelled.');
      }
    } catch (err: any) {
      this.errorHandler.handleBridgeApiError(err);
    }
  }

  openInvoiceDrawer(invoiceId: string): void {
    this.invoiceDrawerUiDelegate.openDrawer(invoiceId);
  }

  handleCopyInvoiceLink(magicLink: string): void {
    navigator.clipboard.writeText(magicLink)
      .then(() => {
        if (typeof (window as any).showToast === 'function') {
          (window as any).showToast('Invoice link copied to clipboard');
        }
      })
      .catch(() => {
        if (typeof (window as any).showToast === 'function') {
          (window as any).showToast('Unable to copy invoice link.');
        }
      });
  }

  async handleSubscriptionInvoiceGet(req: any, res: any, next: any): Promise<void> {
    try {
      const storeId: string = req.params.storeId;
      const subscriptionId: string = req.params.id;
      if (!storeId || !subscriptionId) {
        res.status(400).json({ error: 'Missing storeId or subscriptionId' });
        return;
      }
      const dto = await this.bridgeApiClient.doRequest(
        'GET',
        `/api/v1/stores/${storeId}/subscriptions/${subscriptionId}/invoice`
      );
      res.json({
        invoice: dto.invoice,
        magicLink: dto.magicLink,
        unsignedCall: dto.unsignedCall
      });
    } catch (err) {
      next(err);
    }
  }

  async pollAndUpdateLinkedInvoices(): Promise<void> {
    await this.tablePollingDelegate.pollAndUpdateLinkedInvoices();
  }

  async pollAndUpdateSubscriptionsTable(): Promise<void> {
    await this.tablePollingDelegate.pollAndUpdateSubscriptionsTable();
  }

  closeCreateSubscriptionModal(): void {
    const modal = document.getElementById('createSubscriptionModal');
    if (modal) {
      modal.classList.add('hidden');
    }
    this.modalDelegate.reset();
  }
}

export { SubscriptionManager };
