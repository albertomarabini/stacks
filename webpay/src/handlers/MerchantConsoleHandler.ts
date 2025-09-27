import { IBridgeApiClient, IBrandingProfileManager, IErrorHandler, ISessionManager } from '../contracts/interfaces';
import { InvoiceUiFeedbackRenderer } from '../views/InvoiceUiFeedbackRenderer';
import { QrModalRenderer } from '../views/QrModalRenderer';
import { RefundDrawerManager } from '../views/RefundDrawerManager';
import { InvoiceListUiRefresher } from '../views/InvoiceListUiRefresher';

class MerchantConsoleHandler {
  private bridgeApiClient: IBridgeApiClient;
  private brandingProfileManager: IBrandingProfileManager;
  private errorHandler: IErrorHandler;
  private sessionManager: ISessionManager;
  public uiFeedbackRenderer: InvoiceUiFeedbackRenderer;
  public qrModalRenderer: QrModalRenderer;
  public refundDrawerManager: RefundDrawerManager;
  public invoiceListUiRefresher: InvoiceListUiRefresher;

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
    this.uiFeedbackRenderer = new InvoiceUiFeedbackRenderer();
    this.qrModalRenderer = new QrModalRenderer();
    this.refundDrawerManager = new RefundDrawerManager();
    this.invoiceListUiRefresher = new InvoiceListUiRefresher();
  }

  handleCreateInvoice(): void {
    const modal = document.getElementById('create-invoice-modal') as HTMLElement;
    const storeIdInput = modal.querySelector('[name="storeId"]') as HTMLInputElement;
    const amountInput = modal.querySelector('[name="amount"]') as HTMLInputElement;
    const memoInput = modal.querySelector('[name="memo"]') as HTMLInputElement;
    const ttlInput = modal.querySelector('[name="ttl"]') as HTMLInputElement;
    const submitBtn = modal.querySelector('.create-invoice-btn') as HTMLButtonElement;

    const storeId = storeIdInput.value;
    const amount = Number(amountInput.value);
    const memo = memoInput.value;
    const ttl = Number(ttlInput.value);

    if (submitBtn) submitBtn.disabled = true;

    fetch(`/api/v1/stores/${encodeURIComponent(storeId)}/prepare-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount_sats: amount,
        memo,
        ttl_seconds: ttl
      })
    })
      .then(async resp => {
        if (!resp.ok) throw await resp.json();
        return resp.json();
      })
      .then((data: any) => {
        this.uiFeedbackRenderer.renderInvoiceSuccessSheet(
          data.invoice,
          data.magicLink,
          data.unsignedCall,
          this.handleEmailInvoice.bind(this),
          this.handleShowQr.bind(this)
        );
      })
      .catch(err => {
        this.errorHandler.handleBridgeApiError(err);
      })
      .finally(() => {
        if (submitBtn) submitBtn.disabled = false;
      });
  }

  handleCopyLink(magicLink: string): void {
    this.uiFeedbackRenderer.handleCopyLink(magicLink);
  }

  async handleEmailInvoice(invoiceId: string): Promise<void> {
    try {
      const res = await fetch(`/api/v1/invoices/${encodeURIComponent(invoiceId)}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) throw await res.json();
      this.uiFeedbackRenderer.showToast('Invoice email sent.');
    } catch (_err) {
      this.uiFeedbackRenderer.showToast('Failed to send email. Please try again.');
    }
  }

  handleShowQr(magicLink: string): void {
    this.qrModalRenderer.showQrModal(magicLink);
  }

  async handleCancelInvoice(invoiceId: string): Promise<void> {
    try {
      const res = await fetch(`/api/v1/invoices/${encodeURIComponent(invoiceId)}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        this.uiFeedbackRenderer.disableInvoiceRow(invoiceId, 'Canceled');
        this.uiFeedbackRenderer.showToast('Invoice canceled.');
      } else {
        const err = await res.json();
        this.errorHandler.handleBridgeApiError(err);
      }
    } catch (err) {
      this.errorHandler.handleBridgeApiError(err);
    }
  }

  async openRefundDrawer(invoiceId: string): Promise<void> {
    try {
      const resp = await fetch(`/i/${encodeURIComponent(invoiceId)}`);
      if (!resp.ok) throw await resp.json();
      const invoice = await resp.json();
      this.refundDrawerManager.openRefundDrawer(invoice);
    } catch (err) {
      this.errorHandler.handleBridgeApiError(err);
    }
  }

  async handleSubmitRefund(invoiceId: string, amount_sats: number, memo: string): Promise<void> {
    try {
      const res = await fetch(`/api/v1/stores/${encodeURIComponent(invoiceId)}/refunds/create-tx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId, amount_sats, memo })
      });
      if (!res.ok) {
        const err = await res.json();
        this.uiFeedbackRenderer.showToast('Refund failed: ' + ((err && err.error) ? err.error : 'Error'));
        return;
      }
      this.uiFeedbackRenderer.showToast('Refund ready to sign.');
    } catch (_err) {
      this.uiFeedbackRenderer.showToast('Refund failed. Please try again.');
    }
  }

  async handleFilterChange(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const filterContainer = input.closest('.dashboard-filter') as HTMLElement;
    const statusInput = filterContainer.querySelector('[name="status"]') as HTMLInputElement;
    const subscriptionIdInput = filterContainer.querySelector('[name="subscriptionId"]') as HTMLInputElement;
    const orderIdInput = filterContainer.querySelector('[name="orderId"]') as HTMLInputElement;

    const params = new URLSearchParams();
    if (statusInput && statusInput.value) params.append('status', statusInput.value);
    if (subscriptionIdInput && subscriptionIdInput.value) params.append('subscriptionId', subscriptionIdInput.value);
    if (orderIdInput && orderIdInput.value) params.append('orderId', orderIdInput.value);

    try {
      const resp = await fetch('/api/v1/invoices?' + params.toString());
      if (!resp.ok) throw await resp.json();
      const html = await resp.text();
      const list = document.getElementById('dashboard-invoice-list');
      if (list) list.innerHTML = html;
    } catch (err) {
      this.errorHandler.handleBridgeApiError(err);
    }
  }

  async handleWebhookLogsPagination(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const page = input.value;
    const container = document.getElementById('webhook-log-table');
    try {
      const resp = await fetch(`/api/v1/webhooks?page=${encodeURIComponent(page)}`);
      if (!resp.ok) throw await resp.json();
      const html = await resp.text();
      if (container) container.innerHTML = html;
    } catch (err) {
      this.errorHandler.handleBridgeApiError(err);
    }
  }

  async archiveInvoice(invoiceId: string): Promise<void> {
    try {
      const res = await fetch(`/api/v1/invoices/${encodeURIComponent(invoiceId)}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        this.uiFeedbackRenderer.hideInvoiceRow(invoiceId);
      } else {
        this.uiFeedbackRenderer.hideInvoiceRow(invoiceId);
      }
    } catch (_err) {
      this.uiFeedbackRenderer.hideInvoiceRow(invoiceId);
    }
  }

  async resendInvoice(invoiceId: string): Promise<void> {
    try {
      const res = await fetch(`/api/v1/invoices/${encodeURIComponent(invoiceId)}/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        this.uiFeedbackRenderer.showToast('Invoice email resent.');
      }
    } catch (_err) {
      this.uiFeedbackRenderer.showToast('Failed to resend invoice.');
    }
  }

  async handleInvoiceDetailGet(req, res, next): Promise<void> {
    try {
      const { storeId, invoiceId } = req.params;
      const invoice = await this.bridgeApiClient.prepareInvoice(storeId, { invoiceId });
      res.render('invoice-detail-drawer', { invoice });
    } catch (err) {
      next(err);
    }
  }

  async handlePreviewEmail(invoiceId: string): Promise<void> {
    try {
      const res = await fetch(`/api/v1/invoices/${encodeURIComponent(invoiceId)}/email-preview`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
      if (!res.ok) throw await res.json();
      const data = await res.json();
      const modal = document.getElementById('email-preview-modal');
      if (modal) {
        modal.querySelector('.email-preview-html').innerHTML = data.html;
        modal.querySelector('.email-preview-text').textContent = data.text;
        modal.style.display = '';
      }
    } catch (_err) {
      this.uiFeedbackRenderer.showToast('Could not render email preview.');
    }
  }

  async handleCopyMagicLink(invoiceId: string): Promise<void> {
    try {
      const resp = await fetch(`/api/v1/invoices/${encodeURIComponent(invoiceId)}/magic-link`);
      if (!resp.ok) throw await resp.json();
      const data = await resp.json();
      await this.uiFeedbackRenderer.handleCopyLink(data.magicLink);
    } catch (_err) {
      this.uiFeedbackRenderer.showToast('Unable to copy link.');
    }
  }

  async handleSendEmail(invoiceId: string, recipientEmail: string): Promise<void> {
    const btn = document.getElementById(`send-email-btn-${invoiceId}`) as HTMLButtonElement;
    if (btn) btn.disabled = true;
    try {
      const res = await fetch(`/api/v1/invoices/${encodeURIComponent(invoiceId)}/send-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipientEmail })
      });
      if (!res.ok) throw await res.json();
      this.uiFeedbackRenderer.showToast('Invoice email sent.');
    } catch (_err) {
      this.uiFeedbackRenderer.showToast('Failed to send invoice email.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async pollAndUpdateDashboardInvoices(): Promise<void> {
    await this.invoiceListUiRefresher.refreshInvoiceRows();
  }
}

export { MerchantConsoleHandler };
