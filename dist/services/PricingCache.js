"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PricingCache = void 0;
class PricingCache {
    constructor(ttlMs) {
        this.snapshot = null;
        this.timestampMs = 0;
        this.ttlMs = ttlMs;
    }
    initCache() {
        this.snapshot = null;
        this.timestampMs = 0;
    }
    get() {
        return this.snapshot;
    }
    set(value, nowMs) {
        this.snapshot = value;
        this.timestampMs = nowMs !== undefined ? nowMs : Date.now();
    }
    isExpired(nowMs) {
        const now = nowMs !== undefined ? nowMs : Date.now();
        if (this.ttlMs <= 0)
            return true;
        if (this.timestampMs === 0)
            return true;
        return now - this.timestampMs >= this.ttlMs;
    }
}
exports.PricingCache = PricingCache;
//# sourceMappingURL=PricingCache.js.map