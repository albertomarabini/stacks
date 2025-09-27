// src/services/InvoiceService.ts
import crypto from 'crypto';
import type { ISqliteStore } from '../contracts/dao';
import type {
  IStacksChainClient,
  IContractCallBuilder,
  IConfigService,
  IInvoiceIdCodec,
} from '../contracts/interfaces';
import { PricingService } from './PricingService';
import type { PublicInvoiceDTO, UnsignedContractCall } from '../contracts/domain';

type StoreLike = { id: string; principal: string };

export class InvoiceService {
  private store!: ISqliteStore;
  private chain!: IStacksChainClient;
  private builder!: IContractCallBuilder;
  private cfg!: IConfigService;
  private pricing!: PricingService;
  private codec!: IInvoiceIdCodec;

  bindDependencies(deps: {
    store: ISqliteStore;
    chain: IStacksChainClient;
    builder: IContractCallBuilder;
    cfg: IConfigService;
    pricing: PricingService;
    codec: IInvoiceIdCodec;
  }): void {
    this.store = deps.store;
    this.chain = deps.chain;
    this.builder = deps.builder;
    this.cfg = deps.cfg;
    this.pricing = deps.pricing;
    this.codec = deps.codec;
  }

  async createInvoice(
    store: StoreLike,
    input: {
      amountSats: number;
      ttlSeconds: number;
      memo?: string;
      webhookUrl?: string;
    },
  ): Promise<PublicInvoiceDTO & { magicLink: string; unsignedTx?: UnsignedContractCall }> {
    this.assertPositiveInt(input.amountSats, 'amountSats');
    this.assertPositiveInt(input.ttlSeconds, 'ttlSeconds');

    const idHex = this.codec.generateRandomBuff32Hex();
    this.codec.assertHex64(idHex);

    let usdAtCreate: number;
    try {
      usdAtCreate = await this.pricing.getUsdPriceSnapshot();
    } catch (e: any) {
      if (e?.code === 'price_unavailable') {
        // Accept invoice creation without a live USD quote (display-only in UI)
        const fallback = Number(process.env.PRICE_SNAPSHOT_DEFAULT ?? 0);
        usdAtCreate = Number.isFinite(fallback) && fallback > 0 ? fallback : 0;
      } else {
        throw e;
      }
    }
    const tipHeight = await this.chain.getTipHeight();
    const avgBlockSecs = this.cfg.getAvgBlockSecs();
    const minCushionBlocks = 10;
    const ttlBlocks = Math.ceil(input.ttlSeconds / avgBlockSecs);
    const expiresAtBlock = tipHeight + Math.max(minCushionBlocks, ttlBlocks + 1);

    const unsignedTx = this.builder.buildCreateInvoice({
      idHex,
      amountSats: input.amountSats,
      memo: input.memo,
      expiresAtBlock,
    });

    if (this.cfg.isAutoBroadcastEnabled()) {
      await this.broadcastCreateInvoice(unsignedTx);
    }

    const nowMs = Date.now();
    const nowSecs = Math.floor(nowMs / 1000);
    const quoteExpiresAt = nowMs + input.ttlSeconds * 1000;
    const idRaw = crypto.randomUUID();

    this.store.invoices.insert({
      id_raw: idRaw,
      id_hex: idHex,
      store_id: store.id,
      amount_sats: input.amountSats,
      usd_at_create: usdAtCreate,
      quote_expires_at: quoteExpiresAt,
      merchant_principal: store.principal,
      status: 'unpaid',
      payer: undefined,
      txid: undefined,
      memo: input.memo,
      webhook_url: input.webhookUrl,
      created_at: nowSecs,
      refunded_at: undefined,
      refund_amount: 0,
      refund_txid: undefined,
      subscription_id: undefined,
      refund_count: 0,
      expired: 0,
    } as any);

    const dto: PublicInvoiceDTO = {
      invoiceId: idRaw,
      idHex,
      storeId: store.id,
      amountSats: input.amountSats,
      usdAtCreate,
      quoteExpiresAt,
      merchantPrincipal: store.principal,
      status: 'unpaid',
      payer: undefined,
      txId: undefined,
      memo: input.memo,
      subscriptionId: undefined,
      createdAt: nowSecs,
      refundAmount: 0,
      refundTxId: undefined,
      store: undefined,
    };

    const magicLink = `/i/${idRaw}`;
    return { ...dto, magicLink, unsignedTx };
  }

  async broadcastCreateInvoice(_unsignedCall: UnsignedContractCall): Promise<string> {
    throw new Error('auto_broadcast_not_supported');
  }

  private assertPositiveInt(n: number, name: string): void {
    if (!Number.isInteger(n) || n <= 0) {
      throw new TypeError(`${name} must be a positive integer`);
    }
  }
}
