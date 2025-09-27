class RefundDrawerManager {
  /**
   * Opens the refund drawer/modal and populates the fields.
   * @param {Invoice} invoice - The invoice DTO containing refund data.
   */
  openRefundDrawer(invoice) {
    const drawer = document.getElementById('refund-drawer');
    drawer.style.display = '';
    const paidEl = drawer.querySelector('.refund-paid');
    const refundedEl = drawer.querySelector('.refund-refunded');
    const remainingEl = drawer.querySelector('.refund-remaining');
    const input = drawer.querySelector('.refund-amount');
    const paid = invoice.amountSats;
    const refunded = invoice.refundAmount || 0;
    const remaining = paid - refunded;
    paidEl.textContent = paid.toString();
    refundedEl.textContent = refunded.toString();
    remainingEl.textContent = remaining.toString();
    input.max = remaining.toString();
  }
}

export { RefundDrawerManager };
