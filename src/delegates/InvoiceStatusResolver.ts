// src/delegates/InvoiceStatusResolver.ts
import type { IStacksChainClient } from '../contracts/interfaces';
import type { InvoiceIdGuard } from '../delegates/InvoiceIdGuard';

type OnchainInvoiceStatus = 'not-found' | 'paid' | 'canceled' | 'expired' | 'unpaid';
type PublicStatus = 'paid' | 'canceled' | 'expired' | 'unpaid' | 'pending';

type InvoiceRowMinimal = {
  id_hex: string;
  status: PublicStatus;
  quote_expires_at: number; // ms epoch
};

type InvoiceIdGuardLike = Pick<InvoiceIdGuard, 'validateHexIdOrThrow'>;

export class InvoiceStatusResolver {
  constructor(
    private readonly chain: IStacksChainClient,
    private readonly idGuard: InvoiceIdGuardLike
  ) { }

  private withTimeout<T>(p: Promise<T>, ms = 6000): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('read_timeout')), ms);
      p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
    });
  }

  async readOnchainStatus(idHex: string): Promise<OnchainInvoiceStatus> {
    this.idGuard.validateHexIdOrThrow(idHex);
    try {
      const status = await this.withTimeout(this.chain.readInvoiceStatus(idHex), 6000);
      return status as any;
    } catch {
      // Safe fallback: treat as not-visible on-chain yet
      return 'not-found';
    }
  }

  computeDisplayStatus(
    row: InvoiceRowMinimal,
    onchain: OnchainInvoiceStatus,
    nowMs: number
  ): PublicStatus {
    if (onchain === 'paid') return 'paid';
    if (onchain === 'canceled') return 'canceled';
    if (nowMs > row.quote_expires_at || onchain === 'expired') return 'expired';
    // Treat 'not-found' as whatever DB says (usually 'unpaid')
    return row.status === 'pending' ? 'unpaid' : row.status;
  }
}
