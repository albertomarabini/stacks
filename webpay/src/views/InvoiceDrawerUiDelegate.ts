import { Invoice } from '../models/core';

class InvoiceDrawerUiDelegate {
  openDrawer(invoiceId: string): void {
    const drawer = document.getElementById('invoiceDrawer');
    drawer.classList.remove('hidden');
    fetch(`/i/${invoiceId}`)
      .then(resp => resp.json())
      .then((invoice: Invoice) => {
        (document.getElementById('invoiceDrawer-amount') as HTMLElement).textContent = `${invoice.amountSats} sats`;
        (document.getElementById('invoiceDrawer-status') as HTMLElement).textContent = invoice.status;
        (document.getElementById('invoiceDrawer-memo') as HTMLElement).textContent = invoice.memo;
        (document.getElementById('invoiceDrawer-expiry') as HTMLElement).textContent = new Date(invoice.quoteExpiresAt).toLocaleString();
        const refundBtn = document.getElementById('invoiceDrawer-refundBtn') as HTMLButtonElement;
        const copyBtn = document.getElementById('invoiceDrawer-copyBtn') as HTMLButtonElement;
        if (refundBtn) refundBtn.disabled = (invoice.status !== 'paid');
        if (copyBtn) copyBtn.disabled = !invoice.txId;
      });
  }
}

export { InvoiceDrawerUiDelegate };
