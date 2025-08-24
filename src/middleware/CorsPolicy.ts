// src/middleware/CorsPolicy.ts
import type { ISqliteStore } from '/src/contracts/dao';

export class CorsPolicy {
  private store!: ISqliteStore;

  bindStore(store: ISqliteStore): void {
    this.store = store;
  }

  publicCorsOriginValidator(
    origin: string | undefined,
    cb: (err: Error | null, allow?: boolean) => void,
    req: import('express').Request,
  ): void {
    if (!origin) {
      cb(new Error('Not allowed'), false);
      return;
    }

    const path = req.path;
    let allowedCsv: string | undefined;

    if (/^\/i\/[^/]+$/.test(path)) {
      const invoiceId = (req.params as any).invoiceId as string;
      const row = this.store.getInvoiceWithStore(invoiceId);
      allowedCsv = (row as any)?.store?.allowed_origins as string | undefined;
    } else if (path === '/create-tx') {
      const invoiceId = (req.query as any)?.invoiceId as string | undefined;
      if (!invoiceId) {
        cb(new Error('Not allowed'), false);
        return;
      }
      const row = this.store.getInvoiceWithStore(invoiceId);
      allowedCsv = (row as any)?.store?.allowed_origins as string | undefined;
    } else if (/^\/api\/v1\/stores\/[^/]+\/public-profile$/.test(path)) {
      const storeId = (req.params as any).storeId as string;
      const rows = this.store.listMerchantsProjection() as any[];
      const m = rows.find((r) => r.id === storeId);
      allowedCsv = m?.allowed_origins as string | undefined;
    } else {
      cb(new Error('Not allowed'), false);
      return;
    }

    if (!allowedCsv) {
      cb(new Error('Not allowed'), false);
      return;
    }

    const allowlist = allowedCsv
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);

    const ok = allowlist.includes(origin.toLowerCase());
    if (ok) {
      cb(null, true);
      return;
    }
    cb(new Error('Not allowed'), false);
  }
}
