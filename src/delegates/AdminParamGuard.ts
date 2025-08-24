// src/delegates/AdminParamGuard.ts
import type { InvoiceStatus } from '/src/contracts/domain';

export class AdminParamGuard {
  assertUuid(id: string): void {
    const re =
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
    if (!re.test(id)) {
      throw new TypeError('Invalid UUID');
    }
  }

  assertStacksPrincipal(p: string): void {
    if (typeof p !== 'string' || p.length < 2 || p[0] !== 'S') {
      throw new TypeError('Invalid Stacks principal/address');
    }
  }

  parseInvoiceStatuses(
    input: string | string[] | undefined,
  ): Array<'unpaid' | 'paid' | 'partially_refunded' | 'refunded' | 'canceled' | 'expired'> {
    const allowed = new Set<InvoiceStatus>([
      'unpaid',
      'paid',
      'partially_refunded',
      'refunded',
      'canceled',
      'expired',
    ]);
    if (!input) return [];
    const arr = Array.isArray(input)
      ? input
      : String(input)
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
    const out: InvoiceStatus[] = [];
    for (const s of arr) {
      if (allowed.has(s as InvoiceStatus)) out.push(s as InvoiceStatus);
    }
    return out as Array<
      'unpaid' | 'paid' | 'partially_refunded' | 'refunded' | 'canceled' | 'expired'
    >;
  }
}
