// frontend/checkout/delegates/InvoiceCountdownDelegate.ts

export type CountdownTick = (timeLeftMs: number) => void;

export class InvoiceCountdownDelegate {
  private quoteExpiresAtMs: number | null = null;
  private readonly highlightThresholdMs: number;
  private intervalId: number | undefined;
  private expiredHandled = false;
  private readonly now: () => number;
  private onTick: CountdownTick | null = null;
  private onExpire: (() => void) | null = null;

  constructor(opts?: { highlightThresholdMs?: number; now?: () => number }) {
    this.highlightThresholdMs = opts?.highlightThresholdMs ?? 60_000;
    this.now = opts?.now ?? (() => Date.now());
  }

  start(quoteExpiresAtMs: number, onTick: CountdownTick, onExpire: () => void): void {
    this.stop();
    this.quoteExpiresAtMs = quoteExpiresAtMs;
    this.onTick = onTick;
    this.onExpire = onExpire;
    this.expiredHandled = false;
    this.intervalId = window.setInterval(() => this.tick(), 1000);
    this.tick();
  }

  stop(): void {
    if (this.intervalId !== undefined) {
      window.clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.onTick = null;
    this.onExpire = null;
    this.quoteExpiresAtMs = null;
    this.expiredHandled = false;
  }

  forceTick(): void {
    this.tick();
  }

  private computeTimeLeftMs(): number {
    if (this.quoteExpiresAtMs === null) return 0;
    return Math.max(0, this.quoteExpiresAtMs - this.now());
  }

  private tick(): void {
    if (this.quoteExpiresAtMs === null) return;
    const timeLeftMs = this.computeTimeLeftMs();
    if (this.onTick) this.onTick(timeLeftMs);

    if (timeLeftMs <= 0 && !this.expiredHandled) {
      this.expiredHandled = true;
      if (this.onExpire) this.onExpire();
      if (this.intervalId !== undefined) {
        window.clearInterval(this.intervalId);
        this.intervalId = undefined;
      }
    }
  }

  expireNow(): void {
    if (!this.expiredHandled) {
      this.expiredHandled = true;
      if (this.onExpire) this.onExpire();
      if (this.intervalId !== undefined) {
        window.clearInterval(this.intervalId);
        this.intervalId = undefined;
      }
    }
  }
}
