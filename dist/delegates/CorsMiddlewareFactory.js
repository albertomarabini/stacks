"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CorsMiddlewareFactory = void 0;
const cors_1 = __importDefault(require("cors"));
class CorsMiddlewareFactory {
    create(methods, corsPolicy) {
        return (req, res, next) => (0, cors_1.default)({
            origin: (origin, cb) => corsPolicy.publicCorsOriginValidator(origin, cb, req),
            methods,
            allowedHeaders: [
                'Content-Type',
                'X-API-Key',
                'X-Webhook-Timestamp',
                'X-Webhook-Signature',
            ],
        })(req, res, next);
    }
}
exports.CorsMiddlewareFactory = CorsMiddlewareFactory;
//# sourceMappingURL=CorsMiddlewareFactory.js.map