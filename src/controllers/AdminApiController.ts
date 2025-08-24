// src/controllers/AdminApiController.ts
import type { Request, Response } from 'express';
import type { ISqliteStore } from '/src/contracts/dao';
import type {
  IStacksChainClient,
  IContractCallBuilder,
  IWebhookDispatcher,
} from '/src/contracts/interfaces';
import { PollerAdminBridge } from '/src/poller/PollerAdminBridge';
import { AdminParamGuard } from '/src/delegates/AdminParamGuard';
import { AdminDtoProjector } from '/src/delegates/AdminDtoProjector';
import { MerchantKeyRotationService } from '/src/delegates/MerchantKeyRotationService';
import { MerchantOnchainSyncPlanner } from '/src/delegates/MerchantOnchainSyncPlanner';
import { WebhookAdminRetryService } from '/src/delegates/WebhookAdminRetryService';
import { MerchantCreationService } from '/src/delegates/MerchantCreationService';

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
    const principal = String((req.body || {}).principal ?? '');
    this.paramGuard.assertStacksPrincipal(principal);
    const result = await this.merchantCreation.create(this.store, { ...req.body, principal });
    if (result.status === 'conflict') {
      res.status(409).end();
      return;
    }
    res.status(201).json(result.dto);
  }

  async listStores(_req: Request, res: Response): Promise<void> {
    const rows = this.store.listMerchantsProjection();
    res.json(rows.map((r) => this.projector.merchantToDto(r)));
  }

  async rotateKeys(req: Request, res: Response): Promise<void> {
    const storeId = String(req.params.storeId);
    this.paramGuard.assertUuid(storeId);
    const result = this.keyRotation.rotate(this.store, storeId);
    if (!result.ok) {
      res.status(404).end();
      return;
    }
    res.json({ apiKey: result.apiKey, hmacSecret: result.hmacSecret });
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
    const state = this.pollerBridge.getState();
    res.json(state);
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
}
