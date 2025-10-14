export class StatusPollingBackoffManager {
  pollingDelay: number = 1200;
  minDelay: number = 1000;
  maxDelay: number = 60000;
  backoffFactor: number = 1.7;
  intervalId: number | null = null;
  suspended: boolean = false;

  startPolling(callback: () => void): void {
    this.clearPolling();
    this.intervalId = window.setInterval(callback, this.pollingDelay);
  }

  clearPolling(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  backoffAndRetry(callback: () => void): void {
    if (this.suspended) return;
    this.clearPolling();
    this.pollingDelay = Math.min(
      this.maxDelay,
      Math.max(this.minDelay, Math.floor(this.pollingDelay * this.backoffFactor))
    );
    window.setTimeout(callback, this.pollingDelay);
  }

  suspend(): void {
    this.suspended = true;
    this.clearPolling();
  }

  resume(callback: () => void, isTerminal: boolean): void {
    this.suspended = false;
    if (!isTerminal && this.intervalId === null) {
      this.startPolling(callback);
    }
  }

  resetDelay(): void {
    this.pollingDelay = 1200;
  }

  getPollingDelay(): number {
    return this.pollingDelay;
  }
}
