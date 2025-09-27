import QRCode from 'qrcode';

class QRRenderer {
  /**
   * Generates a QR code for the provided URL.
   *
   * @param qrData - Object with a `url` property (the data to encode).
   * @param options - Optional options:
   *     size: number of pixels per side (default: 192)
   *     format: 'canvas' | 'svg' | 'img' (default: 'canvas')
   * @returns HTMLElement (canvas/svg/img) or string (SVG XML), or void.
   */
  static render(
    qrData: { url: string },
    options?: { size?: number; format?: 'canvas' | 'svg' | 'img' }
  ): HTMLElement | string | void {
    const url = qrData.url;
    const size = options && options.size ? options.size : 192;
    const format = options && options.format ? options.format : 'canvas';

    if (!url) return;

    // Browser environment
    if (typeof window !== 'undefined' && window.document) {
      if (format === 'canvas') {
        const canvas = document.createElement('canvas');
        // Asynchronous, but returns canvas immediately for the UI
        QRCode.toCanvas(canvas, url, { width: size, errorCorrectionLevel: 'M' });
        return canvas;
      }
      if (format === 'svg') {
        // QRCode.toString returns Promise, so cannot return synchronously
        // Callers needing SVG should use QRCode.toString async directly
        return '';
      }
      if (format === 'img') {
        const img = document.createElement('img');
        QRCode.toDataURL(url, { width: size, errorCorrectionLevel: 'M' })
          .then((dataUrl: string) => {
            img.src = dataUrl;
          });
        img.width = size;
        img.height = size;
        return img;
      }
    } else {
      // Node.js/server environment
      if (format === 'svg') {
        // Cannot return synchronously in Node; callers should use async QRCode.toString
        return;
      }
      // canvas/img cannot be returned in Node
      return;
    }
    // Default fallback: void
    return;
  }
}

export { QRRenderer };
