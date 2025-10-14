export namespace DrawerContentRenderer {
  export function renderInvoiceContent(
    invoiceId: string | undefined,
    drawer: HTMLElement,
    hydrated: any,
    onClose: () => void
  ): void {
    const invoiceList = hydrated.invoiceList;
    const invoice = invoiceList.find((inv: any) => inv.invoiceId === invoiceId);
    if (!invoice) throw new Error('No hydrated invoice DTO found for drawer.');
    drawer.innerHTML = `
      <div class="drawer-header">
        <span>Invoice #${invoice.invoiceId}</span>
        <button type="button" id="drawer-close-btn" aria-label="Close">&times;</button>
      </div>
      <div class="drawer-content">
        <dl>
          <dt>Status</dt><dd>${invoice.status}</dd>
          <dt>Amount</dt><dd>${invoice.amountSats}</dd>
          <dt>Created</dt><dd>${invoice.createdAt || ''}</dd>
        </dl>
        ${invoice.eventHistory ? `<div class="event-history">${renderEventHistory(invoice.eventHistory)}</div>` : ''}
      </div>
    `;
    const closeBtn = drawer.querySelector('#drawer-close-btn');
    closeBtn && (closeBtn.addEventListener('click', onClose));

    function renderEventHistory(events: Array<any>): string {
      return `<ul>${events
        .map(
          (evt: any) =>
            `<li><span class="evt-kind">${evt.kind}</span> <span class="evt-ts">${evt.timestamp || ''}</span></li>`,
        )
        .join('')}</ul>`;
    }
  }

  export function renderSubscriptionContent(
    subscriptionId: string | undefined,
    drawer: HTMLElement,
    hydrated: any,
    onClose: () => void
  ): void {
    const subscriptionList = hydrated.subscriptionList;
    const subscription = subscriptionList.find((sub: any) => sub.subscriptionId === subscriptionId);
    if (!subscription) throw new Error('No hydrated subscription DTO found for drawer.');
    drawer.innerHTML = `
      <div class="drawer-header">
        <span>Subscription #${subscription.subscriptionId}</span>
        <button type="button" id="drawer-close-btn" aria-label="Close">&times;</button>
      </div>
      <div class="drawer-content">
        <dl>
          <dt>Status</dt><dd>${subscription.status}</dd>
          <dt>Plan</dt><dd>${subscription.planName || ''}</dd>
          <dt>Schedule</dt><dd>${subscription.schedule || ''}</dd>
        </dl>
        ${subscription.eventHistory ? `<div class="event-history">${renderEventHistory(subscription.eventHistory)}</div>` : ''}
      </div>
    `;
    const closeBtn = drawer.querySelector('#drawer-close-btn');
    closeBtn && (closeBtn.addEventListener('click', onClose));

    function renderEventHistory(events: Array<any>): string {
      return `<ul>${events
        .map(
          (evt: any) =>
            `<li><span class="evt-kind">${evt.kind}</span> <span class="evt-ts">${evt.timestamp || ''}</span></li>`,
        )
        .join('')}</ul>`;
    }
  }
}
