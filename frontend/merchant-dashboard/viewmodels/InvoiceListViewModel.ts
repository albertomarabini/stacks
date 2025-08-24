// /frontend/merchant-dashboard/viewmodels/InvoiceListViewModel.ts
import { PublicInvoiceDTO, InvoiceStatus } from '/src/contracts/domain';

export class InvoiceListViewModel {
  private invoices: PublicInvoiceDTO[] = [];
  private filtered: PublicInvoiceDTO[] = [];
  private sortDirection: 'asc' | 'desc' = 'desc';

  public setData(invoices: PublicInvoiceDTO[], filtered: PublicInvoiceDTO[], sortDir: 'asc' | 'desc'): void {
    this.invoices = [...invoices];
    this.filtered = [...filtered];
    this.sortDirection = sortDir;
  }

  public updateAfterCreate(created: PublicInvoiceDTO): { invoices: PublicInvoiceDTO[]; filtered: PublicInvoiceDTO[] } {
    const exists = this.invoices.find((i) => i.invoiceId === created.invoiceId);
    const nextInvoices = exists
      ? this.invoices.map((i) => (i.invoiceId === created.invoiceId ? created : i))
      : [created, ...this.invoices];
    const nextFiltered = [created, ...this.filtered];
    return { invoices: nextInvoices, filtered: this.sort(nextFiltered, this.sortDirection) };
  }

  public setStatus(invoiceId: string, status: InvoiceStatus): { invoices: PublicInvoiceDTO[]; filtered: PublicInvoiceDTO[] } {
    const mapStatus = (arr: PublicInvoiceDTO[]) => arr.map((i) => (i.invoiceId === invoiceId ? { ...i, status } : i));
    const invoices = mapStatus(this.invoices);
    const filtered = mapStatus(this.filtered);
    return { invoices, filtered };
  }

  public applyFilter(value: InvoiceStatus | 'all'): { filtered: PublicInvoiceDTO[] } {
    const filtered = value === 'all' ? [...this.invoices] : this.invoices.filter((i) => i.status === value);
    return { filtered: this.sort(filtered, this.sortDirection) };
  }

  public sortByCreatedAt(direction: 'asc' | 'desc'): { filtered: PublicInvoiceDTO[] } {
    this.sortDirection = direction;
    return { filtered: this.sort([...this.filtered], direction) };
  }

  public toggleSort(): 'asc' | 'desc' {
    this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    return this.sortDirection;
  }

  public toCsv(rows: Array<{ invoiceId: string; amountSats: number; usdAtCreate: number; status: InvoiceStatus; txId?: string; createdAt: number; refundAmount?: number | string; refundTxId?: string }>): string {
    const headers = ['invoiceId', 'amountSats', 'usdAtCreate', 'status', 'txId', 'createdAt', 'refundAmount', 'refundTxId'];
    const escape = (v: unknown) => {
      const s = v === undefined || v === null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      headers.join(','),
      ...rows.map((r) =>
        [
          escape(r.invoiceId),
          escape(r.amountSats),
          escape(r.usdAtCreate),
          escape(r.status),
          escape(r.txId ?? ''),
          escape(r.createdAt),
          escape(r.refundAmount ?? ''),
          escape(r.refundTxId ?? ''),
        ].join(','),
      ),
    ];
    return lines.join('\n');
  }

  public exportCsv(rows: Array<{ invoiceId: string; amountSats: number; usdAtCreate: number; status: InvoiceStatus; txId?: string; createdAt: number; refundAmount?: number | string; refundTxId?: string }>): void {
    const csv = this.toCsv(rows);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'invoices.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  private sort(arr: PublicInvoiceDTO[], direction: 'asc' | 'desc'): PublicInvoiceDTO[] {
    const mult = direction === 'asc' ? 1 : -1;
    return arr.sort((a, b) => (a.createdAt - b.createdAt) * mult);
  }
}
