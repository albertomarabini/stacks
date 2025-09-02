// src/controllers/AdminApiController.ts
import type { Request, Response } from 'express';
import type { ISqliteStore } from '../contracts/dao';
import { randomBytes } from "node:crypto";
import type {
  IStacksChainClient,
  IContractCallBuilder,
  IWebhookDispatcher,
} from '../contracts/interfaces';
import { PollerAdminBridge } from '../poller/PollerAdminBridge';
import { AdminParamGuard } from '../delegates/AdminParamGuard';
import { AdminDtoProjector } from '../delegates/AdminDtoProjector';
import { MerchantKeyRotationService } from '../delegates/MerchantKeyRotationService';
import { MerchantOnchainSyncPlanner } from '../delegates/MerchantOnchainSyncPlanner';
import { WebhookAdminRetryService } from '../delegates/WebhookAdminRetryService';
import { MerchantCreationService } from '../delegates/MerchantCreationService';
import type { InvoiceStatus } from '../contracts/domain';

type Deps = {
  store: ISqliteStore;
  chain: IStacksChainClient;
  builder: IContractCallBuilder;
  dispatcher: IWebhookDispatcher;
  pollerBridge: PollerAdminBridge;
};

export class AdminApiController {
  private store!: ISqliteStore;
  private chain!: IStacksChainClient;
  private builder!: IContractCallBuilder;
  private dispatcher!: IWebhookDispatcher;
  private pollerBridge!: PollerAdminBridge;

  private readonly paramGuard = new AdminParamGuard();
  private readonly projector = new AdminDtoProjector();
  private readonly keyRotation = new MerchantKeyRotationService();
  private readonly syncPlanner = new MerchantOnchainSyncPlanner();
  private readonly webhookRetry = new WebhookAdminRetryService();
  private readonly merchantCreation = new MerchantCreationService();

  bindDependencies(deps: Deps): void {
    this.store = deps.store;
    this.chain = deps.chain;
    this.builder = deps.builder;
    this.dispatcher = deps.dispatcher;
    this.pollerBridge = deps.pollerBridge;
  }

  async createStore(req: Request, res: Response): Promise<void> {
    try {
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const principal = String(body.principal ?? '').trim();
      if (!principal) {
        res.status(400).json({ error: 'principal-required' });
        return;
      }
      try {
        this.paramGuard.assertStacksPrincipal(principal);  // format check (SP… or ST…)
      } catch {
        res.status(400).json({ error: 'principal-invalid' });
        return;
      }
      const result = await this.merchantCreation.create(this.store, { ...body, principal });
      if (result.status === 'conflict') {
        res.status(409).end();
        return;
      }
      res.status(201).json(result.dto);
    } catch (err: any) {
      const msg = String(err?.message || "");
      // Handle re-runs: UNIQUE(principal) constraint → return HTTP 409 (idempotent create)
      if (err?.code === "SQLITE_CONSTRAINT_UNIQUE" && msg.includes("merchants.principal")) {
        res.status(409).json({ error: "principal-already-exists" });
        return;
      }
      // Not a duplicate-principal error → let your global error middleware handle it
      throw err;
    }
  }

  async listStores(_req: Request, res: Response): Promise<void> {
    const rows = this.store.listMerchantsProjection();
    res.json(rows.map((r) => this.projector.merchantToDto(r)));
  }


// POST /api/admin/stores/:storeId/rotate-keys
async rotateKeys(req: Request, res: Response): Promise<void> {
  const storeId = String(req.params.storeId ?? '');
  const m = this.store.getMerchantById(storeId);
  if (!m) { res.status(404).json({ error: 'store-not-found' }); return; }

  const now = Math.floor(Date.now() / 1000);

  // Guard: do NOT rotate again immediately → prevents re-exposure on a 2nd call
  // (tune the 60s if you need a different idempotency window)
  const lastRotated = m.keys_last_rotated_at ?? 0;
  if (now - lastRotated < 60) {
    res.status(409).json({ error: 'already-rotated' });
    return;
  }

  // Generate fresh secrets
  const apiKey = randomBytes(32).toString('hex');
  const hmacSecret = randomBytes(32).toString('hex');

  // Persist: bump version + timestamp
  const version = this.store.rotateKeysPersist(storeId, apiKey, hmacSecret, now);

  // One-time reveal for this version
  const marked = this.store.markKeysRevealedOnce(storeId, version, now);
  if (!marked) {
    res.status(409).json({ error: 'already-revealed' });
    return;
  }

  res.status(200).json({ apiKey, hmacSecret });
}



  async syncOnchain(req: Request, res: Response): Promise<void> {
    const storeId = String(req.params.storeId);
    this.paramGuard.assertUuid(storeId);
    const result = await this.syncPlanner.planForStore(this.store, this.chain, this.builder, storeId);
    if ('notFound' in result) {
      res.status(404).end();
      return;
    }
    res.json({ calls: result.calls });
  }

  async setSbtcToken(req: Request, res: Response): Promise<void> {
    const body = (req.body || {}) as { contractAddress?: string; contractName?: string };
    const contractAddress = String(body.contractAddress ?? '');
    const contractName = String(body.contractName ?? '');
    this.paramGuard.assertStacksPrincipal(contractAddress);
    if (!contractName) {
      res.status(400).end();
      return;
    }
    const call = this.builder.buildSetSbtcToken({ contractAddress, contractName });
    res.json({ call });
  }

  async cancelInvoice(req: Request, res: Response): Promise<void> {
    const invoiceId = String(req.params.invoiceId);
    this.paramGuard.assertUuid(invoiceId);
    const row = this.store.getInvoiceById(invoiceId);
    if (!row) {
      res.status(404).end();
      return;
    }
    if (row.status === 'paid') {
      res.status(400).json({ error: 'already_paid' });
      return;
    }
    this.store.updateInvoiceStatus(invoiceId, 'canceled');
    res.json({ canceled: true, invoiceId });
  }

  async activateStore(req: Request, res: Response): Promise<void> {
    const storeId = String(req.params.storeId);
    this.paramGuard.assertUuid(storeId);
    const active = !!(req.body && (req.body as any).active);
    this.store.updateMerchantActive(storeId, active);
    const rows = this.store.listMerchantsProjection();
    const m = rows.find((r) => r.id === storeId);
    res.json(m ? this.projector.merchantToDto(m) : undefined);
  }

  async listAdminInvoices(req: Request, res: Response): Promise<void> {
    const statuses = this.paramGuard.parseInvoiceStatuses(req.query.status as any);
    const storeId = req.query.storeId ? String(req.query.storeId) : undefined;
    if (storeId) this.paramGuard.assertUuid(storeId);
    const rows = this.store.selectAdminInvoices(
      statuses.length ? (statuses as any) : undefined,
      storeId,
    );
    res.json(rows.map((r) => this.projector.invoiceToDto(r)));
  }

  async retryWebhook(req: Request, res: Response): Promise<void> {
    const body = (req.body || {}) as { webhookLogId?: string };
    const webhookLogId = String(body.webhookLogId ?? '');
    this.paramGuard.assertUuid(webhookLogId);
    const outcome = await this.webhookRetry.retry(this.store, this.dispatcher, webhookLogId);
    if (outcome.type === 'not-found') {
      res.status(404).end();
      return;
    }
    if (outcome.type === 'already-delivered') {
      res.status(200).json({ alreadyDelivered: true });
      return;
    }
    res.status(202).json({ enqueued: outcome.enqueued });
  }

  async getPoller(_req: Request, res: Response): Promise<void> {
    const s = this.pollerBridge.getState();
    res.json({
      running: !!s.running,
      lastRunAt: s.lastRunAt ?? null,
      lastHeight: s.lastHeight ?? 0,
      lastTxId: s.lastTxId ?? null,
      lagBlocks: s.lagBlocks ?? null,
    });
  }

  async restartPoller(_req: Request, res: Response): Promise<void> {
    const out = this.pollerBridge.restart();
    res.json(out);
  }

  async listWebhooks(req: Request, res: Response): Promise<void> {
    const q = (req.query || {}) as { storeId?: string; status?: string };
    const storeId = q.storeId ? String(q.storeId) : undefined;
    if (storeId) this.paramGuard.assertUuid(storeId);
    const failedOnly = String(q.status ?? 'all') === 'failed';
    const rows = this.store.listAdminWebhooks(storeId, failedOnly);
    res.json(rows.map((w) => this.projector.webhookToDto(w)));
  }

  async listInvoices(req: Request, res: Response): Promise<void> {
    const storeId = String((req.query || {}).storeId ?? '');
    if (!storeId) { res.json([]); return; }
    this.paramGuard.assertUuid(storeId);

    const rawStatus = String((req.query || {}).status ?? '').trim();
    const status = (rawStatus ? (rawStatus as InvoiceStatus) : undefined);

    const rows = this.store.listInvoicesByStore(storeId, {
      status,
      orderByCreatedDesc: true,
    });

    res.json(rows.map(r => this.projector.invoiceToDto(r)));
  }

}
