"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PricingService = void 0;
// src/services/PricingService.ts
const promises_1 = require("timers/promises");
class PricingService {
    constructor(opts) {
        // defaults; real values finalized in bindDependencies (cfg/env), unless overridden by opts
        this.priceUrl = opts?.priceUrl ?? process.env.PRICE_API_URL ?? 'https://api.coindesk.com/v1/bpi/currentprice/BTC.json';
        this.timeoutMs = opts?.timeoutMs ?? Number(process.env.HTTP_TIMEOUT_MS ?? 3000);
        this.retries = opts?.retries ?? Number(process.env.HTTP_RETRIES ?? 2);
        this.retryBackoffMs = opts?.retryBackoffMs ?? Number(process.env.HTTP_RETRY_BACKOFF_MS ?? 300);
    }
    /**
     * Binds cache + config, and finalizes runtime config (prefers cfg > env > ctor defaults).
     * This avoids hard-typing config getters so your IConfigService variation won’t cause TS errors.
     */
    bindDependencies(cache, cfg) {
        this.cache = cache;
        this.cfg = cfg;
        const anyCfg = this.cfg;
        // Try a few common config getter shapes, then fallback to env/current values.
        const fromCfg = (key) => (typeof anyCfg.getString === 'function' && anyCfg.getString(key)) ??
            (typeof anyCfg.get === 'function' && anyCfg.get(key)) ??
            (typeof anyCfg.getEnv === 'function' && anyCfg.getEnv(key)) ??
            undefined;
        const fromCfgNum = (key) => {
            const v = (typeof anyCfg.getNumber === 'function' && anyCfg.getNumber(key)) ??
                (typeof anyCfg.get === 'function' && anyCfg.get(key));
            if (v === undefined || v === null)
                return undefined;
            const n = Number(v);
            return Number.isFinite(n) ? n : undefined;
        };
        // Finalize runtime config (cfg > env > prev value)
        this.priceUrl =
            fromCfg('PRICE_API_URL') ??
                process.env.PRICE_API_URL ??
                this.priceUrl;
        this.timeoutMs =
            fromCfgNum('HTTP_TIMEOUT_MS') ??
                (process.env.HTTP_TIMEOUT_MS ? Number(process.env.HTTP_TIMEOUT_MS) : undefined) ??
                this.timeoutMs;
        this.retries =
            fromCfgNum('HTTP_RETRIES') ??
                (process.env.HTTP_RETRIES ? Number(process.env.HTTP_RETRIES) : undefined) ??
                this.retries;
        this.retryBackoffMs =
            fromCfgNum('HTTP_RETRY_BACKOFF_MS') ??
                (process.env.HTTP_RETRY_BACKOFF_MS ? Number(process.env.HTTP_RETRY_BACKOFF_MS) : undefined) ??
                this.retryBackoffMs;
    }
    /**
     * Returns the spot USD price snapshot.
     * Strategy:
     *  - Try live HTTP with timeout and limited retries.
     *  - On failure, if cache is NOT expired and has a value, return it.
     *  - Otherwise, throw an Error(code='price_unavailable').
     */
    async getUsdPriceSnapshot() {
        // Attempt live first (freshness wins)
        const maxAttempts = 1 + (this.retries ?? 0);
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const price = await this.fetchPriceWithTimeout();
                if (!Number.isFinite(price) || price <= 0) {
                    throw withCode(new Error('invalid_price_payload'), 'invalid_price_payload');
                }
                // Cache the success
                this.cache?.set(price);
                return price;
            }
            catch (err) {
                const isLast = attempt === maxAttempts;
                if (!isLast) {
                    const backoff = this.retryBackoffMs * attempt;
                    await (0, promises_1.setTimeout)(backoff);
                    continue;
                }
                // Last attempt failed — try cache (if present and not expired)
                if (this.cache && !this.cache.isExpired()) {
                    const cached = this.cache.get();
                    if (cached !== null && Number.isFinite(cached)) {
                        return cached;
                    }
                }
                // Nothing usable → bubble a semantic error
                const e = withCode(new Error('price_unavailable'), 'price_unavailable');
                e.cause = err;
                throw e;
            }
        }
        // Unreachable, but keeps TS happy
        const e = withCode(new Error('price_unavailable'), 'price_unavailable');
        throw e;
    }
    async fetchPriceWithTimeout() {
        // AbortController-based timeout
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
        try {
            const res = await fetch(this.priceUrl, { signal: ctrl.signal });
            if (!res.ok) {
                const err = withCode(new Error(`bad_status_${res.status}`), 'bad_status');
                console.log(`[fetchPriceWithTimeout:error] ${res.status}`);
                err.status = res.status;
                throw err;
            }
            const json = await res.json();
            // Adapt to common providers:
            // - Coindesk: json.bpi.USD.rate_float
            // - CoinGecko (simple price): json.bitcoin.usd
            // - Custom: json.price
            let price;
            if (json?.bpi?.USD?.rate_float) {
                price = Number(json.bpi.USD.rate_float);
            }
            else if (json?.bitcoin?.usd) {
                price = Number(json.bitcoin.usd);
            }
            else if (typeof json?.price === 'number') {
                price = Number(json.price);
            }
            if (!Number.isFinite(price) || price <= 0) {
                console.log(`[fetchPriceWithTimeout:error] unrecognized_price_schema price=${price} ${json} ${json}`);
                throw withCode(new Error('unrecognized_price_schema'), 'unrecognized_price_schema');
            }
            return price;
        }
        catch (err) {
            if (err?.name === 'AbortError') {
                const e = withCode(new Error('timeout'), 'ETIMEDOUT');
                e.cause = err;
                throw e;
            }
            throw err;
        }
        finally {
            clearTimeout(t);
        }
    }
}
exports.PricingService = PricingService;
function withCode(e, code) {
    e.code = code;
    return e;
}
//# sourceMappingURL=PricingService.js.map