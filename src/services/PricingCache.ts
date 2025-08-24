export class PricingCache {
  private snapshot: number | null = null;
  private timestampMs = 0;
  private ttlMs: number;

  constructor(ttlMs: number) {
    this.ttlMs = ttlMs;
  }

  initCache(): void {
    this.snapshot = null;
    this.timestampMs = 0;
  }

  get(): number | null {
    return this.snapshot;
  }

  set(value: number, nowMs?: number): void {
    this.snapshot = value;
    this.timestampMs = nowMs !== undefined ? nowMs : Date.now();
  }

  isExpired(nowMs?: number): boolean {
    const now = nowMs !== undefined ? nowMs : Date.now();
    if (this.ttlMs <= 0) return true;
    if (this.timestampMs === 0) return true;
    return now - this.timestampMs >= this.ttlMs;
  }
}
