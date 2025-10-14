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
export {
  StatusPollingBackoffManager
};
//# sourceMappingURL=StatusPollingBackoffManager.js.map
