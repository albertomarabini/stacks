"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdditionalControllerUsagesOfAdminParamGuard = void 0;
// src/delegates/AdditionalControllerUsagesOfAdminParamGuard.ts
const AdminParamGuard_1 = require("../delegates/AdminParamGuard");
class AdditionalControllerUsagesOfAdminParamGuard {
    constructor() {
        this.guard = new AdminParamGuard_1.AdminParamGuard();
    }
    validateSetSbtcTokenBody(body) {
        const contractAddress = String(body.contractAddress ?? '');
        const contractName = String(body.contractName ?? '');
        this.guard.assertStacksPrincipal(contractAddress);
        if (!contractName) {
            throw new TypeError('Invalid contractName');
        }
        return { contractAddress, contractName };
    }
    validateActivateStoreParams(storeId, body) {
        this.guard.assertUuid(storeId);
        const active = !!body.active;
        return { storeId, active };
    }
    validateCancelInvoiceParams(invoiceId) {
        this.guard.assertUuid(invoiceId);
        return { invoiceId };
    }
}
exports.AdditionalControllerUsagesOfAdminParamGuard = AdditionalControllerUsagesOfAdminParamGuard;
//# sourceMappingURL=AdditionalControllerUsagesOfAdminParamGuard.js.map