// frontend/checkout/delegates/StatusBadgeDelegate.ts
import type { InvoiceStatus } from '/src/contracts/domain';

export class StatusBadgeDelegate {
  setStatusBadge(status: InvoiceStatus, selector: string = '#statusBadge'): void {
    const badge = document.querySelector(selector) as HTMLElement;

    badge.className = 'badge';
    switch (status) {
      case 'unpaid':
        badge.classList.add('badge-unpaid');
        badge.textContent = 'Unpaid';
        break;
      case 'paid':
        badge.classList.add('badge-paid');
        badge.textContent = 'Paid';
        break;
      case 'partially_refunded':
        badge.classList.add('badge-partial');
        badge.textContent = 'Partially Refunded';
        break;
      case 'refunded':
        badge.classList.add('badge-refunded');
        badge.textContent = 'Refunded';
        break;
      case 'canceled':
        badge.classList.add('badge-canceled');
        badge.textContent = 'Canceled';
        break;
      case 'expired':
        badge.classList.add('badge-expired');
        badge.textContent = 'Expired';
        break;
    }
    badge.setAttribute('aria-live', 'polite');
  }
}
