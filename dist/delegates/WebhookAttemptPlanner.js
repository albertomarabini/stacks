"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookAttemptPlanner = void 0;
// src/delegates/WebhookAttemptPlanner.ts
const crypto_1 = __importDefault(require("crypto"));
const MAX_ATTEMPTS = 5;
class WebhookAttemptPlanner {
    recordInitialAttempt(store, ctx) {
        const id = crypto_1.default.randomUUID();
        const row = {
            id,
            store_id: ctx.storeId,
            invoice_id: ctx.invoiceId,
            subscription_id: ctx.subscriptionId,
            event_type: ctx.eventType,
            payload: ctx.rawBody,
            status_code: undefined,
            success: 0,
            attempts: ctx.attempts,
            last_attempt_at: ctx.now,
        };
        store.insertWebhookAttempt(row);
        return id;
    }
    markSuccess(store, attemptLogId, status) {
        store.updateWebhookAttemptStatus(attemptLogId, { success: 1, statusCode: status });
    }
    async handleFailureAndPlanNext(store, ctx, statusOrNull) {
        store.updateWebhookAttemptStatus(ctx.attemptLogId, {
            success: 0,
            statusCode: typeof statusOrNull === 'number' ? statusOrNull : undefined,
        });
        if (ctx.attempts >= MAX_ATTEMPTS)
            return;
        await this.planNextAttempt(store, {
            storeId: ctx.storeId,
            invoiceId: ctx.invoiceId,
            subscriptionId: ctx.subscriptionId,
            eventType: ctx.eventType,
            rawBody: ctx.rawBody,
            attempts: ctx.attempts,
            now: ctx.now,
        });
    }
    async planNextAttempt(store, ctx) {
        const nextAttempt = ctx.attempts + 1;
        if (nextAttempt > MAX_ATTEMPTS)
            return;
        const id = crypto_1.default.randomUUID();
        const row = {
            id,
            store_id: ctx.storeId,
            invoice_id: ctx.invoiceId,
            subscription_id: ctx.subscriptionId,
            event_type: ctx.eventType,
            payload: ctx.rawBody,
            status_code: undefined,
            success: 0,
            attempts: nextAttempt,
            last_attempt_at: ctx.now,
        };
        store.insertWebhookAttempt(row);
    }
}
exports.WebhookAttemptPlanner = WebhookAttemptPlanner;
exports.default = WebhookAttemptPlanner;
//# sourceMappingURL=WebhookAttemptPlanner.js.map