"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookAdminRetryService = void 0;
class WebhookAdminRetryService {
    async retry(store, dispatcher, webhookLogId) {
        const row = store.getWebhookLogById(webhookLogId);
        if (!row)
            return { type: 'not-found' };
        const successExists = store.existsSuccessfulDeliveryFor({
            storeId: row.store_id,
            invoiceId: row.invoice_id ?? undefined,
            subscriptionId: row.subscription_id ?? undefined,
            eventType: row.event_type,
        });
        if (successExists)
            return { type: 'already-delivered' };
        const enqueued = await dispatcher.enqueueRetryIfNotInflight(row);
        return { type: 'enqueued', enqueued: !!enqueued };
    }
}
exports.WebhookAdminRetryService = WebhookAdminRetryService;
//# sourceMappingURL=WebhookAdminRetryService.js.map