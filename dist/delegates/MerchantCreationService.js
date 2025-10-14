"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MerchantCreationService = void 0;
// src/delegates/MerchantCreationService.ts
const crypto_1 = __importDefault(require("crypto"));
class MerchantCreationService {
    async create(store, body) {
        const id = crypto_1.default.randomUUID();
        const createdAt = Math.floor(Date.now() / 1000);
        const apiKey = crypto_1.default.randomBytes(32).toString('hex');
        const hmacSecret = crypto_1.default.randomBytes(32).toString('hex');
        const insertRow = {
            id,
            principal: String(body.principal),
            name: body.name ?? undefined,
            display_name: body.display_name ?? undefined,
            logo_url: body.logo_url ?? undefined,
            brand_color: body.brand_color ?? undefined,
            webhook_url: body.webhook_url ?? undefined,
            hmac_secret: hmacSecret,
            stx_private_key: apiKey,
            active: 1,
            support_email: body.support_email ?? undefined,
            support_url: body.support_url ?? undefined,
            allowed_origins: body.allowed_origins ?? undefined,
            created_at: createdAt,
        };
        try {
            store.insertMerchant(insertRow);
        }
        catch (e) {
            if (e && (e.code === 'SQLITE_CONSTRAINT' || e.errno === 19)) {
                return { status: 'conflict' };
            }
            throw e;
        }
        const dto = {
            id,
            principal: insertRow.principal,
            name: insertRow.name ?? undefined,
            displayName: insertRow.display_name ?? undefined,
            logoUrl: insertRow.logo_url ?? undefined,
            brandColor: insertRow.brand_color ?? undefined,
            webhookUrl: insertRow.webhook_url ?? undefined,
            active: true,
            supportEmail: insertRow.support_email ?? undefined,
            supportUrl: insertRow.support_url ?? undefined,
            allowedOrigins: insertRow.allowed_origins ?? undefined,
            createdAt,
        };
        return { status: 'created', dto };
    }
}
exports.MerchantCreationService = MerchantCreationService;
//# sourceMappingURL=MerchantCreationService.js.map