// frontend/checkout/delegates/InvoiceStatusPollerDelegate.ts

export type InvoiceFetcher = (invoiceId: string, signal: AbortSignal) => Promise<any>;
export type InvoiceHandler = (dto: any) => void;

export class InvoiceStatusPollerDelegate {
  private invoiceId: string | null = null;
  private intervalMs = 15000;
  private intervalId: number | undefined;
  private abort: AbortController | null = null;
  private fetcher: InvoiceFetcher | null = null;
  private handler: InvoiceHandler | null = null;
  private isPolling = false;

  start(invoiceId: string, intervalMs: number, fetcher: InvoiceFetcher, handler: InvoiceHandler): void {
    this.stop();
    this.invoiceId = invoiceId;
    this.intervalMs = intervalMs;
    this.fetcher = fetcher;
    this.handler = handler;
    this.intervalId = window.setInterval(() => void this.tick(), this.intervalMs);
  }

  async tick(): Promise<void> {
    if (!this.invoiceId || !this.fetcher || !this.handler) return;
    if (this.abort) this.abort.abort();
    this.abort = new AbortController();
    this.isPolling = true;
    try {
      const dto = await this.fetcher(this.invoiceId, this.abort.signal);
      this.handler(dto);
    } catch {
      // Silent failure; next tick will try again.
    } finally {
      this.isPolling = false;
    }
  }

  stop(): void {
    if (this.intervalId !== undefined) {
      window.clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    if (this.abort) {
      this.abort.abort();
      this.abort = null;
    }
    this.invoiceId = null;
    this.fetcher = null;
    this.handler = null;
    this.isPolling = false;
  }
}
