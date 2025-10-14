"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookSignatureService = void 0;
// src/delegates/WebhookSignatureService.ts
const crypto_1 = __importDefault(require("crypto"));
class WebhookSignatureService {
    constructor(maxSkewSeconds = 300, replayTtlSeconds = 600) {
        this.replayCache = new Map();
        this.maxSkewSeconds = maxSkewSeconds;
        this.replayTtlSeconds = replayTtlSeconds;
    }
    buildOutboundHeaders(secret, rawBody, nowEpochSecs) {
        const signatureHex = crypto_1.default
            .createHmac('sha256', secret)
            .update(`${nowEpochSecs}.${rawBody}`)
            .digest('hex');
        return {
            signatureHex,
            timestamp: nowEpochSecs,
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Timestamp': String(nowEpochSecs),
                'X-Webhook-Signature': `v1=${signatureHex}`,
            },
        };
    }
    verifyInbound(tsHeader, sigHeader, rawBody, secret, nowEpochSecs) {
        if (!tsHeader || !sigHeader)
            return { ok: false, status: 401 };
        const ts = Number(tsHeader);
        if (!Number.isFinite(ts) || Math.abs(nowEpochSecs - ts) > this.maxSkewSeconds) {
            return { ok: false, status: 401 };
        }
        const seenAt = this.replayCache.get(sigHeader);
        if (seenAt && nowEpochSecs - seenAt <= this.replayTtlSeconds) {
            return { ok: false, status: 409 };
        }
        const presented = sigHeader.startsWith('v1=') ? sigHeader.slice(3) : sigHeader;
        const expected = crypto_1.default.createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
        const a = Buffer.from(expected, 'hex');
        const b = Buffer.from(presented, 'hex');
        if (a.length !== b.length || !crypto_1.default.timingSafeEqual(a, b)) {
            return { ok: false, status: 401 };
        }
        this.replayCache.set(sigHeader, nowEpochSecs);
        for (const [sig, firstSeen] of this.replayCache.entries()) {
            if (nowEpochSecs - firstSeen > this.replayTtlSeconds) {
                this.replayCache.delete(sig);
            }
        }
        return { ok: true };
    }
}
exports.WebhookSignatureService = WebhookSignatureService;
exports.default = WebhookSignatureService;
//# sourceMappingURL=WebhookSignatureService.js.map