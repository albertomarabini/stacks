// src/client/islands/helpers/DrawerContentRenderer.ts
var DrawerContentRenderer;
((DrawerContentRenderer2) => {
  function renderInvoiceContent(invoiceId, drawer, hydrated, onClose) {
    const invoiceList = hydrated.invoiceList;
    const invoice = invoiceList.find((inv) => inv.invoiceId === invoiceId);
    if (!invoice) throw new Error("No hydrated invoice DTO found for drawer.");
    drawer.innerHTML = `
      <div class="drawer-header">
        <span>Invoice #${invoice.invoiceId}</span>
        <button type="button" id="drawer-close-btn" aria-label="Close">&times;</button>
      </div>
      <div class="drawer-content">
        <dl>
          <dt>Status</dt><dd>${invoice.status}</dd>
          <dt>Amount</dt><dd>${invoice.amountSats}</dd>
          <dt>Created</dt><dd>${invoice.createdAt || ""}</dd>
        </dl>
        ${invoice.eventHistory ? `<div class="event-history">${renderEventHistory(invoice.eventHistory)}</div>` : ""}
      </div>
    `;
    const closeBtn = drawer.querySelector("#drawer-close-btn");
    closeBtn && closeBtn.addEventListener("click", onClose);
    function renderEventHistory(events) {
      return `<ul>${events.map(
        (evt) => `<li><span class="evt-kind">${evt.kind}</span> <span class="evt-ts">${evt.timestamp || ""}</span></li>`
      ).join("")}</ul>`;
    }
  }
  DrawerContentRenderer2.renderInvoiceContent = renderInvoiceContent;
  function renderSubscriptionContent(subscriptionId, drawer, hydrated, onClose) {
    const subscriptionList = hydrated.subscriptionList;
    const subscription = subscriptionList.find((sub) => sub.subscriptionId === subscriptionId);
    if (!subscription) throw new Error("No hydrated subscription DTO found for drawer.");
    drawer.innerHTML = `
      <div class="drawer-header">
        <span>Subscription #${subscription.subscriptionId}</span>
        <button type="button" id="drawer-close-btn" aria-label="Close">&times;</button>
      </div>
      <div class="drawer-content">
        <dl>
          <dt>Status</dt><dd>${subscription.status}</dd>
          <dt>Plan</dt><dd>${subscription.planName || ""}</dd>
          <dt>Schedule</dt><dd>${subscription.schedule || ""}</dd>
        </dl>
        ${subscription.eventHistory ? `<div class="event-history">${renderEventHistory(subscription.eventHistory)}</div>` : ""}
      </div>
    `;
    const closeBtn = drawer.querySelector("#drawer-close-btn");
    closeBtn && closeBtn.addEventListener("click", onClose);
    function renderEventHistory(events) {
      return `<ul>${events.map(
        (evt) => `<li><span class="evt-kind">${evt.kind}</span> <span class="evt-ts">${evt.timestamp || ""}</span></li>`
      ).join("")}</ul>`;
    }
  }
  DrawerContentRenderer2.renderSubscriptionContent = renderSubscriptionContent;
})(DrawerContentRenderer || (DrawerContentRenderer = {}));
export {
  DrawerContentRenderer
};
//# sourceMappingURL=DrawerContentRenderer.js.map
