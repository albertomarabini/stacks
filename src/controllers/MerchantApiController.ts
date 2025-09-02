// src/controllers/MerchantApiController.ts
import type { Request, Response } from 'express';
import crypto from 'crypto';
import type { ISqliteStore } from '../contracts/dao';
import type {
  IStacksChainClient,
  IContractCallBuilder,
  IConfigService,
  IInvoiceIdCodec,
} from '../contracts/interfaces';
import { PricingService } from '../services/PricingService';
import { InvoiceService } from '../services/InvoiceService';
import { SubscriptionService } from '../services/SubscriptionService';
import RefundService from '../services/RefundService';
import { ApiCaseAndDtoMapper } from '../delegates/ApiCaseAndDtoMapper';
import { MerchantInputValidator } from '../delegates/MerchantInputValidator';
import { RefundPolicyGuard } from '../delegates/RefundPolicyGuard';
import { DirectSubscriptionPaymentTxBuilder } from '../delegates/DirectSubscriptionPaymentTxBuilder';
import { Validation } from '../validation/rules';
import type {
  MerchantRow,
  InvoiceRow,
  SubscriptionRow,
  InvoiceStatus,
} from '../contracts/domain';

type AuthedRequest = Request & { store: MerchantRow };

export class MerchantApiController {
  private store!: ISqliteStore;
  private chain!: IStacksChainClient;
  private builder!: IContractCallBuilder;
  private pricing!: PricingService;
  private cfg!: IConfigService;
  private codec!: IInvoiceIdCodec;
  private subs!: SubscriptionService;
  private inv!: InvoiceService;
  private refund!: RefundService;

  private dtoMapper!: ApiCaseAndDtoMapper;
  private inputValidator!: MerchantInputValidator;
  private refundPolicy!: RefundPolicyGuard;
  private directSubPayBuilder!: DirectSubscriptionPaymentTxBuilder;

  private jsonSafe<T>(obj: T): T {
    return JSON.parse(
      JSON.stringify(obj, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    );
  }

  bindDependencies(deps: {
    store: ISqliteStore;
    chain: IStacksChainClient;
    builder: IContractCallBuilder;
    pricing: PricingService;
    cfg: IConfigService;
    codec: IInvoiceIdCodec;
    subs: SubscriptionService;
    inv: InvoiceService;
    refund: RefundService;
  }): void {
    this.store = deps.store;
    this.chain = deps.chain;
    this.builder = deps.builder;
    this.pricing = deps.pricing;
    this.cfg = deps.cfg;
    this.codec = deps.codec;
    this.subs = deps.subs;
    this.inv = deps.inv;
    this.refund = deps.refund;

    this.dtoMapper = new ApiCaseAndDtoMapper();
    this.inputValidator = new MerchantInputValidator();
    this.refundPolicy = new RefundPolicyGuard(this.codec, this.refund);
    this.directSubPayBuilder = new DirectSubscriptionPaymentTxBuilder(
      this.chain,
      this.builder,
      this.codec,
    );
  }

  async getInvoice(req: Request, res: Response): Promise<void> {
    const sreq = req as AuthedRequest;
    const idRaw = String(req.params.invoiceId);
    const row = this.store.invoices.findByStoreAndIdRaw(sreq.store.id, idRaw);
    if (!row) {
      res.status(404).end();
      return;
    }
    const dto = this.dtoMapper.invoiceToPublicDto(row);
    res.json(dto);
  }

  async listInvoices(req: Request, res: Response): Promise<void> {
    // guard: missing auth should be a clean 401 (prevents "fetch failed")
    if (!(req as any).store) {
      res.status(401).json({ error: 'missing-api-key' });
      return;
    }
    const sreq = req as AuthedRequest;
    const statusQ = req.query.status ? String(req.query.status) : undefined;
    const allowed: InvoiceStatus[] = [
      'unpaid',
      'paid',
      'partially_refunded',
      'refunded',
      'canceled',
      'expired',
    ];
    if (statusQ && !allowed.includes(statusQ as InvoiceStatus)) {
      res.status(400).json({ error: 'bad_status' });
      return;
    }
    const rows = this.store.listInvoicesByStore(sreq.store.id, {
      status: statusQ as InvoiceStatus | undefined,
      orderByCreatedDesc: true,
    });
    res.json(rows.map((r) => this.dtoMapper.invoiceToPublicDto(r)));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CANCEL (builder): returns unsigned call (used first by the test)
  // Route: POST /api/v1/stores/:storeId/invoices/:invoiceId/cancel/create-tx
  // ─────────────────────────────────────────────────────────────────────────────
  async cancelInvoiceCreateTx(req: Request, res: Response): Promise<void> {
    const sreq = req as AuthedRequest;
    const idRaw = String(req.params.invoiceId);
    const invRow = this.store.invoices.findByStoreAndIdRaw(sreq.store.id, idRaw);
    if (!invRow) { res.status(404).end(); return; }

    // Only unpaid & not expired are cancellable via builder/action
    if (invRow.status !== 'unpaid' || Number(invRow.expired ?? 0) === 1) {
      res.status(409).json({ error: 'not_cancellable' }); return;
    }

    // Build unsigned cancel call
    this.codec.assertHex64(invRow.id_hex);
    const unsignedCall = this.builder.buildCancelInvoice({ idHex: invRow.id_hex });
    res.json({ unsignedCall, unsignedPayload: unsignedCall });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CANCEL (action): flips mirror row to canceled (fallback path in the test)
  // Route: POST /api/v1/stores/:storeId/invoices/:invoiceId/cancel
  // NOTE: store.markInvoiceCanceled(idHex) returns void -> re-read to verify
  // ─────────────────────────────────────────────────────────────────────────────
  async cancelInvoice(req: Request, res: Response): Promise<void> {
    const sreq = req as AuthedRequest;
    const idRaw = String(req.params.invoiceId);
    const invRow = this.store.invoices.findByStoreAndIdRaw(sreq.store.id, idRaw);
    if (!invRow) { res.status(404).end(); return; }

    // Only unpaid & not expired are cancellable
    if (invRow.status !== 'unpaid' || Number(invRow.expired ?? 0) === 1) {
      res.status(409).json({ error: 'not_cancellable' }); return;
    }

    // Perform DB-side cancel (void return -> cannot test truthiness)
    this.codec.assertHex64(invRow.id_hex);
    this.store.markInvoiceCanceled(invRow.id_hex);

    // Re-read row to confirm outcome; if not canceled, report conflict
    const after = this.store.invoices.findByStoreAndIdRaw(sreq.store.id, idRaw);
    if (!after || after.status !== 'canceled') {
      res.status(409).json({ error: 'not_cancellable' }); return;
    }

    res.json({ canceled: true, invoiceId: idRaw });
  }



  async getStoreProfile(req: Request, res: Response): Promise<void> {
    const sreq = req as AuthedRequest;
    const dto = this.dtoMapper.storeToPrivateProfile(sreq.store);
    res.json({
      ...dto,
      apiKey: sreq.store.api_key ?? null,
      hmacSecret: sreq.store.hmac_secret ?? null,
    });
  }

  async updateStoreProfile(req: Request, res: Response): Promise<void> {
    const sreq = req as AuthedRequest;
    const inb = (req.body ?? {}) as Record<string, unknown>;

    // accept both snake_case and camelCase
    const map: Record<string, string> = {
      name: 'name',
      display_name: 'display_name', displayName: 'display_name',
      logo_url: 'logo_url', logoUrl: 'logo_url',
      brand_color: 'brand_color', brandColor: 'brand_color',
      webhook_url: 'webhook_url', webhookUrl: 'webhook_url',
      support_email: 'support_email', supportEmail: 'support_email',
      support_url: 'support_url', supportUrl: 'support_url',
      allowed_origins: 'allowed_origins', allowedOrigins: 'allowed_origins',
    };

    const patch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(map)) {
      if (Object.prototype.hasOwnProperty.call(inb, k) && !(v in patch)) {
        patch[v] = (inb as any)[k];
      }
    }

    if (patch['brand_color'] !== undefined) {
      const color = String(patch['brand_color']);
      if (!Validation.colorHex.test(color)) {
        res.status(400).json({ error: 'validation_error' });
        return;
      }
    }

    this.store.updateMerchantProfile(sreq.store.id, patch);

    const updated = this.store.getMerchantById(sreq.store.id) as MerchantRow | undefined;
    const dto = this.dtoMapper.storeToPrivateProfile(updated as MerchantRow);
    // include secrets in PATCH response too (test expects them)
    res.json({
      ...dto,
      apiKey: updated?.api_key ?? null,
      hmacSecret: updated?.hmac_secret ?? null,
    });
  }

  async createInvoice(req: Request, res: Response): Promise<void> {
    try {
      const sreq = req as AuthedRequest;

      // inactive store should be blocked cleanly
      if (!(sreq.store?.active === 1 || sreq.store?.active === true)) {
        res.status(403).json({ error: 'inactive' });
        return;
      }

      const normalized = this.validateCreateInvoiceBody(req.body);

      // Service may return either a DB row or a ready PublicInvoiceDTO
      const out: any = await this.inv.createInvoice(
        { id: sreq.store.id, principal: sreq.store.principal },
        normalized,
      );

      // If service already returned a PublicInvoiceDTO, just return it (ensure magicLink)
      if (out && typeof out === 'object' && 'invoiceId' in out) {
        const resp = out.magicLink ? out : { ...out, magicLink: `/i/${out.invoiceId}` };
        res.json(this.jsonSafe(resp));
        return;
      }

      // Otherwise it's a DB row: map to DTO and synthesize magicLink
      const dto = this.dtoMapper.invoiceToPublicDto(out as InvoiceRow);
      const magicLink = `/i/${dto.invoiceId}`;
      res.json(this.jsonSafe({ ...dto, magicLink }));
    } catch (e: any) {
      if (e && (e.code === 'SQLITE_CONSTRAINT' || e.errno === 19)) {
        res.status(409).json({ error: 'conflict' });
        return;
      }
      if (e instanceof TypeError) {
        res.status(400).json({ error: 'validation_error' });
        return;
      }
      res.status(400).json({ error: 'validation_error' });
    }
  }


  validateCreateInvoiceBody(body: any): {
    amountSats: number;
    ttlSeconds: number;
    memo?: string;
    webhookUrl?: string;
  } {
    const amountSats = Number(body?.amount_sats ?? body?.amountSats);
    const ttlSeconds = Number(body?.ttl_seconds ?? body?.ttlSeconds ?? 900);
    const memo =
      body?.memo !== undefined && body?.memo !== null ? String(body.memo) : undefined;
    const webhookUrl =
      body?.webhook_url !== undefined && body?.webhook_url !== null
        ? String(body.webhook_url)
        : undefined;

    this.inputValidator.assertPositiveInt(amountSats, 'amount_sats');
    this.inputValidator.assertPositiveInt(ttlSeconds, 'ttl_seconds');

    if (memo) {
      const bytes = Buffer.from(memo, 'utf8');
      if (bytes.length > 34) throw new TypeError('memo-too-long');
    }
    if (webhookUrl && !Validation.url.test(webhookUrl)) {
      throw new TypeError('bad-webhook');
    }

    return { amountSats, ttlSeconds, memo, webhookUrl };
  }

  async buildRefund(req: Request, res: Response): Promise<void> {
    try {
      const sreq = req as AuthedRequest;
      const { invoiceId, amountSats, memo } = this.inputValidator.validateRefundBody(req.body);
      const invRow = this.store.invoices.findByStoreAndIdRaw(sreq.store.id, invoiceId);
      if (!invRow) {
        res.status(404).end();
        return;
      }
      try {
        const payload = await this.refundPolicy.enforceAndBuild(
          sreq.store,
          invRow as InvoiceRow,
          amountSats,
          memo,
        );
        res.json(this.jsonSafe(payload));
      } catch (err: any) {
        const code = err?.code as string;
        if (code === 'bad_status' || code === 'cap_violation') {
          res.status(409).json({ error: 'bad_status' });
          return;
        }
        if (code === 'insufficient_balance') {
          res.status(400).json({ error: 'insufficient_balance' });
          return;
        }
        res.status(400).json({ error: 'validation_error' });
      }
    } catch {
      res.status(400).json({ error: 'validation_error' });
    }
  }

// POST /api/v1/stores/:storeId/refunds/create-tx
async buildRefundTx(req: Request, res: Response): Promise<void> {
  try {
    const sreq = req as AuthedRequest;
    const { invoiceId, amountSats, memo } = this.validateRefundBody((req.body ?? {}) as any);

    const invRow = this.store.invoices.findByStoreAndIdRaw(sreq.store.id, invoiceId);
    if (!invRow) { res.status(404).json({ error: 'not_found' }); return; }

    // Only already-paid (or partially_refunded) invoices are refundable
    const status = String(invRow.status ?? '').toLowerCase();
    if (!(status === 'paid' || status === 'partially_refunded')) {
      res.status(409).json({ error: 'invalid_state' }); return;
    }

    // The RefundService already enforces refund cap and requires merchantPrincipal
    const unsigned = await this.refund.buildRefundPayload(
      sreq.store,
      invRow as any,
      amountSats,
      memo,
    );

    // Return the unsigned call — this is what the test expects to broadcast
    res.json(this.jsonSafe(unsigned));
  } catch {
    // Validation-style failures → 400 per Steroids
    res.status(400).json({ error: 'validation_error' });
  }
}


// Accept snake_case or camelCase via the validator; keep camelCase in the controller.
private validateRefundBody(body: Record<string, unknown>): {
  invoiceId: string;
  amountSats: number;
  memo?: string;
} {
  return this.inputValidator.validateRefundBody(body);
}

  async rotateKeys(req: Request, res: Response): Promise<void> {
    const sreq = req as AuthedRequest;
    const { apiKey, hmacSecret } = this.generateSecrets();
    this.store.updateMerchantKeysTx(sreq.store.id, apiKey, hmacSecret);
    res.json({ apiKey, hmacSecret });
  }

  generateSecrets(): { apiKey: string; hmacSecret: string } {
    return {
      apiKey: crypto.randomBytes(32).toString('hex'),
      hmacSecret: crypto.randomBytes(32).toString('hex'),
    };
  }

  async buildDirectSubscriptionPaymentTx(req: Request, res: Response): Promise<void> {
    const sreq = req as AuthedRequest;
    const id = String(req.params.id);
    const sub = this.store.getSubscriptionByIdForStore(id, sreq.store.id);
    if (!sub) {
      res.status(404).end();
      return;
    }
    const payerPrincipal = String((req.body ?? {}).payerPrincipal ?? '');
    try {
      const payload = await this.directSubPayBuilder.assemble(
        sub as SubscriptionRow,
        payerPrincipal,
        sreq.store.principal,
      );
      res.json(this.jsonSafe(payload));
    } catch (err: any) {
      const code = err?.code as string;
      if (code === 'bad_status' || code === 'invalid_payer' || code === 'too_early') {
        res.status(409).json({ error: 'bad_status' });
        return;
      }
      if (code === 'missing_token') {
        res.status(422).json({ error: 'missingSbtcToken' });
        return;
      }
      res.status(400).json({ error: 'validation_error' });
    }
  }

  async createSubscription(req: Request, res: Response): Promise<void> {
    try {
      const sreq = req as AuthedRequest;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const subscriber = String(body.subscriber ?? '');
      const amountSats = Number(body.amount_sats ?? body.amountSats);
      const intervalBlocks = Number(body.interval_blocks ?? body.intervalBlocks);
      const mode = body.mode ? (String(body.mode) as 'invoice' | 'direct') : undefined;

      if (!subscriber.trim()) {
        res.status(400).json({ error: 'validation_error' });
        return;
      }
      this.inputValidator.assertPositiveInt(amountSats, 'amount_sats');
      this.inputValidator.assertPositiveInt(intervalBlocks, 'interval_blocks');
      if (mode && !['invoice', 'direct'].includes(mode)) {
        res.status(400).json({ error: 'validation_error' });
        return;
      }

      const { row, unsignedCall } = await this.subs.createSubscription(
        { id: sreq.store.id, principal: sreq.store.principal },
        { subscriber, amountSats, intervalBlocks, mode },
      );

      res.json({
        id: row.id,
        idHex: row.id_hex,
        storeId: row.store_id,
        merchantPrincipal: row.merchant_principal,
        subscriber: row.subscriber,
        amountSats: row.amount_sats,
        intervalBlocks: row.interval_blocks,
        active: row.active === 1,
        createdAt: row.created_at,
        lastBilledAt: row.last_billed_at,
        nextInvoiceAt: row.next_invoice_at,
        lastPaidInvoiceId: row.last_paid_invoice_id,
        mode: row.mode,
        unsignedCall: this.jsonSafe(unsignedCall),
      });
    } catch {
      res.status(400).json({ error: 'validation_error' });
    }
  }

  async genSubscriptionInvoice(req: Request, res: Response): Promise<void> {
    const sreq = req as AuthedRequest;
    const id = String(req.params.id);
    const sub = this.store.getSubscriptionByIdForStore(id, sreq.store.id);
    if (!sub) {
      res.status(404).end();
      return;
    }
    if (!(sub.active === 1 && sub.mode === 'invoice')) {
      res.status(409).json({ error: 'bad_status' });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const ttlSeconds = Number(body.ttl_seconds ?? body.ttlSeconds ?? 900);
    const memo =
      body.memo !== undefined && body.memo !== null ? String(body.memo) : undefined;
    const webhookUrl =
      body.webhook_url !== undefined && body.webhook_url !== null
        ? String(body.webhook_url)
        : body.webhookUrl !== undefined && body.webhookUrl !== null
          ? String(body.webhookUrl)
          : undefined;

    if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      res.status(400).json({ error: 'validation_error' });
      return;
    }
    if (memo) {
      const bytes = Buffer.from(memo, 'utf8');
      if (bytes.length > 34) {
        res.status(400).json({ error: 'validation_error' });
        return;
      }
    }
    if (webhookUrl && !Validation.url.test(webhookUrl)) {
      res.status(400).json({ error: 'validation_error' });
      return;
    }

    const { invoice, unsignedCall } =
      await this.subs.generateInvoiceForSubscription(sub as SubscriptionRow, {
        storeId: sreq.store.id,
        merchantPrincipal: sreq.store.principal,
        ttlSeconds,
        memo,
        webhookUrl,
      });

    const magicLink = `/i/${invoice.invoiceId}`;
    res.json({ invoice, magicLink, unsignedCall: this.jsonSafe(unsignedCall) });
  }

  async setSubscriptionMode(req: Request, res: Response): Promise<void> {
    const sreq = req as AuthedRequest;
    const id = String(req.params.id);
    const sub = this.store.getSubscriptionByIdForStore(id, sreq.store.id);
    if (!sub) {
      res.status(404).end();
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const mode = String(body.mode ?? '');
    if (!(mode === 'invoice' || mode === 'direct')) {
      res.status(400).json({ error: 'validation_error' });
      return;
    }
    const out = await this.subs.setMode(sub as SubscriptionRow, mode as 'invoice' | 'direct');
    res.json({ id: out.row.id, mode: out.row.mode, unsignedCall: this.jsonSafe(out.unsignedCall) });
  }

  async cancelSubscription(req: Request, res: Response): Promise<void> {
    const sreq = req as AuthedRequest;
    const id = String(req.params.id);
    const sub = this.store.getActiveSubscription(id, sreq.store.id);
    if (!sub) {
      res.status(404).end();
      return;
    }
    const out = await this.subs.cancel(sub as SubscriptionRow);
    res.json({ unsignedCall: this.jsonSafe(out.unsignedCall) });
  }

  async listWebhooks(req: Request, res: Response): Promise<void> {
    // guard: missing auth should be clean 401
    if (!(req as any).store) {
      res.status(401).json({ error: 'missing-api-key' });
      return;
    }
    const sreq = req as AuthedRequest;
    const rows = this.store.listWebhooksForStore(sreq.store.id);
    res.json(rows.map((w) => this.dtoMapper.webhookToDto(w)));
  }
}
