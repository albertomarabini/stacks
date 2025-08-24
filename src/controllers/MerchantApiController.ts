// src/controllers/MerchantApiController.ts
import type { Request, Response } from 'express';
import crypto from 'crypto';
import type { ISqliteStore } from '/src/contracts/dao';
import type {
  IStacksChainClient,
  IContractCallBuilder,
  IConfigService,
  IInvoiceIdCodec,
} from '/src/contracts/interfaces';
import { PricingService } from '/src/services/PricingService';
import { InvoiceService } from '/src/services/InvoiceService';
import { SubscriptionService } from '/src/services/SubscriptionService';
import RefundService from '/src/services/RefundService';
import { ApiCaseAndDtoMapper } from '/src/delegates/ApiCaseAndDtoMapper';
import { MerchantInputValidator } from '/src/delegates/MerchantInputValidator';
import { RefundPolicyGuard } from '/src/delegates/RefundPolicyGuard';
import { DirectSubscriptionPaymentTxBuilder } from '/src/delegates/DirectSubscriptionPaymentTxBuilder';
import { Validation } from '/src/validation/rules';
import type {
  MerchantRow,
  InvoiceRow,
  SubscriptionRow,
  InvoiceStatus,
  PublicInvoiceDTO,
} from '/src/contracts/domain';

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

  async cancelInvoice(req: Request, res: Response): Promise<void> {
    const sreq = req as AuthedRequest;
    const idRaw = String(req.params.invoiceId);
    const invRow = this.store.invoices.findByStoreAndIdRaw(sreq.store.id, idRaw);
    if (!invRow) {
      res.status(404).end();
      return;
    }
    if (
      invRow.status !== 'unpaid' ||
      Number(invRow.expired ?? 0) === 1 ||
      invRow.status === 'canceled'
    ) {
      res.status(409).json({ error: 'not_cancellable' });
      return;
    }
    this.codec.assertHex64(invRow.id_hex);
    const unsignedCall = this.builder.buildCancelInvoice({ idHex: invRow.id_hex });
    res.json({ unsignedCall });
  }

  async getStoreProfile(req: Request, res: Response): Promise<void> {
    const sreq = req as AuthedRequest;
    const dto = this.dtoMapper.storeToPrivateProfile(sreq.store);
    res.json(dto);
  }

  async updateStoreProfile(req: Request, res: Response): Promise<void> {
    const sreq = req as AuthedRequest;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const whitelist = [
      'name',
      'display_name',
      'logo_url',
      'brand_color',
      'webhook_url',
      'support_email',
      'support_url',
      'allowed_origins',
    ] as const;

    const patch: Record<string, unknown> = {};
    for (const key of whitelist) {
      if (Object.prototype.hasOwnProperty.call(body, key)) {
        patch[key] = (body as any)[key];
      }
    }
    if (patch['brand_color'] !== undefined) {
      const color = String(patch['brand_color']);
      if (!Validation.colorHex.test(color)) {
        res.status(400).json({ error: 'validation_error' });
        return;
      }
    }

    (this.store as any).updateMerchantProfile(sreq.store.id, patch);

    const proj = this.store.listMerchantsProjection().find((m) => m.id === sreq.store.id);
    const merged: any = proj ?? sreq.store;
    const dto = this.dtoMapper.storeToPrivateProfile(merged as MerchantRow);
    res.json(dto);
  }

  async createInvoice(req: Request, res: Response): Promise<void> {
    try {
      const sreq = req as AuthedRequest;
      const normalized = this.validateCreateInvoiceBody(req.body);
      const out = await this.inv.createInvoice(
        { id: sreq.store.id, principal: sreq.store.principal },
        normalized,
      );
      res.json(out);
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
    return this.inputValidator.validateCreateInvoiceBody(body);
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
        res.json(payload);
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

  validateRefundBody(body: any): { invoiceId: string; amountSats: number; memo?: string } {
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
      res.json(payload);
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
      const amountSats = Number(body.amount_sats);
      const intervalBlocks = Number(body.interval_blocks);
      const mode = body.mode ? (String(body.mode) as 'invoice' | 'direct') : undefined;

      this.inputValidator.assertStacksPrincipal(subscriber);
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
        unsignedCall,
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
    const ttlSeconds = Number(body.ttl_seconds ?? 900);
    const memo = body.memo !== undefined && body.memo !== null ? String(body.memo) : undefined;
    const webhookUrl =
      body.webhook_url !== undefined && body.webhook_url !== null
        ? String(body.webhook_url)
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

    const { invoice, unsignedCall } = await this.subs.generateInvoiceForSubscription(sub as SubscriptionRow, {
      storeId: sreq.store.id,
      merchantPrincipal: sreq.store.principal,
      ttlSeconds,
      memo,
      webhookUrl,
    });

    const magicLink = `/i/${invoice.invoiceId}`;
    res.json({ invoice, magicLink, unsignedCall });
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
    res.json({ id: out.row.id, mode: out.row.mode, unsignedCall: out.unsignedCall });
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
    res.json({ unsignedCall: out.unsignedCall });
  }

  async listWebhooks(req: Request, res: Response): Promise<void> {
    const sreq = req as AuthedRequest;
    const rows = this.store.listWebhooksForStore(sreq.store.id);
    res.json(rows.map((w) => this.dtoMapper.webhookToDto(w)));
  }
}
