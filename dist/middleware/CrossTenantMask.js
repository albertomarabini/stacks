"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CrossTenantMask = void 0;
class CrossTenantMask {
    enforce(req, res, next) {
        const storeId = String(req.params.storeId);
        const merchant = req.store;
        if (merchant.id !== storeId) {
            res.status(404).end();
            return;
        }
        next();
    }
}
exports.CrossTenantMask = CrossTenantMask;
//# sourceMappingURL=CrossTenantMask.js.map