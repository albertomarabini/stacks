"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PollerAdminBridge = void 0;
class PollerAdminBridge {
    bindPoller(poller) {
        this.poller = poller;
    }
    getState() {
        return this.poller.getState();
    }
    restart() {
        return this.poller.restartPoller();
    }
    isActive() { return this.poller.isActive(); }
}
exports.PollerAdminBridge = PollerAdminBridge;
//# sourceMappingURL=PollerAdminBridge.js.map