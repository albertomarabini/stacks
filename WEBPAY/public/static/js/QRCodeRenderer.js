// src/client/islands/helpers/QRCodeRenderer.ts
var QRCodeRenderer = class {
  static draw(canvas, link) {
    const ctx = canvas.getContext("2d");
    ctx && ctx.clearRect(0, 0, canvas.width, canvas.height);
    window.QRCode.toCanvas(
      canvas,
      link,
      { width: 256, margin: 1 },
      () => {
      }
    );
  }
};
export {
  QRCodeRenderer
};
//# sourceMappingURL=QRCodeRenderer.js.map
