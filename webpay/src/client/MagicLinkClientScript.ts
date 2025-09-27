import { IWalletIntegration } from '../contracts/interfaces';
import { InvoiceStatusPoller } from '../poller/InvoiceStatusPoller';
import { MagicLinkU } from '../models/core';

class MagicLinkClientScript {
  private walletIntegration: IWalletIntegration;
  private invoiceStatusPoller: InvoiceStatusPoller;
  private countdownInterval: number | null = null;
  private pollingStarted: boolean = false;
  private uBlob: string | null = null;
  private validatedU: MagicLinkU | null = null;

  constructor(walletIntegration: IWalletIntegration) {
    this.walletIntegration = walletIntegration;
    this.invoiceStatusPoller = new InvoiceStatusPoller();
  }

  public initMagicLinkPage(): void {
    const globalData = (window as any).magicLinkPageData || {};
    let uBlob: string | null = null;
    if (globalData.unsignedCall && globalData.exp && globalData.storeId) {
      // SSR-injected data: extract from URL for defense-in-depth validation
      const params = new URLSearchParams(window.location.search);
      uBlob = params.get('u');
    } else {
      const params = new URLSearchParams(window.location.search);
      uBlob = params.get('u');
    }
    this.uBlob = uBlob;

    if (!uBlob || !this.validateU(uBlob)) {
      this.disableWalletActions();
      this.showExpiredState();
      return;
    }

    // At this point, validatedU is guaranteed and non-expired
    const validatedU = this.validatedU!;
    const unsignedCall = validatedU.unsignedCall;
    const exp = validatedU.exp;
    const invoiceId = validatedU.invoiceId;

    this.startCountdown(exp);

    if (!this.pollingStarted && invoiceId) {
      this.invoiceStatusPoller.startPolling(invoiceId);
      this.pollingStarted = true;
    }

    this.tryAutoOpenWallet(unsignedCall);

    const btn = document.getElementById('open-wallet-btn');
    if (btn) {
      btn.onclick = () => this.walletIntegration.openWallet(unsignedCall);
    }
  }

  public validateU(uBlob: string): boolean {
    let decoded: any;
    try {
      let b64 = uBlob.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4 !== 0) b64 += '=';
      const buf = atob(b64);
      decoded = JSON.parse(buf);
    } catch {
      this.disableWalletActions();
      this.showErrorBanner('Invalid payment link.');
      return false;
    }
    if (!decoded.exp || !decoded.unsignedCall) {
      this.disableWalletActions();
      this.showErrorBanner('Malformed payment link.');
      return false;
    }
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp <= now) {
      this.disableWalletActions();
      this.showExpiredState();
      return false;
    }
    const uc = decoded.unsignedCall;
    if (
      !uc.postConditionMode ||
      uc.postConditionMode !== 'deny' ||
      !Array.isArray(uc.postConditions) ||
      uc.postConditions.length === 0
    ) {
      this.disableWalletActions();
      this.showErrorBanner('Payment link missing required safety controls.');
      return false;
    }
    const hasFtEq = uc.postConditions.some(
      (pc: any) =>
        pc.type === 'ft-postcondition' &&
        pc.condition === 'eq' &&
        typeof pc.amount === 'string'
    );
    if (!hasFtEq) {
      this.disableWalletActions();
      this.showErrorBanner('Payment link missing required payment constraint.');
      return false;
    }
    this.validatedU = decoded;
    this.enableWalletActions();
    return true;
  }

  public showOpenWalletButton(): void {
    let btn = document.getElementById('open-wallet-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'open-wallet-btn';
      btn.textContent = 'Open wallet';
      btn.className =
        'mt-6 w-full py-3 rounded bg-blue-600 text-white font-bold text-lg hover:bg-blue-700 focus:outline-none';
      const parent = document.querySelector('.max-w-md');
      if (parent) parent.appendChild(btn);
    }
    btn.onclick = () => {
      if (this.validatedU) {
        this.walletIntegration.openWallet(this.validatedU.unsignedCall);
      }
    };
    btn.style.display = '';
    btn.disabled = false;
  }

  public startCountdown(expiryTimestamp: number): void {
    const expiryEl = document.getElementById('expiry');
    const stateEl = document.getElementById('status-strip');
    const btn = document.getElementById('open-wallet-btn') as HTMLButtonElement | null;

    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }

    const tick = () => {
      const now = Math.floor(Date.now() / 1000);
      let remaining = expiryTimestamp - now;
      if (remaining < 0) remaining = 0;
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      if (expiryEl) {
        expiryEl.textContent =
          remaining > 0
            ? `${mins}:${secs.toString().padStart(2, '0')}`
            : 'Expired';
      }
      if (remaining === 0) {
        if (stateEl) {
          stateEl.textContent = 'Expired';
          stateEl.className =
            'rounded px-2 py-1 font-semibold text-yellow-900 bg-yellow-200 border border-yellow-400 text-center w-full mb-3';
        }
        if (btn) {
          btn.disabled = true;
          btn.style.display = 'none';
        }
        this.disableWalletActions();
        this.showExpiredState();
        clearInterval(this.countdownInterval!);
        this.countdownInterval = null;
      }
    };

    tick();
    this.countdownInterval = window.setInterval(tick, 1000);
  }

  public handlePostWalletRedirect(txid: string): void {
    const params = new URLSearchParams(window.location.search);
    const returnUrl = params.get('return');
    if (returnUrl) {
      const sep = returnUrl.includes('?') ? '&' : '?';
      window.location.href = `${returnUrl}${sep}txid=${encodeURIComponent(txid)}`;
    }
  }

  public async fetchAndUpdateInvoiceStatus(): Promise<void> {
    if (!this.validatedU || !this.validatedU.invoiceId) return;
    const invoiceId = this.validatedU.invoiceId;
    const resp = await fetch(`/i/${encodeURIComponent(invoiceId)}`);
    if (!resp.ok) return;
    const invoice = await resp.json();
    const status = invoice.status;
    const stateEl = document.getElementById('status-strip');
    const btn = document.getElementById('open-wallet-btn') as HTMLButtonElement | null;
    if (status === 'paid') {
      if (stateEl) {
        stateEl.textContent = 'Paid ✓';
        stateEl.className =
          'rounded px-2 py-1 font-semibold text-green-700 bg-green-100 border border-green-400';
      }
      if (btn) {
        btn.disabled = true;
        btn.style.display = 'none';
      }
      this.disableWalletActions();
      const successBanner = document.getElementById('success-banner');
      if (successBanner) {
        successBanner.textContent = 'Payment complete.';
        successBanner.classList.remove('hidden');
      }
      if (invoice.txId) {
        let txEl = document.getElementById('txid');
        if (!txEl) {
          txEl = document.createElement('div');
          txEl.id = 'txid';
          txEl.className = 'block text-xs text-gray-600 mt-1';
          if (stateEl && stateEl.parentElement) {
            stateEl.parentElement.appendChild(txEl);
          }
        }
        txEl.textContent = `Tx: ${invoice.txId}`;
      }
    } else if (status === 'expired') {
      if (stateEl) {
        stateEl.textContent = 'Expired';
        stateEl.className =
          'rounded px-2 py-1 font-semibold text-yellow-900 bg-yellow-200 border border-yellow-400 text-center w-full mb-3';
      }
      if (btn) {
        btn.disabled = true;
        btn.style.display = 'none';
      }
      this.disableWalletActions();
      this.showExpiredState();
    } else if (status === 'canceled') {
      if (stateEl) {
        stateEl.textContent = 'Canceled';
        stateEl.className =
          'rounded px-2 py-1 font-semibold text-gray-700 bg-gray-200 border border-gray-400 text-center w-full mb-3';
      }
      if (btn) {
        btn.disabled = true;
        btn.style.display = 'none';
      }
      this.disableWalletActions();
      this.showErrorBanner('This payment was canceled.');
    }
  }

  private tryAutoOpenWallet(unsignedCall: any): void {
    let autoOpened = false;
    if ((window as any).Stacks && (window as any).Stacks.connect && typeof (window as any).Stacks.connect.request === 'function') {
      try {
        (window as any).Stacks.connect
          .request('stx_callContract', unsignedCall)
          .then((result: any) => {
            this.walletIntegration.handleWalletResult(result);
          })
          .catch(() => {
            this.showOpenWalletButton();
          });
        autoOpened = true;
      } catch {
        this.showOpenWalletButton();
      }
    }
    if (!autoOpened) {
      this.showOpenWalletButton();
    }
  }

  private disableWalletActions(): void {
    const btn = document.getElementById('open-wallet-btn') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.style.display = 'none';
    }
  }

  private enableWalletActions(): void {
    const btn = document.getElementById('open-wallet-btn') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = false;
      btn.style.display = '';
    }
  }

  private showExpiredState(): void {
    const stateEl = document.getElementById('status-strip');
    if (stateEl) {
      stateEl.textContent = 'Expired';
      stateEl.className =
        'rounded px-2 py-1 font-semibold text-yellow-900 bg-yellow-200 border border-yellow-400 text-center w-full mb-3';
    }
    const btn = document.getElementById('open-wallet-btn');
    if (btn) {
      btn.setAttribute('disabled', 'true');
      btn.style.display = 'none';
    }
    this.showErrorBanner('This payment link has expired. Please request a new payment.');
  }

  private showErrorBanner(msg: string): void {
    const banner = document.getElementById('error-banner');
    if (banner) {
      banner.textContent = msg;
      banner.classList.remove('hidden');
    }
  }
}

(window as any).magicLinkClientScript = new MagicLinkClientScript(
  (window as any).walletIntegration || (window as any).WalletIntegration || {}
);
window.addEventListener('DOMContentLoaded', function () {
  (window as any).magicLinkClientScript.initMagicLinkPage();
});

export { MagicLinkClientScript };
