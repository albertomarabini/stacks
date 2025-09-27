// src/controllers/PublicApiController.ts
import type { Request, Response } from 'express';
import type { ISqliteStore } from '../contracts/dao';
import type {
  IStacksChainClient,
  IContractCallBuilder,
  IAssetInfoFactory,
  IConfigService,
  IInvoiceIdCodec,
} from '../contracts/interfaces';
import type { PublicInvoiceDTO } from '../contracts/domain';
import { InvoiceIdGuard } from '../delegates/InvoiceIdGuard';
import { InvoiceStatusResolver } from '../delegates/InvoiceStatusResolver';
import { StorePublicProfileProjector } from '../delegates/StorePublicProfileProjector';
import { PayInvoiceTxAssembler, HttpError } from '../delegates/PayInvoiceTxAssembler';

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

// ✳️ include "cancelled" defensively, though canonical is "canceled" in DB/specs
const NonPayableStatuses = new Set([
  'paid',
  'canceled',
  'cancelled',
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

  // Best-effort CORS header setter in case route middleware didn't run.
  // If the store (or row.store) has an allow-list, reflect the Origin when allowed,
  // otherwise fall back to "*". Also sets Vary: Origin when reflecting.
  private setCorsIfMissing(req: Request, res: Response, allowListCsv?: string): void {
    // already set by middleware? leave it alone
    if (res.getHeader('Access-Control-Allow-Origin')) return;

    const origin = String(req.headers.origin || '');
    const list = (allowListCsv || '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    // reflect when explicitly allowed; otherwise use "*"
    const allow = (origin && list.length && list.includes(origin)) ? origin : '*';

    res.setHeader('Access-Control-Allow-Origin', allow);
    if (allow !== '*') {
      // ensure caches don’t coalesce different origins
      const prevVary = String(res.getHeader('Vary') || '').trim();
      res.setHeader('Vary', prevVary ? `${prevVary}, Origin` : 'Origin');
    }
  }

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
    // ✅ pass chain + idGuard only; resolver will duck-type the chain
    this.statusResolver = new InvoiceStatusResolver(this.chain, this.idGuard);
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

    // ensure CORS header for public GET (browser won't preflight)
    const allowed = (row.store as any)?.allowed_origins || (row.store as any)?.allowedOrigins;
    this.setCorsIfMissing(req, res, allowed);
    res.json(dto);
  }

  async createTx(req: Request, res: Response): Promise<void> {
    const body = (req.body as any) || {};
    const invoiceId = body.invoiceId ? String(body.invoiceId) : '';
    const payerPrincipal = body.payerPrincipal ? String(body.payerPrincipal) : undefined;

    if (!invoiceId) {
      this.setCorsIfMissing(req, res); // no store context yet
      res.status(400).json(PublicErrors.missingIdentifier);
      return;
    }

    const row = this.store.getInvoiceWithStore(invoiceId);
    const allowFromRow = row ? ((row.store as any)?.allowed_origins || (row.store as any)?.allowedOrigins) : undefined;

    if (!row) {
      this.setCorsIfMissing(req, res);
      res.status(404).json(PublicErrors.notFound);
      return;
    }

    // ✳️ Harden: compute effective status (DB + on-chain) before building.
    let effectiveStatus = String(row.status || '').toLowerCase();
    try {
      // Validate that the stored id_hex is sane; if invalid, we will surface invalidId below
      this.idGuard.validateHexIdOrThrow(row.id_hex);
      const onchain = await this.statusResolver.readOnchainStatus(row.id_hex);
      effectiveStatus = this.statusResolver.computeDisplayStatus(
        { id_hex: row.id_hex, status: effectiveStatus as any, quote_expires_at: row.quote_expires_at },
        onchain as any,
        Date.now(),
      ).toLowerCase();
    } catch (e) {
      // If id invalid, map to 400; otherwise continue with DB status.
      if (e instanceof Error && /invalid/i.test(e.message)) {
        this.setCorsIfMissing(req, res, allowFromRow);
        res.status(HttpStatusMap.invalidPayload).json(PublicErrors.invalidId);
        return;
      }
    }

    if (NonPayableStatuses.has(effectiveStatus)) {
      this.setCorsIfMissing(req, res, allowFromRow);
      // small debug hint for ops (status reason)
      res.setHeader('X-Blocked-Reason', `status=${effectiveStatus}`);
      res.status(409).json(PublicErrors.invalidState);
      return;
    }

    try {
      const payload = await this.txAssembler.buildUnsignedPayInvoice(row as any, payerPrincipal);
      this.setCorsIfMissing(req, res, allowFromRow);
      res.json(payload);
    } catch (e: any) {
      if (e instanceof HttpError) {
        this.setCorsIfMissing(req, res, allowFromRow);
        if (e.code === 'merchant-inactive') {
          res.status(e.status).json(PublicErrors.invalidState); return;
        } else if (e.code === 'expired') {
          res.status(e.status).json(PublicErrors.expired); return;
        } else if (e.code === 'missing-token') {
          res.status(e.status).json(PublicErrors.missingSbtcToken); return;
        } else if (e.code === 'invalid-id') {
          res.status(e.status).json(PublicErrors.invalidId); return;
        } else {
          res.status(HttpStatusMap.conflict).json(PublicErrors.invalidState); return;
        }
      }
      this.setCorsIfMissing(req, res, allowFromRow);
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

    // ensure CORS header on simple GET
    this.setCorsIfMissing(req, res, (m as any).allowed_origins || (m as any).allowedOrigins);
    res.json(profile);
  }
}
