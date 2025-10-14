export namespace POSElementBinder {
  export function bindAllPOSEventHandlers(handlers: {
    onFormSubmit: (form: HTMLFormElement, event: Event) => void;
    onNewSaleClick: (event: MouseEvent) => void;
    onCopyLinkClick: (event: MouseEvent) => void;
    onShowQRClick: (event: MouseEvent) => void;
    onDrawerToggle: (event: MouseEvent) => void;
    onInvoiceRowClick: (event: MouseEvent) => void;
    onSubscriptionRowClick: (event: MouseEvent) => void;
  }): void {
    const form = document.getElementById('new-sale-form') as HTMLFormElement;
    form.onsubmit = function (event: Event) {
      handlers.onFormSubmit(form, event);
    };
    const newSaleBtn = document.getElementById('new-sale');
    newSaleBtn && (newSaleBtn.addEventListener('click', handlers.onNewSaleClick));
    const copyBtn = document.getElementById('copy-link');
    copyBtn && (copyBtn.addEventListener('click', handlers.onCopyLinkClick));
    const showQRBtn = document.getElementById('show-qr');
    showQRBtn && (showQRBtn.addEventListener('click', handlers.onShowQRClick));
    const drawerToggle = document.getElementById('drawer-toggle');
    drawerToggle && (drawerToggle.addEventListener('click', handlers.onDrawerToggle));
    document.querySelectorAll<HTMLElement>('.invoice-row').forEach((row) =>
      row.addEventListener('click', handlers.onInvoiceRowClick)
    );
    document.querySelectorAll<HTMLElement>('.subscription-row').forEach((row) =>
      row.addEventListener('click', handlers.onSubscriptionRowClick)
    );
  }
}
