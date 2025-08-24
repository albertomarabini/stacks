// src/controllers/PublicApiController.ts
import type { Request, Response } from 'express';
import type { ISqliteStore } from '/src/contracts/dao';
import type {
  IStacksChainClient,
  IContractCallBuilder,
  IAssetInfoFactory,
  IConfigService,
  IInvoiceIdCodec,
} from '/src/contracts/interfaces';
import type { PublicInvoiceDTO } from '/src/contracts/domain';
import { InvoiceIdGuard } from '/src/delegates/InvoiceIdGuard';
import { InvoiceStatusResolver } from '/src/delegates/InvoiceStatusResolver';
import { StorePublicProfileProjector } from '/src/delegates/StorePublicProfileProjector';
import { PayInvoiceTxAssembler, HttpError } from '/src/delegates/PayInvoiceTxAssembler';

const HttpStatusMap = {
  invalidPayload: 400,
  notFound: 404,
  conflict: 409,
  unprocessable: 422,
  upgradeRequired: 426,
} as const;

const PublicErrors = {
  notFound: { error: 'notFound' },
  invalidId: { error: 'invalidId' },
  expired: { error: 'expired' },
  invalidState: { error: 'invalidState' },
  missingIdentifier: { error: 'missingIdentifier' },
  missingSbtcToken: { error: 'missingSbtcToken' },
} as const;

const NonPayableStatuses = new Set([
  'paid',
  'canceled',
  'expired',
  'refunded',
  'partially_refunded',
]);

export class PublicApiController {
  private store!: ISqliteStore;
  private chain!: IStacksChainClient;
  private builder!: IContractCallBuilder;
  private aif!: IAssetInfoFactory;
  private cfg!: IConfigService;
  private codec!: IInvoiceIdCodec;

  private idGuard!: InvoiceIdGuard;
  private statusResolver!: InvoiceStatusResolver;
  private profileProjector!: StorePublicProfileProjector;
  private txAssembler!: PayInvoiceTxAssembler;

  private cors: any;

  bindDependencies(deps: {
    store: ISqliteStore;
    chain: IStacksChainClient;
    builder: IContractCallBuilder;
    aif: IAssetInfoFactory;
    cfg: IConfigService;
    codec: IInvoiceIdCodec;
  }): void {
    this.store = deps.store;
    this.chain = deps.chain;
    this.builder = deps.builder;
    this.aif = deps.aif;
    this.cfg = deps.cfg;
    this.codec = deps.codec;

    this.idGuard = new InvoiceIdGuard(this.codec);
    this.statusResolver = new InvoiceStatusResolver(this.chain, this.idGuard as any);
    this.profileProjector = new StorePublicProfileProjector();
    this.txAssembler = new PayInvoiceTxAssembler(
      this.builder,
      this.aif,
      this.cfg,
      this.chain,
      this.idGuard,
      NonPayableStatuses,
    );
  }

  bindCorsPolicy(corsMwFactory: any): void {
    this.cors = corsMwFactory;
  }

  async getInvoice(req: Request, res: Response): Promise<void> {
    const idRaw = req.params.invoiceId;
    const row = this.store.getInvoiceWithStore(idRaw);
    if (!row) {
      res.status(HttpStatusMap.notFound).json(PublicErrors.notFound);
      return;
    }

    try {
      this.idGuard.validateHexIdOrThrow(row.id_hex);
    } catch {
      res.status(HttpStatusMap.invalidPayload).json(PublicErrors.invalidId);
      return;
    }

    const onchain = await this.statusResolver.readOnchainStatus(row.id_hex);
    const status = this.statusResolver.computeDisplayStatus(
      { id_hex: row.id_hex, status: row.status as any, quote_expires_at: row.quote_expires_at },
      onchain as any,
      Date.now(),
    );

    const storeProfile = this.profileProjector.project(row.store as any);
    const dto: PublicInvoiceDTO = {
      invoiceId: row.id_raw,
      idHex: row.id_hex,
      storeId: row.store_id,
      amountSats: row.amount_sats,
      usdAtCreate: row.usd_at_create,
      quoteExpiresAt: row.quote_expires_at,
      merchantPrincipal: row.merchant_principal,
      status: status as any,
      payer: row.payer ?? undefined,
      txId: row.txid ?? undefined,
      memo: row.memo ?? undefined,
      subscriptionId: row.subscription_id ?? undefined,
      createdAt: row.created_at,
      refundAmount: row.refund_amount ? row.refund_amount : undefined,
      refundTxId: row.refund_txid ?? undefined,
      store: storeProfile,
    };

    res.json(dto);
  }

  async createTx(req: Request, res: Response): Promise<void> {
    const body = (req.body as any) || {};
    const invoiceId = body.invoiceId ? String(body.invoiceId) : '';
    const payerPrincipal = body.payerPrincipal ? String(body.payerPrincipal) : undefined;

    if (!invoiceId) {
      res.status(HttpStatusMap.invalidPayload).json(PublicErrors.missingIdentifier);
      return;
    }

    const row = this.store.getInvoiceWithStore(invoiceId);
    if (!row) {
      res.status(HttpStatusMap.notFound).json(PublicErrors.notFound);
      return;
    }

    try {
      const payload = await this.txAssembler.buildUnsignedPayInvoice(row as any, payerPrincipal);
      res.json(payload);
    } catch (e: any) {
      if (e instanceof HttpError) {
        if (e.code === 'merchant-inactive') {
          res.status(e.status).json(PublicErrors.invalidState);
        } else if (e.code === 'expired') {
          res.status(e.status).json(PublicErrors.expired);
        } else if (e.code === 'missing-token') {
          res.status(e.status).json(PublicErrors.missingSbtcToken);
        } else if (e.code === 'invalid-id') {
          res.status(e.status).json(PublicErrors.invalidId);
        } else {
          res.status(HttpStatusMap.conflict).json(PublicErrors.invalidState);
        }
        return;
      }
      res.status(HttpStatusMap.conflict).json(PublicErrors.invalidState);
    }
  }

  async getStorePublicProfile(req: Request, res: Response): Promise<void> {
    const storeId = req.params.storeId;
    const rows = this.store.listMerchantsProjection() as any[];
    const m = rows.find((r) => r.id === storeId);
    if (!m) {
      res.status(HttpStatusMap.notFound).json(PublicErrors.notFound);
      return;
    }
    const profile = this.profileProjector.project(m);
    res.json(profile);
  }
}
