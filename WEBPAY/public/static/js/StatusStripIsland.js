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

// src/client/islands/helpers/StatusPollingBackoffManager.ts
var StatusPollingBackoffManager = class {
  constructor() {
    this.pollingDelay = 1200;
    this.minDelay = 1e3;
    this.maxDelay = 6e4;
    this.backoffFactor = 1.7;
    this.intervalId = null;
    this.suspended = false;
  }
  startPolling(callback) {
    this.clearPolling();
    this.intervalId = window.setInterval(callback, this.pollingDelay);
  }
  clearPolling() {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
  backoffAndRetry(callback) {
    if (this.suspended) return;
    this.clearPolling();
    this.pollingDelay = Math.min(
      this.maxDelay,
      Math.max(this.minDelay, Math.floor(this.pollingDelay * this.backoffFactor))
    );
    window.setTimeout(callback, this.pollingDelay);
  }
  suspend() {
    this.suspended = true;
    this.clearPolling();
  }
  resume(callback, isTerminal) {
    this.suspended = false;
    if (!isTerminal && this.intervalId === null) {
      this.startPolling(callback);
    }
  }
  resetDelay() {
    this.pollingDelay = 1200;
  }
  getPollingDelay() {
    return this.pollingDelay;
  }
};

// src/client/islands/helpers/StatusStripStatusMapper.ts
var StatusStripStatusMapper = class {
  static statusToDisplay(status) {
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
  static statusToClasses(status) {
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
  static isTerminalStatus(status) {
    return status === "paid" || status === "expired" || status === "canceled";
  }
};

// src/client/islands/StatusStripIsland.ts
var _StatusStripIsland = class _StatusStripIsland {
  static hasInvoice() {
    const h = window.__PAGE__;
    return !!(h && typeof h.invoiceId === "string" && h.invoiceId.length > 0);
  }
  static pollStatus() {
    if (!_StatusStripIsland.hasInvoice()) return;
    const { invoiceId, storeId } = window.__PAGE__;
    fetch(`/status/${storeId}/${invoiceId}`, { headers: { Accept: "application/json" }, cache: "no-store" }).then((response) => {
      _StatusStripIsland.handleStatusResponse(response);
      _StatusStripIsland.backoffManager.resetDelay();
    }).catch((err) => {
      _StatusStripIsland.handleStatusError(err);
      _StatusStripIsland.backoffManager.backoffAndRetry(
        _StatusStripIsland.pollStatus.bind(_StatusStripIsland)
      );
    });
  }
  static handleVisibilityChange() {
    if (document.hidden) {
      _StatusStripIsland.backoffManager.suspend();
      return;
    }
    if (!_StatusStripIsland.hasInvoice()) return;
    const currentStatus = _StatusStripIsland.domRenderer.getCurrentStatus();
    const isTerminal = StatusStripStatusMapper.isTerminalStatus(currentStatus);
    _StatusStripIsland.backoffManager.resume(
      _StatusStripIsland.pollStatus.bind(_StatusStripIsland),
      isTerminal
    );
  }
  static handleBeforeUnload() {
    _StatusStripIsland.backoffManager.clearPolling();
  }
  static handleStatusResponse(response) {
    response.json().then((dto) => {
      const status = dto.status;
      if (status !== _StatusStripIsland.domRenderer.getCurrentStatus()) {
        _StatusStripIsland.domRenderer.updateStatus(status);
      }
      _StatusStripIsland.domRenderer.hideError();
      if (StatusStripStatusMapper.isTerminalStatus(status)) {
        _StatusStripIsland.backoffManager.clearPolling();
        document.dispatchEvent(new CustomEvent("invoice:terminal", { detail: { status } }));
      }
    }).catch(() => {
      _StatusStripIsland.domRenderer.showError("Error parsing payment status. Retrying\u2026");
    });
  }
  static handleStatusError(_error) {
    _StatusStripIsland.domRenderer.showError("Error fetching payment status. Retrying\u2026");
    _StatusStripIsland.backoffManager.backoffAndRetry(
      _StatusStripIsland.pollStatus.bind(_StatusStripIsland)
    );
  }
  static handleHydration(hydration) {
    const ok = _StatusStripIsland.domRenderer.validateAndInitHydration(hydration);
    if (!ok) {
      _StatusStripIsland.backoffManager.clearPolling();
      return;
    }
  }
};
_StatusStripIsland.domRenderer = new StatusStripDomRenderer();
_StatusStripIsland.backoffManager = new StatusPollingBackoffManager();
var StatusStripIsland = _StatusStripIsland;
document.addEventListener("DOMContentLoaded", () => {
  const hydration = window.__PAGE__;
  StatusStripIsland.handleHydration(hydration);
  if (StatusStripIsland["hasInvoice"]()) {
    StatusStripIsland.pollStatus();
    StatusStripIsland.backoffManager.startPolling(
      StatusStripIsland.pollStatus.bind(StatusStripIsland)
    );
  }
});
document.addEventListener("invoice:ready", () => {
  if (!StatusStripIsland["hasInvoice"]()) return;
  StatusStripIsland.pollStatus();
  StatusStripIsland.backoffManager.startPolling(
    StatusStripIsland.pollStatus.bind(StatusStripIsland)
  );
});
document.addEventListener("invoice:purged", () => {
  StatusStripIsland.backoffManager.clearPolling();
});
document.addEventListener(
  "visibilitychange",
  StatusStripIsland.handleVisibilityChange.bind(StatusStripIsland)
);
window.addEventListener(
  "beforeunload",
  StatusStripIsland.handleBeforeUnload.bind(StatusStripIsland)
);
export {
  StatusStripIsland
};
//# sourceMappingURL=StatusStripIsland.js.map
