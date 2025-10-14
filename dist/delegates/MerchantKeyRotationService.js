"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MerchantKeyRotationService = void 0;
// src/delegates/MerchantKeyRotationService.ts
const crypto_1 = require("crypto");
class MerchantKeyRotationService {
    constructor() {
        this.deliveredOnce = new Set();
    }
    rotate(store, storeId) {
        const exists = store.listMerchantsProjection().some((m) => m.id === storeId);
        if (!exists)
            return { ok: false, notFound: true };
        if (this.deliveredOnce.has(storeId)) {
            // Do not rotate again and do not leak again
            return { ok: false, alreadyDelivered: true };
        }
        const apiKey = (0, crypto_1.randomBytes)(32).toString('hex');
        const hmacSecret = (0, crypto_1.randomBytes)(32).toString('hex');
        store.updateMerchantKeysTx(storeId, apiKey, hmacSecret);
        this.deliveredOnce.add(storeId);
        return { ok: true, apiKey, hmacSecret };
    }
}
exports.MerchantKeyRotationService = MerchantKeyRotationService;
//# sourceMappingURL=MerchantKeyRotationService.js.map