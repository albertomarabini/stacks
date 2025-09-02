// src/services/ExpirationMonitor.ts
import type { ISqliteStore } from '../contracts/dao';
import type { IStacksChainClient, IWebhookDispatcher } from '../contracts/interfaces';
import type { InvoiceRow } from '../contracts/domain';
import { Validation } from '../validation/rules';

export class ExpirationMonitor {
  async emitInvoiceExpiredWebhook(
    invoiceId: string,
    storeId: string,
    deps: { store: ISqliteStore; dispatcher: IWebhookDispatcher; nowEpochSecs?: number },
  ): Promise<boolean> {
    if (!invoiceId || !storeId) {
      throw new Error('invalid_args');
    }

    const already = deps.store.existsSuccessfulDeliveryFor({
      storeId,
      invoiceId,
      eventType: 'invoice-expired',
    });
    if (already) return false;

    const rawBody = JSON.stringify({ invoiceId, status: 'expired' as const });

    await deps.dispatcher.dispatch({
      storeId,
      invoiceId,
      eventType: 'invoice-expired',
      rawBody,
    });

    return true;
  }

  async sweepOnchainStatuses(
    candidateIdHexes: string[],
    deps: { store: ISqliteStore; chain: IStacksChainClient; dispatcher: IWebhookDispatcher },
  ): Promise<{ expiredIds: string[]; updated: number }> {
    const valid = Array.from(
      new Set(candidateIdHexes.filter((h) => typeof h === 'string' && Validation.idHex64.test(h))),
    );
    if (valid.length === 0) return { expiredIds: [], updated: 0 };

    const expiredHexSet = new Set<string>();
    for (const idHex of valid) {
      const status = await deps.chain.readInvoiceStatus(idHex);
      if (status === 'expired') expiredHexSet.add(idHex);
    }
    const expiredIds = Array.from(expiredHexSet);
    if (expiredIds.length === 0) return { expiredIds, updated: 0 };

    const allRows = deps.store.selectAdminInvoices();
    const eligible: InvoiceRow[] = allRows.filter(
      (r) =>
        expiredHexSet.has(r.id_hex) &&
        r.status !== 'paid' &&
        r.status !== 'canceled' &&
        Number(r.expired) === 0,
    );

    if (eligible.length === 0) return { expiredIds, updated: 0 };

    const idRawList = eligible.map((r) => r.id_raw);
    const updated = deps.store.bulkMarkExpired(idRawList);

    for (const row of eligible) {
      // eslint-disable-next-line no-await-in-loop
      await this.emitInvoiceExpiredWebhook(row.id_raw, row.store_id, {
        store: deps.store,
        dispatcher: deps.dispatcher,
      });
    }

    return { expiredIds, updated };
  }
}
