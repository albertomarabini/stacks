import { Invoice } from '../models/core';

class TerminalInvoiceStatusUiManager {
  public handlePaid(invoiceId: string, statusData: Invoice): void {
    const statusEl = document.getElementById(`status-strip-${invoiceId}`);
    if (statusEl) {
      statusEl.textContent = 'Paid ✓';
      statusEl.className = 'rounded px-2 py-1 font-semibold text-green-700 bg-green-100 border border-green-400';
    }
    if (statusData.txId) {
      const txEl = document.getElementById(`txid-${invoiceId}`);
      if (txEl) {
        txEl.textContent = `Tx: ${statusData.txId}`;
        txEl.className = 'block text-xs text-gray-600 mt-1';
      }
    }
    const newSaleBtn = document.getElementById(`new-sale-btn-${invoiceId}`);
    if (newSaleBtn) {
      newSaleBtn.style.display = '';
      newSaleBtn.disabled = false;
      newSaleBtn.className =
        'mt-4 px-4 py-2 rounded bg-blue-600 text-white font-semibold hover:bg-blue-700';
      newSaleBtn.onclick = () => {
        if (statusEl) statusEl.textContent = '';
        const txEl = document.getElementById(`txid-${invoiceId}`);
        if (txEl) txEl.textContent = '';
        newSaleBtn.style.display = 'none';
        const form = document.getElementById(
          `sale-form-${invoiceId}`
        ) as HTMLFormElement | null;
        if (form) form.reset();
      };
    }
    const payBtn = document.getElementById(`pay-btn-${invoiceId}`);
    if (payBtn) {
      payBtn.style.display = 'none';
      payBtn.disabled = true;
    }
    const qrEl = document.getElementById(`qr-${invoiceId}`);
    if (qrEl) {
      qrEl.style.opacity = '0.5';
    }
  }

  public handleExpired(invoiceId: string, statusData: Invoice): void {
    const statusEl = document.getElementById(`status-strip-${invoiceId}`);
    if (statusEl) {
      statusEl.textContent = 'Expired';
      statusEl.className = 'rounded px-2 py-1 font-semibold text-yellow-900 bg-yellow-200 border border-yellow-400';
    }
    const payBtn = document.getElementById(`pay-btn-${invoiceId}`);
    if (payBtn) {
      payBtn.style.display = 'none';
      payBtn.disabled = true;
    }
    const qrEl = document.getElementById(`qr-${invoiceId}`);
    if (qrEl) {
      qrEl.style.opacity = '0.2';
    }
    const newInvBtn = document.getElementById(`new-invoice-btn-${invoiceId}`);
    if (newInvBtn) {
      newInvBtn.style.display = '';
      newInvBtn.disabled = false;
      newInvBtn.className =
        'mt-4 px-4 py-2 rounded bg-blue-600 text-white font-semibold hover:bg-blue-700';
    }
    // Leave form fields as-is for quick repeat
  }

  public handleCanceled(invoiceId: string, statusData: Invoice): void {
    const payBtn = document.getElementById(`pay-btn-${invoiceId}`);
    if (payBtn) {
      payBtn.style.display = 'none';
      payBtn.disabled = true;
    }
    const statusEl = document.getElementById(`status-strip-${invoiceId}`);
    if (statusEl) {
      statusEl.textContent = 'Canceled';
      statusEl.className = 'rounded px-2 py-1 font-semibold text-gray-700 bg-gray-200 border border-gray-400';
    }
    const qrEl = document.getElementById(`qr-${invoiceId}`);
    if (qrEl) {
      qrEl.style.opacity = '0.2';
    }
    const refundBtn = document.getElementById(`refund-btn-${invoiceId}`);
    if (refundBtn) {
      refundBtn.style.display = 'none';
      refundBtn.disabled = true;
    }
    const canceledMsgEl = document.getElementById(`canceled-msg-${invoiceId}`);
    if (canceledMsgEl) {
      canceledMsgEl.innerHTML = 'This invoice has been canceled.';
      canceledMsgEl.className = 'text-sm mt-2 text-gray-500';
    }
  }
}

export { TerminalInvoiceStatusUiManager };
