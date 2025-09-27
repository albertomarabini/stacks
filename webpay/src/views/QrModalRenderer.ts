class QrModalRenderer {
  showQrModal(magicLink) {
    const qrModal = document.getElementById('invoice-qr-modal');
    const qrCanvas = document.getElementById('invoice-qr-canvas');
    if (qrModal && qrCanvas && window.QRCode) {
      qrModal.style.display = '';
      qrCanvas.width = 192;
      qrCanvas.height = 192;
      window.QRCode.toCanvas(qrCanvas, magicLink, { width: 192, margin: 0 });
    }
  }
}

export { QrModalRenderer };
