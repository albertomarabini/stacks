// src/delegates/InvoiceStatusResolver.ts
import type { IStacksChainClient } from '../contracts/interfaces';
import type { InvoiceIdGuard } from '../delegates/InvoiceIdGuard';

type OnchainInvoiceStatus = 'not-found' | 'paid' | 'canceled' | 'expired' | 'unpaid';
type PublicStatus        = 'paid' | 'canceled' | 'expired' | 'unpaid' | 'pending';

type InvoiceRowMinimal = {
  id_hex: string;
  status: PublicStatus;
  quote_expires_at: number; // ms epoch
};

type InvoiceIdGuardLike = Pick<InvoiceIdGuard, 'validateHexIdOrThrow'>;

type ChainInvoice = {
  status?: string;
  paidAtHeight?: number;
  lastChangeHeight?: number;
  lastTxId?: string;
};

function isChainInvoice(x: unknown): x is ChainInvoice {
  return typeof x === 'object' && x !== null;
}

export class InvoiceStatusResolver {
  constructor(
    private readonly chain: IStacksChainClient, // duck-type at runtime
    private readonly idGuard: InvoiceIdGuardLike,
  ) {}

  private withTimeout<T>(p: Promise<T>, ms = 6000): Promise<T> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('read_timeout')), ms);
      p.then(v => { clearTimeout(t); resolve(v); },
             e => { clearTimeout(t); reject(e); });
    });
  }

  private async readFromChain(idHex: string): Promise<OnchainInvoiceStatus> {
    const anyChain = this.chain as unknown as {
      readInvoiceStatus?: (id: string) => Promise<string>;
      readInvoice?: (id: string) => Promise<unknown>;
    };

    try {
      if (typeof anyChain.readInvoiceStatus === 'function') {
        const s = (await this.withTimeout(anyChain.readInvoiceStatus(idHex), 6000)).toLowerCase();
        if (s === 'paid' || s === 'canceled' || s === 'expired' || s === 'unpaid') return s as OnchainInvoiceStatus;
        return 'not-found';
      }
      if (typeof anyChain.readInvoice === 'function') {
        const inv = await this.withTimeout(anyChain.readInvoice(idHex), 6000);
        if (isChainInvoice(inv)) {
          const s = String(inv.status ?? 'not-found').toLowerCase();
          if (s === 'paid' || s === 'canceled' || s === 'expired' || s === 'unpaid') return s as OnchainInvoiceStatus;
        }
        return 'not-found';
      }
      return 'not-found';
    } catch {
      return 'not-found';
    }
  }

  async readOnchainStatus(idHex: string): Promise<OnchainInvoiceStatus> {
    this.idGuard.validateHexIdOrThrow(idHex);
    return this.readFromChain(idHex);
  }

  computeDisplayStatus(
    row: InvoiceRowMinimal,
    onchain: OnchainInvoiceStatus,
    nowMs: number,
  ): PublicStatus {
    if (onchain === 'paid') return 'paid';
    if (onchain === 'canceled') return 'canceled';
    if (nowMs > row.quote_expires_at || onchain === 'expired') return 'expired';
    // If chain doesn’t know it yet, honor the DB (tests expect “unpaid” not “pending”)
    return row.status === 'pending' ? 'unpaid' : row.status;
  }
}
