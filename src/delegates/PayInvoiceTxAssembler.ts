// src/delegates/PayInvoiceTxAssembler.ts
import type {
  IContractCallBuilder,
  IAssetInfoFactory,
  IConfigService,
  IStacksChainClient,
} from '../contracts/interfaces';
import { InvoiceIdGuard } from '../delegates/InvoiceIdGuard';
import { Validation } from '../validation/rules';

type InvoiceRowForTx = {
  id_hex: string;
  amount_sats: number;
  merchant_principal: string;
  status: string;
  quote_expires_at: number; // ms epoch
  store: { active: number | boolean };
};

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

export class PayInvoiceTxAssembler {
  private readonly builder: IContractCallBuilder;
  private readonly aif: IAssetInfoFactory;
  private readonly cfg: IConfigService;
  private readonly chain: IStacksChainClient;
  private readonly idGuard: InvoiceIdGuard;
  private readonly nonPayableStatuses: Set<string>;

  constructor(
    builder: IContractCallBuilder,
    aif: IAssetInfoFactory,
    cfg: IConfigService,
    chain: IStacksChainClient,
    idGuard: InvoiceIdGuard,
    nonPayableStatuses: Set<string>,
  ) {
    this.builder = builder;
    this.aif = aif;
    this.cfg = cfg;
    this.chain = chain;
    this.idGuard = idGuard;
    this.nonPayableStatuses = nonPayableStatuses;
    void Validation; // imported per spec; no runtime use here
  }

  async buildUnsignedPayInvoice(
    row: InvoiceRowForTx,
    payerPrincipal?: string,
  ): Promise<any> {
    const isActive = (typeof row.store.active === 'boolean') ? row.store.active : row.store.active === 1;
    if (!isActive) throw new HttpError(422, 'merchant-inactive');

    this.idGuard.validateHexIdOrThrow(row.id_hex);

    const tokenId = this.cfg.getSbtcContractId();
    if (!tokenId) throw new HttpError(422, 'missing-token');
    this.aif.getSbtcAssetInfo(); // surface misconfig

    // TTL + mirror status checks only (no on-chain call here)
    const ttlExpired = Date.now() > row.quote_expires_at;
    if (ttlExpired) throw new HttpError(409, 'expired');
    if (this.nonPayableStatuses.has(row.status)) {
      throw new HttpError(409, 'invalid-state');
    }

    const effectivePayer = (typeof payerPrincipal === 'string' && payerPrincipal.length > 0)
      ? payerPrincipal
      : row.merchant_principal;

    return this.builder.buildPayInvoice({
      idHex: row.id_hex,
      amountSats: row.amount_sats,
      payerPrincipal: effectivePayer,
      merchantPrincipal: row.merchant_principal,
    });
  }
}
