class InvoiceUiFeedbackRenderer {
  renderInvoiceSuccessSheet(
    invoice,
    magicLink,
    unsignedCall,
    emailHandler,
    qrHandler
  ) {
    const modal = document.getElementById('invoice-success-modal');
    const amt = modal.querySelector('.invoice-success-amount');
    const exp = modal.querySelector('.invoice-success-expiry');
    const link = modal.querySelector('.invoice-success-magiclink');
    const emailBtn = modal.querySelector('.invoice-success-email-btn');
    const qrBtn = modal.querySelector('.invoice-success-qr-btn');
    amt.textContent = invoice.amountSats.toString();
    exp.textContent = invoice.quoteExpiresAt;
    link.value = magicLink;
    link.readOnly = true;
    emailBtn.onclick = () => emailHandler(invoice.invoiceId);
    qrBtn.onclick = () => qrHandler(magicLink);
    modal.style.display = '';
  }

  showToast(msg) {
    let toast = document.getElementById('merchant-console-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'merchant-console-toast';
      toast.className = 'fixed top-4 right-4 bg-blue-700 text-white px-4 py-2 rounded shadow z-50';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.style.display = '';
    setTimeout(() => {
      toast.style.display = 'none';
    }, 2000);
  }

  disableInvoiceRow(invoiceId, status) {
    const row = document.querySelector(`[data-invoice-id="${invoiceId}"]`);
    const statusCell = row.querySelector('.invoice-status');
    statusCell.textContent = status;
    row.classList.add('opacity-50', 'pointer-events-none');
  }

  hideInvoiceRow(invoiceId) {
    const row = document.querySelector(`[data-invoice-id="${invoiceId}"]`);
    row.style.display = 'none';
  }

  async handleCopyLink(magicLink) {
    try {
      await navigator.clipboard.writeText(magicLink);
      this.showToast('Magic link copied to clipboard');
    } catch {
      this.showToast('Unable to copy link.');
    }
  }
}

export { InvoiceUiFeedbackRenderer };
