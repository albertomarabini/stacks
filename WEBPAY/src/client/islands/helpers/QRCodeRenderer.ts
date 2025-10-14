export class QRCodeRenderer {
  static draw(canvas: HTMLCanvasElement, link: string): void {
    // No defensive: let this fail loudly if misused.
    const ctx = canvas.getContext('2d');
    ctx && (ctx.clearRect(0, 0, canvas.width, canvas.height));
    (window as any).QRCode.toCanvas(
      canvas,
      link,
      { width: 256, margin: 1 },
      () => {}
    );
  }
}
