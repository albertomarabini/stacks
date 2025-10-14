import * as QRCode from "qrcode";

export const QRCodeUtility = {
  draw(canvas: HTMLCanvasElement, url: string): void {
    void QRCode.toCanvas(canvas, url, { errorCorrectionLevel: 'H', width: 256, margin: 1 })
      .catch(err => console.error("QR render failed:", err));
  }
};
