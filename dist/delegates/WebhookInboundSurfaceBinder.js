"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookInboundSurfaceBinder = void 0;
const express_1 = __importDefault(require("express"));
class WebhookInboundSurfaceBinder {
    constructor() {
        this.mounted = false;
    }
    bind(app, verifierMw) {
        if (this.mounted)
            return;
        app.use('/webhooks/inbound', express_1.default.raw({ type: 'application/json' }), verifierMw);
        this.mounted = true;
    }
}
exports.WebhookInboundSurfaceBinder = WebhookInboundSurfaceBinder;
//# sourceMappingURL=WebhookInboundSurfaceBinder.js.map