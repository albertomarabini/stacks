import { MagicLinkDTO } from '../models/core';

class InvoiceSuccessSheetUiDelegate {
  renderSuccessSheet(
    dto: MagicLinkDTO,
    handleCopy: (link: string) => void,
    handleSend: () => void
  ): void {
    const sheet = document.getElementById('subscriptionInvoiceSheet');
    const amtElem = document.getElementById('subscriptionInvoice-amount');
    const expElem = document.getElementById('subscriptionInvoice-expiry');
    const linkElem = document.getElementById('subscriptionInvoice-magicLink');
    const copyBtn = document.getElementById('subscriptionInvoice-copyBtn');
    const sendBtn = document.getElementById('subscriptionInvoice-sendEmailBtn');
    const qrElem = document.getElementById('subscriptionInvoice-qr');

    if (amtElem) amtElem.textContent = `${dto.invoice.amountSats} sats`;
    if (expElem) expElem.textContent = new Date(dto.invoice.quoteExpiresAt).toLocaleString();
    if (linkElem) {
      linkElem.textContent = dto.magicLink;
      (linkElem as HTMLAnchorElement).href = dto.magicLink;
    }
    if (copyBtn) copyBtn.onclick = () => handleCopy(dto.magicLink);
    if (sendBtn) sendBtn.onclick = handleSend;
    if (qrElem && typeof (window as any).renderQR === 'function') {
      (window as any).renderQR(dto.magicLink, qrElem);
    }
    if (sheet) sheet.classList.remove('hidden');
  }
}

export { InvoiceSuccessSheetUiDelegate };
