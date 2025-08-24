// src/delegates/WebhookAdminRetryService.ts
import type { ISqliteStore } from '/src/contracts/dao';
import type { IWebhookDispatcher } from '/src/contracts/interfaces';
import type { WebhookLogRow } from '/src/contracts/domain';

export class WebhookAdminRetryService {
  async retry(
    store: ISqliteStore,
    dispatcher: IWebhookDispatcher,
    webhookLogId: string
  ): Promise<
    | { type: 'not-found' }
    | { type: 'already-delivered' }
    | { type: 'enqueued'; enqueued: boolean }
  > {
    const row = store.getWebhookLogById(webhookLogId);
    if (!row) return { type: 'not-found' };

    const successExists = store.existsSuccessfulDeliveryFor({
      storeId: row.store_id,
      invoiceId: row.invoice_id ?? undefined,
      subscriptionId: row.subscription_id ?? undefined,
      eventType: row.event_type as any,
    });
    if (successExists) return { type: 'already-delivered' };

    const enqueued = await (dispatcher as any).enqueueRetryIfNotInflight(row as WebhookLogRow);
    return { type: 'enqueued', enqueued: !!enqueued };
  }
}
