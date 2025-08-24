// src/delegates/InvoiceStatusResolver.ts
import type { IStacksChainClient } from '/src/contracts/interfaces';
import type { InvoiceIdGuard } from '/src/delegates/InvoiceIdGuard';

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
  ) {}

  async readOnchainStatus(idHex: string): Promise<OnchainInvoiceStatus> {
    this.idGuard.validateHexIdOrThrow(idHex);
    const status = await this.chain.readInvoiceStatus(idHex);
    return status as OnchainInvoiceStatus;
  }

  computeDisplayStatus(
    row: InvoiceRowMinimal,
    onchain: OnchainInvoiceStatus,
    nowMs: number
  ): PublicStatus {
    if (onchain === 'paid') return 'paid';
    if (onchain === 'canceled') return 'canceled';
    if (nowMs > row.quote_expires_at || onchain === 'expired') return 'expired';
    return row.status;
  }
}
