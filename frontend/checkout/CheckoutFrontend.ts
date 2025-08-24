// frontend/checkout/CheckoutFrontend.ts
import { InvoiceCountdownDelegate } from '/frontend/checkout/delegates/InvoiceCountdownDelegate';
import { InvoiceStatusPollerDelegate } from '/frontend/checkout/delegates/InvoiceStatusPollerDelegate';
import { WalletContractCallDelegate } from '/frontend/checkout/delegates/WalletContractCallDelegate';
import { StoreBrandingDelegate } from '/frontend/checkout/delegates/StoreBrandingDelegate';
import { StatusBadgeDelegate } from '/frontend/checkout/delegates/StatusBadgeDelegate';
import { PaymentActionsDelegate } from '/frontend/checkout/delegates/PaymentActionsDelegate';
import { PublicCheckoutApiClient } from '/frontend/checkout/delegates/PublicCheckoutApiClient';
import { QrRenderDelegate } from '/frontend/checkout/delegates/QrRenderDelegate';
import { BannerDelegate } from '/frontend/checkout/delegates/BannerDelegate';
import type { PublicInvoiceDTO, StorePublicProfileDTO, UnsignedContractCall, InvoiceStatus } from '/src/contracts/domain';

const HIGHLIGHT_THRESHOLD_MS = 60_000;

type UiState = {
  invoice: PublicInvoiceDTO | null;
  store: StorePublicProfileDTO | null;
  loaderAbort: AbortController | null;
};

function extractInvoiceIdFromPath(path: string): string | null {
  const m = path.match(/^\/i\/([^/]+)$/);
  return m ? decodeURIComponent(m[1]) : null;
}

function show(selector: string): void {
  const el = document.querySelector(selector) as HTMLElement | null;
  if (el) el.removeAttribute('hidden');
}

function hide(selector: string): void {
  const el = document.querySelector(selector) as HTMLElement | null;
  if (el) el.setAttribute('hidden', 'true');
}

function wireOpenWalletButton(): void {
  const btn = document.getElementById('openWallet') as HTMLButtonElement | null;
  if (btn) {
    btn.onclick = () => void CheckoutFrontend.onOpenWallet();
    btn.removeAttribute('hidden');
  }
}

export const CheckoutFrontend = {
  state: {
    invoice: null,
    store: null,
    loaderAbort: null,
  } as UiState,

  _countdown: new InvoiceCountdownDelegate({ highlightThresholdMs: HIGHLIGHT_THRESHOLD_MS }),
  _poller: new InvoiceStatusPollerDelegate(),
  _wallet: new WalletContractCallDelegate(),
  _branding: new StoreBrandingDelegate(),
  _badge: new StatusBadgeDelegate(),
  _actions: new PaymentActionsDelegate(),
  _api: new PublicCheckoutApiClient(),
  _qr: new QrRenderDelegate(),
  _banner: new BannerDelegate(),

  async onRouteEnter(_evt?: Event): Promise<void> {
    const invoiceId = extractInvoiceIdFromPath(location.pathname);
    this.clearTimers();
    this.resetUiState();
    wireOpenWalletButton();
    if (!invoiceId) {
      this.renderNotFound();
      return;
    }
    this.state.loaderAbort = new AbortController();
    try {
      const dto = await this.fetchInvoiceJson(invoiceId, { signal: this.state.loaderAbort.signal });
      await this.handleInvoiceResponse(dto);
    } catch (e: any) {
      if (e && typeof e.status === 'number' && e.status === 404) {
        this.renderNotFound();
        return;
      }
      this.banner('Failed to load invoice', 'error');
    }
  },

  clearTimers(): void {
    this._countdown.stop();
    this._poller.stop();
  },

  resetUiState(): void {
    this.state.invoice = null;
    this.state.store = null;

    hide('#expiredView');

    const badge = document.querySelector('#statusBadge') as HTMLElement | null;
    if (badge) {
      badge.className = 'badge';
      badge.textContent = 'Loading…';
    }

    const banner = document.querySelector('#banner') as HTMLElement | null;
    if (banner) banner.setAttribute('hidden', 'true');

    const btn = document.getElementById('openWallet') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = false;
      btn.removeAttribute('hidden');
    }

    const actions = document.querySelector('#actions') as HTMLElement | null;
    if (actions) actions.removeAttribute('hidden');

    const qr = document.querySelector('#qrCanvas') as HTMLCanvasElement | null;
    if (qr) {
      const ctx = qr.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, qr.width, qr.height);
    }
  },

  async fetchInvoiceJson(invoiceId: string, opts?: { signal?: AbortSignal }): Promise<PublicInvoiceDTO> {
    return this._api.fetchInvoiceJson(invoiceId, opts);
  },

  renderNotFound(): void {
    this.disablePaymentActions();
    const container = document.querySelector('#checkoutContainer') as HTMLElement | null;
    if (container) {
      container.innerHTML = '<div class="not-found">Invoice not found.</div>';
    }
  },

  async onRouteChange(): Promise<void> {
    const invoiceId = extractInvoiceIdFromPath(location.pathname);
    this.clearTimers();
    this.resetUiState();
    if (this.state.loaderAbort) this.state.loaderAbort.abort();
    wireOpenWalletButton();
    if (!invoiceId) {
      this.renderNotFound();
      return;
    }
    this.state.loaderAbort = new AbortController();
    try {
      const dto = await this.fetchInvoiceJson(invoiceId, { signal: this.state.loaderAbort.signal });
      await this.handleInvoiceResponse(dto);
    } catch (e: any) {
      if (e && typeof e.status === 'number' && e.status === 404) {
        this.renderNotFound();
        return;
      }
      this.banner('Failed to load invoice', 'error');
    }
  },

  async handleInvoiceResponse(invoice: PublicInvoiceDTO): Promise<void> {
    if (
      !invoice ||
      typeof invoice.invoiceId !== 'string' ||
      typeof invoice.storeId !== 'string' ||
      typeof invoice.status !== 'string' ||
      !Number.isInteger(invoice.amountSats) ||
      typeof invoice.quoteExpiresAt !== 'number' ||
      typeof invoice.idHex !== 'string' ||
      !/^[0-9A-Fa-f]{64}$/.test(invoice.idHex)
    ) {
      this.banner('Invalid invoice payload', 'error');
      return;
    }

    this.state.invoice = invoice;
    this.setStatusBadge(invoice.status as InvoiceStatus);

    if (invoice.store) {
      this.applyBranding(invoice.store);
      this.state.store = invoice.store;
    } else {
      const profile = await this.fetchStorePublicProfile(invoice.storeId);
      this.applyBranding(profile);
      this.state.store = profile;
    }

    if (invoice.status === 'unpaid') {
      this.renderQr(invoice.invoiceId);
      show('#openWallet');
      this.startCountdown(invoice.quoteExpiresAt);
      this.startPoll(invoice.invoiceId, 15000);
    } else {
      this.disablePaymentActions();
    }
  },

  setStatusBadge(status: InvoiceStatus): void {
    this._badge.setStatusBadge(status, '#statusBadge');
  },

  async fetchStorePublicProfile(storeId: string, opts?: { signal?: AbortSignal }): Promise<StorePublicProfileDTO> {
    return this._api.fetchStorePublicProfile(storeId, opts);
  },

  renderQr(invoiceId: string): void {
    this._qr.renderInvoiceLink('#qrCanvas', invoiceId);
  },

  startCountdown(quoteExpiresAtMs: number): void {
    this._countdown.start(
      quoteExpiresAtMs,
      (timeLeftMs) => this.renderCountdown(timeLeftMs),
      () => {
        this.setStatusBadge('expired');
        this.disablePaymentActions();
        show('#expiredView');
      },
    );
  },

  startPoll(invoiceId: string, intervalMs: number = 15000): void {
    const client = this._api;
    this._poller.start(
      invoiceId,
      intervalMs,
      (id, signal) => client.fetchInvoiceJson(id, { signal }),
      (dto) => this.handlePoll(dto),
    );
  },

  disablePaymentActions(): void {
    this._actions.disablePaymentActions();
  },

  applyBranding(profile: StorePublicProfileDTO): void {
    this._branding.applyBranding(profile);
  },

  updateHeader(displayName?: string, logoUrl?: string): void {
    this._branding.updateHeader(displayName, logoUrl);
  },

  async onOpenWallet(): Promise<void> {
    const provider = this._wallet.getProvider();
    if (!provider) {
      this.banner('Wallet not connected', 'error');
      return;
    }
    if (!this.state.invoice) return;
    const res = await this.requestCreateTx(this.state.invoice.invoiceId);
    await this.handleCreateTxResponse(res);
  },

  getStacksProvider(): (Window & typeof globalThis)['StacksProvider'] | null {
    return this._wallet.getProvider();
  },

  async requestCreateTx(invoiceId: string): Promise<Response> {
    return fetch('/create-tx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceId }),
    });
  },

  banner(message: string, type: 'info' | 'success' | 'error' = 'info'): void {
    this._banner.show(message, type, '#banner');
  },

  async handleCreateTxResponse(res: Response): Promise<void> {
    if (res.ok) {
      const payload = (await res.json()) as UnsignedContractCall;
      await this.invokeWalletOpenContractCall(payload);
      return;
    }
    switch (res.status) {
      case 404:
        this.banner('Invoice not found', 'error');
        break;
      case 409:
        this.banner('Invoice cannot be paid (already paid, canceled, or expired)', 'error');
        break;
      case 400:
        this.banner('Invalid invoice ID', 'error');
        break;
      case 422:
        this.banner('Merchant inactive or sBTC token not configured', 'error');
        break;
      case 426:
        this.banner('Wrong network selected in wallet', 'error');
        break;
      default:
        this.banner('Failed to prepare transaction', 'error');
    }
  },

  async invokeWalletOpenContractCall(payload: UnsignedContractCall): Promise<void> {
    await this._wallet.openUnsignedContractCall(
      payload as unknown as Record<string, any>,
      (tx) => this.onTxFinish(tx),
      () => this.onTxCancel(),
    );
  },

  onTxFinish(tx?: unknown): void {
    this._wallet.onFinish(this.banner.bind(this), () => this.disableOpenWallet(), tx);
  },

  disableOpenWallet(): void {
    this._wallet.disableOpenWallet('#openWallet');
  },

  onTxCancel(): void {
    this._wallet.onCancel(this.banner.bind(this));
  },

  handlePoll(fresh: PublicInvoiceDTO): void {
    if (fresh.status === 'paid') {
      this.setStatusBadge('paid');
      this.banner('Payment confirmed', 'success');
      this.disablePaymentActions();
      this.clearTimers();
      return;
    }
    if (fresh.status === 'expired' || fresh.status === 'canceled') {
      this.setStatusBadge(fresh.status as InvoiceStatus);
      this.disablePaymentActions();
      this.clearTimers();
    }
  },

  updateCountdown(): void {
    this._countdown.forceTick();
  },

  renderCountdown(timeLeftMs: number): void {
    const node = document.querySelector('#countdown') as HTMLElement | null;
    if (!node) return;
    const totalSeconds = Math.floor(timeLeftMs / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    node.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    if (timeLeftMs <= HIGHLIGHT_THRESHOLD_MS) node.classList.add('expiring');
    else node.classList.remove('expiring');
  },

  handleExpiry(): void {
    this._countdown.expireNow();
  },

  async pollStatus(): Promise<void> {
    await this._poller.tick();
  },
};

// Register global event listeners on module load
document.addEventListener('DOMContentLoaded', () => {
  void CheckoutFrontend.onRouteEnter();
});

window.addEventListener('popstate', () => {
  void CheckoutFrontend.onRouteChange();
});
