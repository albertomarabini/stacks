"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RateLimitPolicy = void 0;
// RateLimitPolicy.ts
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
class RateLimitPolicy {
    initLimiters() {
        const publicWindowMs = Number(process.env.RL_PUBLIC_WINDOW_MS ?? 60000);
        const publicMax = Number(process.env.RL_PUBLIC_MAX ?? 30);
        const merchantWindowMs = Number(process.env.RL_MERCHANT_WINDOW_MS ?? 60000);
        const merchantMax = Number(process.env.RL_MERCHANT_MAX ?? 30);
        const subWindowMs = Number(process.env.RL_SUB_WINDOW_MS ?? 60000);
        const subMax = Number(process.env.RL_SUB_MAX ?? 30);
        this.publicInvoiceViewLimiter = this.buildPublicLimiter(this.publicInvoiceViewLimiterHandler.bind(this), publicWindowMs, publicMax);
        this.publicProfileLimiter = this.buildPublicLimiter(this.publicProfileLimiterHandler.bind(this), publicWindowMs, publicMax);
        this.publicCreateTxLimiter = this.buildPublicLimiter(this.publicCreateTxLimiterHandler.bind(this), publicWindowMs, publicMax);
        this.createInvoiceLimiter = this.buildMerchantLimiter(this.createInvoiceLimiterHandler.bind(this), merchantWindowMs, merchantMax);
        this.subInvoiceLimiter = this.buildSubInvoiceLimiter(subWindowMs, subMax);
    }
    // ----- Express handlers you want called on limit -----
    publicInvoiceViewLimiterHandler(req, res) {
        res.status(429).json({ reason: 'rateLimited' });
    }
    publicProfileLimiterHandler(req, res) {
        res.status(429).json({ reason: 'rateLimited' });
    }
    publicCreateTxLimiterHandler(req, res) {
        res.status(429).json({ reason: 'rateLimited' });
    }
    createInvoiceLimiterHandler(req, res) {
        res.status(429).json({ error: 'rate_limited' });
    }
    subInvoiceLimiterHandler(req, res) {
        res.status(429).json({ error: 'rate_limited' });
    }
    // ----- Adapters (v7 expects Fetch-like request/response) -----
    toExpressOnLimit(fn) {
        return (request, response) => {
            fn(request, response);
        };
    }
    // ----- Builders -----
    buildPublicLimiter(onLimit, windowMs, max) {
        return (0, express_rate_limit_1.default)({
            windowMs,
            max,
            standardHeaders: true,
            legacyHeaders: false,
            handler: this.toExpressOnLimit(onLimit),
            // public routes can use default key (req.ip); see trust proxy note below
        });
    }
    buildMerchantLimiter(onLimit, windowMs, max) {
        return (0, express_rate_limit_1.default)({
            windowMs,
            max,
            standardHeaders: true,
            legacyHeaders: false,
            handler: this.toExpressOnLimit(onLimit),
            keyGenerator: (req) => {
                const storeId = String(req.store?.id ?? req.params?.storeId ?? 'unknown');
                const apiKey = String(req.headers['x-api-key'] ?? req.headers['X-API-Key'] ?? 'no-key');
                return `${storeId}|${apiKey}`;
            },
        });
    }
    buildSubInvoiceLimiter(windowMs, max) {
        return (0, express_rate_limit_1.default)({
            windowMs: windowMs ?? 60000,
            max: max ?? 30,
            standardHeaders: true,
            legacyHeaders: false,
            handler: this.toExpressOnLimit(this.subInvoiceLimiterHandler.bind(this)),
            keyGenerator: (req) => {
                const storeId = String(req.store?.id ?? req.params?.storeId ?? 'unknown');
                const apiKey = String(req.headers['x-api-key'] ?? req.headers['X-API-Key'] ?? 'no-key');
                return `${storeId}|${apiKey}`;
            },
        });
    }
}
exports.RateLimitPolicy = RateLimitPolicy;
//# sourceMappingURL=RateLimitPolicy.js.map