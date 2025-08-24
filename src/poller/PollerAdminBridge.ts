// src/poller/PollerAdminBridge.ts
import type { PollerMetrics } from '/src/contracts/domain';
import { PaymentPoller } from '/src/poller/PaymentPoller';

export class PollerAdminBridge {
  private poller!: PaymentPoller;

  bindPoller(poller: PaymentPoller): void {
    this.poller = poller;
  }

  getState(): PollerMetrics {
    return this.poller.getState();
  }

  restart(): { running: boolean } {
    return this.poller.restartPoller();
  }
}
