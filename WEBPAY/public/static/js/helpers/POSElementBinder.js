// src/client/islands/helpers/POSElementBinder.ts
var POSElementBinder;
((POSElementBinder2) => {
  function bindAllPOSEventHandlers(handlers) {
    const form = document.getElementById("new-sale-form");
    form.onsubmit = function(event) {
      handlers.onFormSubmit(form, event);
    };
    const newSaleBtn = document.getElementById("new-sale");
    newSaleBtn && newSaleBtn.addEventListener("click", handlers.onNewSaleClick);
    const copyBtn = document.getElementById("copy-link");
    copyBtn && copyBtn.addEventListener("click", handlers.onCopyLinkClick);
    const showQRBtn = document.getElementById("show-qr");
    showQRBtn && showQRBtn.addEventListener("click", handlers.onShowQRClick);
    const drawerToggle = document.getElementById("drawer-toggle");
    drawerToggle && drawerToggle.addEventListener("click", handlers.onDrawerToggle);
    document.querySelectorAll(".invoice-row").forEach(
      (row) => row.addEventListener("click", handlers.onInvoiceRowClick)
    );
    document.querySelectorAll(".subscription-row").forEach(
      (row) => row.addEventListener("click", handlers.onSubscriptionRowClick)
    );
  }
  POSElementBinder2.bindAllPOSEventHandlers = bindAllPOSEventHandlers;
})(POSElementBinder || (POSElementBinder = {}));
export {
  POSElementBinder
};
//# sourceMappingURL=POSElementBinder.js.map
