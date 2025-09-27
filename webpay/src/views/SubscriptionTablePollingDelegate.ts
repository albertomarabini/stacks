import { Subscription } from '../models/core';

class SubscriptionTablePollingDelegate {
  currentStoreId: string | null = null;
  currentSubscriptionId: string | null = null;
  pollIntervals: Record<string, any> = {};

  bridgeApiClient: any;
  errorHandler: any;

  constructor(opts?: { bridgeApiClient?: any; errorHandler?: any }) {
    if (opts && opts.bridgeApiClient) {
      this.bridgeApiClient = opts.bridgeApiClient;
    } else if ((window as any).bridgeApiClient) {
      this.bridgeApiClient = (window as any).bridgeApiClient;
    }
    if (opts && opts.errorHandler) {
      this.errorHandler = opts.errorHandler;
    } else if ((window as any).errorHandler) {
      this.errorHandler = (window as any).errorHandler;
    }
  }

  startSubscriptionsPolling(storeId: string): void {
    this.currentStoreId = storeId;
    if (this.pollIntervals['subscriptions']) clearInterval(this.pollIntervals['subscriptions']);
    this.pollIntervals['subscriptions'] = setInterval(() => this.pollAndUpdateSubscriptionsTable(), 1000);
  }

  stopSubscriptionsPolling(): void {
    if (this.pollIntervals['subscriptions']) clearInterval(this.pollIntervals['subscriptions']);
    this.pollIntervals['subscriptions'] = null;
  }

  async pollAndUpdateSubscriptionsTable(): Promise<void> {
    if (!this.currentStoreId) return;
    try {
      let subs: Subscription[];
      if (this.bridgeApiClient && typeof this.bridgeApiClient.doRequest === 'function') {
        subs = await this.bridgeApiClient.doRequest(
          'GET',
          `/api/v1/stores/${this.currentStoreId}/subscriptions`
        );
      } else {
        const resp = await fetch(`/api/v1/stores/${encodeURIComponent(this.currentStoreId)}/subscriptions`);
        if (!resp.ok) return;
        subs = await resp.json();
      }
      subs.forEach((sub: any) => {
        const row = document.getElementById(`subscriptionRow-${sub.subscriptionId}`);
        if (!row) return;
        (row.querySelector('.subscription-status') as HTMLElement).textContent = sub.status;
        (row.querySelector('.subscription-amount') as HTMLElement).textContent = `${sub.amountSats} sats`;
        (row.querySelector('.subscription-interval') as HTMLElement).textContent = `${sub.intervalBlocks} blocks`;
        (row.querySelector('.subscription-mode') as HTMLElement).textContent = sub.mode;
        (row.querySelector('.subscription-nextDue') as HTMLElement).textContent = sub.nextDue;
        (row.querySelector('.subscription-lastBilled') as HTMLElement).textContent = sub.lastBilled || '-';
        const genInvBtn = row.querySelector('.subscription-generateInvoiceBtn') as HTMLButtonElement;
        if (genInvBtn) genInvBtn.disabled = (sub.status !== 'active');
        const cancelBtn = row.querySelector('.subscription-cancelBtn') as HTMLButtonElement;
        if (cancelBtn) cancelBtn.disabled = (sub.status !== 'active');
      });
    } catch (err: any) {
      if (this.errorHandler && typeof this.errorHandler.handleBridgeApiError === 'function') {
        this.errorHandler.handleBridgeApiError(err);
      }
    }
  }

  startLinkedInvoicesPolling(subscriptionId: string, storeId: string): void {
    this.currentSubscriptionId = subscriptionId;
    this.currentStoreId = storeId;
    if (this.pollIntervals['linkedInvoices']) clearInterval(this.pollIntervals['linkedInvoices']);
    this.pollIntervals['linkedInvoices'] = setInterval(() => this.pollAndUpdateLinkedInvoices(), 1000);
  }

  stopLinkedInvoicesPolling(): void {
    if (this.pollIntervals['linkedInvoices']) clearInterval(this.pollIntervals['linkedInvoices']);
    this.pollIntervals['linkedInvoices'] = null;
    this.currentSubscriptionId = null;
  }

  async pollAndUpdateLinkedInvoices(): Promise<void> {
    if (!this.currentSubscriptionId || !this.currentStoreId) return;
    try {
      let sub: Subscription;
      if (this.bridgeApiClient && typeof this.bridgeApiClient.doRequest === 'function') {
        sub = await this.bridgeApiClient.doRequest(
          'GET',
          `/api/v1/stores/${this.currentStoreId}/subscriptions/${this.currentSubscriptionId}`
        );
      } else {
        const resp = await fetch(
          `/api/v1/stores/${encodeURIComponent(this.currentStoreId)}/subscriptions/${encodeURIComponent(this.currentSubscriptionId)}`
        );
        if (!resp.ok) return;
        sub = await resp.json();
      }
      const invoices = sub.linkedInvoices;
      invoices.forEach((inv: any) => {
        const row = document.getElementById(`linkedInvoiceRow-${inv.invoiceId}`);
        if (!row) return;
        (row.querySelector('.linkedInvoice-status') as HTMLElement).textContent = inv.status;
        (row.querySelector('.linkedInvoice-amount') as HTMLElement).textContent = `${inv.amountSats} sats`;
        (row.querySelector('.linkedInvoice-expiry') as HTMLElement).textContent = new Date(inv.quoteExpiresAt).toLocaleString();
        const openBtn = row.querySelector('.linkedInvoice-openBtn') as HTMLButtonElement;
        if (openBtn) openBtn.disabled = (inv.status === 'expired' || inv.status === 'canceled');
        const copyBtn = row.querySelector('.linkedInvoice-copyBtn') as HTMLButtonElement;
        if (copyBtn) copyBtn.disabled = (inv.status !== 'unpaid' && inv.status !== 'pending');
      });
    } catch (err: any) {
      if (this.errorHandler && typeof this.errorHandler.handleBridgeApiError === 'function') {
        this.errorHandler.handleBridgeApiError(err);
      }
    }
  }
}

export { SubscriptionTablePollingDelegate };
