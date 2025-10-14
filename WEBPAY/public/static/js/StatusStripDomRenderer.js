// src/client/islands/helpers/StatusStripDomRenderer.ts
var StatusStripDomRenderer = class {
  constructor() {
    this.statusStripEl = null;
    this.errorBannerEl = null;
    this.currentStatus = null;
  }
  updateStatus(status) {
    const el = this.getStatusStripEl();
    el.textContent = this.statusToDisplay(status);
    el.className = "status-strip px-2 py-1 rounded border text-sm font-medium transition-colors duration-200 " + this.statusToClasses(status);
    this.currentStatus = status;
    if (this.isTerminalStatus(status)) {
      el.setAttribute("data-terminal", "true");
    }
  }
  showError(message) {
    const errorEl = this.getErrorBannerEl(true);
    errorEl.textContent = message;
    errorEl.style.display = "block";
  }
  hideError() {
    const errorEl = this.getErrorBannerEl(false);
    if (errorEl) {
      errorEl.style.display = "none";
    }
  }
  validateAndInitHydration(h) {
    if (!h || typeof h.invoiceId !== "string" || !h.invoiceId) {
      return false;
    }
    this.currentStatus = null;
    this.hideError();
    return true;
  }
  getCurrentStatus() {
    return this.currentStatus;
  }
  getStatusStripEl() {
    if (this.statusStripEl) return this.statusStripEl;
    this.statusStripEl = document.getElementById("status-strip");
    return this.statusStripEl;
  }
  getErrorBannerEl(createIfMissing) {
    if (this.errorBannerEl) return this.errorBannerEl;
    let el = document.getElementById("status-strip-error");
    if (!el && createIfMissing) {
      const parent = this.getStatusStripEl();
      el = document.createElement("div");
      el.id = "status-strip-error";
      el.className = "status-strip-error px-2 py-1 rounded border bg-red-50 text-red-800 border-red-200 mt-2 text-sm font-medium";
      el.style.display = "none";
      if (parent && parent.parentNode) {
        parent.parentNode.insertBefore(el, parent.nextSibling);
      } else {
        document.body.appendChild(el);
      }
    }
    this.errorBannerEl = el;
    return this.errorBannerEl;
  }
  statusToDisplay(status) {
    switch (status) {
      case "unpaid":
        return "Awaiting payment";
      case "paid":
        return "Paid \u2713";
      case "partially_refunded":
        return "Partially Refunded";
      case "refunded":
        return "Refunded";
      case "canceled":
        return "Canceled";
      case "expired":
        return "Expired";
      default:
        return "Unknown";
    }
  }
  statusToClasses(status) {
    switch (status) {
      case "unpaid":
        return "bg-yellow-50 text-yellow-800 border-yellow-200";
      case "paid":
        return "bg-green-50 text-green-800 border-green-200";
      case "partially_refunded":
      case "refunded":
        return "bg-blue-50 text-blue-800 border-blue-200";
      case "canceled":
      case "expired":
        return "bg-gray-50 text-gray-800 border-gray-200";
      default:
        return "bg-red-50 text-red-800 border-red-200";
    }
  }
  isTerminalStatus(status) {
    return status === "paid" || status === "expired" || status === "canceled";
  }
};
export {
  StatusStripDomRenderer
};
//# sourceMappingURL=StatusStripDomRenderer.js.map
