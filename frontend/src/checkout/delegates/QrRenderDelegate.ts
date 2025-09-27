// frontend/checkout/delegates/QrRenderDelegate.ts

export class QrRenderDelegate {
  renderInvoiceLink(canvasSelector: string, invoiceId: string): void {
    const canvas = document.querySelector(canvasSelector) as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const link = `${location.protocol}//${location.host}/i/${encodeURIComponent(invoiceId)}`;
    ctx.fillStyle = '#000000';
    ctx.font = '14px monospace';
    ctx.fillText('Scan link:', 10, 20);
    ctx.fillText(link, 10, 40);
  }
}
