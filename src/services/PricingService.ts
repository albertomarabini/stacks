// src/services/PricingService.ts
import type { IConfigService } from '../contracts/interfaces';
import { PricingCache } from './PricingCache';

export class PricingService {
  private cache!: PricingCache;
  private cfg!: IConfigService;

  bindDependencies(cache: PricingCache, cfg: IConfigService): void {
    this.cache = cache;
    this.cfg = cfg;
  }

  async getUsdPriceSnapshot(): Promise<number> {
    const cached = this.cache.get();
    if (cached !== null && !this.cache.isExpired()) {
      return cached;
    }

    const url = this.cfg.getPriceApiUrl();
    if (!url) {
      throw new Error('PRICE_API_URL not configured');
    }

    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`pricing_http_${resp.status}`);
    }
    const data: any = await resp.json();

    const candidates: Array<unknown> = [
      data?.bitcoin?.usd,
      data?.USD,
      data?.price,
    ];

    let usd = NaN;
    for (const c of candidates) {
      const n = Number(c);
      if (Number.isFinite(n) && n > 0) {
        usd = n;
        break;
      }
    }

    if (!Number.isFinite(usd) || usd <= 0) {
      throw new Error('bad_price');
    }

    this.cache.set(usd);
    return usd;
  }
}
