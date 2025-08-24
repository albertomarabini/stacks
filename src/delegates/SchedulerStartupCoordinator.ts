// src/delegates/SchedulerStartupCoordinator.ts
import type { IConfigService } from '/src/contracts/interfaces';

export class SchedulerStartupCoordinator {
  private startedPoller = false;
  private startedRetry = false;
  private startedSubscription = false;

  public async startSchedulers(deps: {
    poller: { bootstrapPoller(): void };
    webhookRetry: { bootstrap(): void };
    subscriptionScheduler?: { bootstrapScheduler(): void };
    config: IConfigService;
  }): Promise<void> {
    if (!this.startedPoller) {
      deps.poller.bootstrapPoller();
      this.startedPoller = true;
    }
    if (!this.startedRetry) {
      deps.webhookRetry.bootstrap();
      this.startedRetry = true;
    }
    if (deps.subscriptionScheduler && !this.startedSubscription) {
      deps.subscriptionScheduler.bootstrapScheduler();
      this.startedSubscription = true;
    }
  }
}
