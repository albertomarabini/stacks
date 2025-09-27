import { IMagicLinkClientScript } from '../contracts/interfaces';
import { UnsignedCall } from '../models/core';

// @ts-ignore
import { request } from '@stacks/connect';

class WalletIntegration {
  private magicLinkClientScript: IMagicLinkClientScript | undefined;
  private signing: boolean = false;

  constructor(deps?: { magicLinkClientScript?: IMagicLinkClientScript }) {
    this.magicLinkClientScript = deps?.magicLinkClientScript;
  }

  public async openWallet(unsignedCall: UnsignedCall): Promise<void> {
    if (this.signing) return;
    this.signing = true;
    try {
      const result = await request('stx_callContract', unsignedCall);
      this.handleWalletResult(result);
    } catch (err) {
      this.handleOnSignError(err);
    }
  }

  public handleWalletResult(result: { txid?: string; txId?: string; [key: string]: any }): void {
    this.signing = false;
    const txid = result.txid || result.txId;
    const statusEl = document.getElementById('checkout-status-strip');
    if (statusEl && txid) {
      statusEl.textContent = 'Broadcasted';
      statusEl.className = 'rounded px-2 py-1 font-semibold text-blue-700 bg-blue-100 border border-blue-400';
    }
    const txidEl = document.getElementById('broadcasted-txid');
    if (txidEl && txid) {
      txidEl.textContent = `Tx: ${txid}`;
      txidEl.className = 'block text-xs text-gray-600 mt-1';
    }
    if (this.magicLinkClientScript && txid) {
      this.magicLinkClientScript.handlePostWalletRedirect(txid);
    }
  }

  public handleSbtcTokenConfigResult(result: { txid?: string; txId?: string; [key: string]: any }): void {
    this.signing = false;
    const txid = result.txid || result.txId;
    const statusEl = document.getElementById('sbtc-config-status');
    if (statusEl && txid) {
      statusEl.textContent = 'sBTC Token Configured';
      statusEl.className = 'rounded px-2 py-1 font-semibold text-green-700 bg-green-100 border border-green-400';
    } else if (statusEl) {
      statusEl.textContent = 'sBTC Token Config Failed';
      statusEl.className = 'rounded px-2 py-1 font-semibold text-red-700 bg-red-100 border border-red-400';
    }
  }

  public handleBootstrapProtocolResult(result: { txid?: string; txId?: string; [key: string]: any }): void {
    this.signing = false;
    const txid = result.txid || result.txId;
    const statusEl = document.getElementById('bootstrap-status');
    if (statusEl && txid) {
      statusEl.textContent = 'Protocol Bootstrapped';
      statusEl.className = 'rounded px-2 py-1 font-semibold text-green-700 bg-green-100 border border-green-400';
    } else if (statusEl) {
      statusEl.textContent = 'Protocol Bootstrap Failed';
      statusEl.className = 'rounded px-2 py-1 font-semibold text-red-700 bg-red-100 border border-red-400';
    }
  }

  public handleSyncCallResult(
    result: { txid?: string; txId?: string; [key: string]: any },
    callIndex: number,
    totalCalls: number
  ): void {
    this.signing = false;
    const txid = result.txid || result.txId;
    const rowEl = document.getElementById(`sync-row-${callIndex}`);
    if (rowEl && txid) {
      rowEl.textContent = `Sync ${callIndex + 1}/${totalCalls}: Success (Tx: ${txid})`;
      rowEl.className = 'text-green-700';
    } else if (rowEl) {
      rowEl.textContent = `Sync ${callIndex + 1}/${totalCalls}: Failed`;
      rowEl.className = 'text-red-700';
    }
    if (callIndex === totalCalls - 1) {
      const finalEl = document.getElementById('sync-complete-status');
      if (finalEl) {
        finalEl.textContent = 'Sync complete';
        finalEl.className = 'font-semibold text-green-700';
      }
    }
  }

  public handleRefundSignResult(result: { txid?: string; txId?: string; [key: string]: any }): void {
    this.signing = false;
    const refundDrawer = document.getElementById('refund-drawer');
    if (refundDrawer) refundDrawer.setAttribute('aria-busy', 'false');
    if ((window as any).invoiceStatusPoller && typeof (window as any).invoiceStatusPoller.fetchAndUpdateInvoiceStatus === 'function') {
      (window as any).invoiceStatusPoller.fetchAndUpdateInvoiceStatus();
    }
  }

  public handleOnSignResult(result: { txid?: string; txId?: string; [key: string]: any }): void {
    this.signing = false;
    if ((window as any).magicLinkClientScript && typeof (window as any).magicLinkClientScript.fetchAndUpdateInvoiceStatus === 'function') {
      (window as any).magicLinkClientScript.fetchAndUpdateInvoiceStatus();
    }
    if ((window as any).subscriptionTablePollingDelegate && typeof (window as any).subscriptionTablePollingDelegate.pollAndUpdateSubscriptionsTable === 'function') {
      (window as any).subscriptionTablePollingDelegate.pollAndUpdateSubscriptionsTable();
    }
  }

  public handleOnSignError(error: any): void {
    this.signing = false;
    if ((window as any).errorHandler && typeof (window as any).errorHandler.handleBridgeApiError === 'function') {
      (window as any).errorHandler.handleBridgeApiError(error);
    }
  }
}

export { WalletIntegration };
