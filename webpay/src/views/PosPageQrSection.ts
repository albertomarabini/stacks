class PosPageQrSection {
  /**
   * Generates HTML for the QR section for a given magic link URL.
   * If no magicLinkUrl, returns a hidden QR section.
   * @param {string} magicLinkUrl
   * @returns {string}
   */
  static renderQrSection(magicLinkUrl) {
    if (!magicLinkUrl) {
      return '<div id="qrSection" class="mt-6 flex justify-center hidden"></div>';
    }
    return `
    <div id="qrSection" class="mt-6 flex justify-center">
      <canvas id="invoice-qr-canvas"></canvas>
      <script>
        window.QRCode.toCanvas(
          document.getElementById('invoice-qr-canvas'),
          ${JSON.stringify(magicLinkUrl)},
          { width: 192, errorCorrectionLevel: 'M' }
        );
      </script>
    </div>
  `;
  }
}

export { PosPageQrSection };
