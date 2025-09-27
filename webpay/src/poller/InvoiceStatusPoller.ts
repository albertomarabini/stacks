import { TerminalInvoiceStatusUiManager } from '../views/TerminalInvoiceStatusUiManager';
import { Invoice } from '../models/core';

class InvoiceStatusPoller {
  private pollingIntervals: Record<string, number>;
  private lastStatuses: Record<string, string>;
  private terminalUiManager: TerminalInvoiceStatusUiManager;

  constructor() {
    this.pollingIntervals = {};
    this.lastStatuses = {};
    this.terminalUiManager = new TerminalInvoiceStatusUiManager();
  }

  public startPolling(invoiceId: string): void {
    if (this.pollingIntervals[invoiceId]) return;
    this.pollingIntervals[invoiceId] = window.setInterval(() => {
      this.pollInvoiceStatus(invoiceId);
    }, 1000);
  }

  public async pollInvoiceStatus(invoiceId: string): Promise<void> {
    const resp = await fetch(`/i/${encodeURIComponent(invoiceId)}`);
    if (!resp.ok) {
      return;
    }
    const invoice: Invoice = await resp.json();
    const status = invoice.status;
    if (this.lastStatuses[invoiceId] === status) return;
    this.lastStatuses[invoiceId] = status;
    if (status === 'paid') {
      this.handlePaidStatus(invoiceId, invoice);
      this.clearPolling(invoiceId);
    } else if (status === 'expired') {
      this.handleExpiredStatus(invoiceId, invoice);
      this.clearPolling(invoiceId);
    } else if (status === 'canceled') {
      this.handleCanceledStatus(invoiceId, invoice);
      this.clearPolling(invoiceId);
    }
  }

  public handleTerminalStatus(
    invoiceId: string,
    status: 'paid' | 'expired' | 'canceled',
    statusData: Invoice
  ): void {
    this.clearPolling(invoiceId);
    switch (status) {
      case 'paid':
        this.terminalUiManager.handlePaid(invoiceId, statusData);
        break;
      case 'expired':
        this.terminalUiManager.handleExpired(invoiceId, statusData);
        break;
      case 'canceled':
        this.terminalUiManager.handleCanceled(invoiceId, statusData);
        break;
    }
  }

  public handlePaidStatus(invoiceId: string, statusData: Invoice): void {
    this.terminalUiManager.handlePaid(invoiceId, statusData);
  }

  public handleExpiredStatus(invoiceId: string, statusData: Invoice): void {
    this.terminalUiManager.handleExpired(invoiceId, statusData);
  }

  public handleCanceledStatus(invoiceId: string, statusData: Invoice): void {
    this.terminalUiManager.handleCanceled(invoiceId, statusData);
  }

  private clearPolling(invoiceId: string): void {
    if (this.pollingIntervals[invoiceId]) {
      clearInterval(this.pollingIntervals[invoiceId]);
      delete this.pollingIntervals[invoiceId];
      delete this.lastStatuses[invoiceId];
    }
  }
}

export { InvoiceStatusPoller };
