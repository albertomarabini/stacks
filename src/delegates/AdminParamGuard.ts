// src/delegates/AdminParamGuard.ts
import type { InvoiceStatus } from '../contracts/domain';

export class AdminParamGuard {
  assertUuid(id: string): void {
    const re =
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
    if (!re.test(id)) {
      throw new TypeError('Invalid UUID');
    }
  }

  assertStacksPrincipal(p: string) {
    // allow mainnet (SP…) and testnet (ST…) standard principals
    if (!/^S[PT][0-9A-Z]{38,60}$/i.test(p)) throw new TypeError('Invalid Stacks principal/address');
      return true;
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
