class InvoiceListUiRefresher {
  async refreshInvoiceRows(): Promise<void> {
    const rows = document.querySelectorAll('[data-invoice-id]');
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i] as HTMLElement;
      const invoiceId = row.dataset['invoiceId'];
      if (!invoiceId) continue;
      try {
        const resp = await fetch(`/i/${encodeURIComponent(invoiceId)}`);
        if (!resp.ok) continue;
        const invoice = await resp.json();
        const statusCell = row.querySelector('.invoice-status') as HTMLElement;
        if (statusCell) statusCell.textContent = invoice.status;
        if (['paid', 'expired', 'canceled'].includes(invoice.status)) {
          const payBtn = row.querySelector('.pay-btn') as HTMLButtonElement;
          if (payBtn) payBtn.disabled = true;
        }
      } catch {
        // Do nothing on polling error.
      }
    }
  }
}

export { InvoiceListUiRefresher };
