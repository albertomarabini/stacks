// src/services/ExpirationMonitor.ts
import type { ISqliteStore } from '../contracts/dao';
import type { IStacksChainClient, IWebhookDispatcher } from '../contracts/interfaces';
import type { InvoiceRow } from '../contracts/domain';
import { Validation } from '../validation/rules';

type ChainInvoice = { status?: string };

export class ExpirationMonitor {
  private async getInvoiceStatus(
    chain: IStacksChainClient,
    idHex: string,
  ): Promise<string> {
    const maybe = chain as unknown as {
      readInvoiceStatus?: (id: string) => Promise<string>;
      readInvoice?: (id: string) => Promise<unknown>;
    };
    try {
      if (typeof maybe.readInvoiceStatus === 'function') {
        return await maybe.readInvoiceStatus(idHex);
      }
      if (typeof maybe.readInvoice === 'function') {
        const inv = await maybe.readInvoice(idHex);
        const s = (inv as ChainInvoice)?.status;
        return s ? String(s) : 'unknown';
      }
    } catch {}
    return 'unknown';
  }

  async emitInvoiceExpiredWebhook(
    invoiceId: string,
    storeId: string,
    deps: { store: ISqliteStore; dispatcher: IWebhookDispatcher; nowEpochSecs?: number },
  ): Promise<boolean> {
    if (!invoiceId || !storeId) throw new Error('invalid_args');

    const already = deps.store.existsSuccessfulDeliveryFor({
      storeId: String(storeId),
      invoiceId: String(invoiceId),
      eventType: 'invoice-expired',
    });
    if (already) return false;

    const rawBody = JSON.stringify({ invoiceId, status: 'expired' as const });
    await deps.dispatcher.dispatch({
      storeId, invoiceId, eventType: 'invoice-expired', rawBody,
    });
    return true;
  }

// src/services/ExpirationMonitor.ts
async sweepOnchainStatuses(
  candidateIdHexes: string[],
  deps: { store: ISqliteStore; chain: IStacksChainClient; dispatcher: IWebhookDispatcher },
): Promise<{ expiredIds: string[]; updated: number }> {
  // 0) Load all invoices once; we'll filter twice (on-chain + time-based).
  const allRows = deps.store.selectAdminInvoices() as InvoiceRow[];

  // 1) ON-CHAIN sweep (existing behavior)
  const valid = Array.from(new Set(
    candidateIdHexes.filter((h) => typeof h === 'string' && Validation.idHex64.test(h)),
  ));
  const expiredHexSet = new Set<string>();
  for (const idHex of valid) {
    const status = (await this.getInvoiceStatus(deps.chain, idHex)).toLowerCase();
    if (status === 'expired') expiredHexSet.add(idHex);
  }
  const onchainExpiredIds = Array.from(expiredHexSet);

  // Build eligible rows for on-chain expired
  const onchainEligible = allRows.filter(
    (r) =>
      expiredHexSet.has(r.id_hex) &&
      r.status !== 'paid' &&
      r.status !== 'canceled' &&
      Number(r.expired) === 0,
  );

  // 2) TIME-BASED sweep (NEW): DTO quote has expired, regardless of chain status
  const nowMs = Date.now();
  const timeExpiredEligible = allRows.filter(
    (r) =>
      r.status === 'unpaid' &&
      Number(r.expired) === 0 &&
      typeof r.quote_expires_at === 'number' &&
      nowMs > Number(r.quote_expires_at),
  );

  // 3) Combine both sets, dedupe by id_raw
  const combinedByIdRaw = new Map<string, InvoiceRow>();
  for (const row of [...onchainEligible, ...timeExpiredEligible]) {
    combinedByIdRaw.set(row.id_raw, row);
  }
  const toMark = Array.from(combinedByIdRaw.values());

  if (toMark.length === 0) {
    return { expiredIds: onchainExpiredIds, updated: 0 };
  }

  // 4) Persist + emit webhooks
  const idRawList = toMark.map((r) => r.id_raw);
  const updated = deps.store.bulkMarkExpired(idRawList);

  // Emit per row (exactly-once safeguard remains in emitInvoiceExpiredWebhook)
  for (const row of toMark) {
    // eslint-disable-next-line no-await-in-loop
    await this.emitInvoiceExpiredWebhook(row.id_raw, row.store_id, {
      store: deps.store,
      dispatcher: deps.dispatcher,
    });
  }

  return { expiredIds: onchainExpiredIds, updated };
}

}
