"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulerStartupCoordinator = void 0;
class SchedulerStartupCoordinator {
    constructor() {
        this.startedPoller = false;
        this.startedRetry = false;
        this.startedSubscription = false;
    }
    async startSchedulers(deps) {
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
exports.SchedulerStartupCoordinator = SchedulerStartupCoordinator;
//# sourceMappingURL=SchedulerStartupCoordinator.js.map