"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StoreApiAuth = void 0;
class StoreApiAuth {
    bindStore(store) {
        this.store = store;
    }
    verifyApiKey(req, res, next) {
        if (!this.store) {
            res.status(401).end();
            return;
        }
        const apiKey = req.get('X-API-Key') ||
            req.get('x-api-key') ||
            req.headers['x-api-key'];
        if (!apiKey) {
            res.status(401).end();
            return;
        }
        const merchant = this.store.findActiveByApiKey(apiKey);
        if (!merchant) {
            res.status(401).end();
            return;
        }
        req.store = merchant;
        next();
    }
}
exports.StoreApiAuth = StoreApiAuth;
//# sourceMappingURL=StoreApiAuth.js.map