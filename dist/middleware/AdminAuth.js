"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminAuth = void 0;
const crypto_1 = __importDefault(require("crypto"));
class AdminAuth {
    bindCredentialsFromEnv(_cfg) {
        this.bearer = process.env.ADMIN_TOKEN;
        this.basicUser = process.env.ADMIN_USER;
        this.basicPass = process.env.ADMIN_PASS;
    }
    authenticateAdmin(req, res, next) {
        const header = req.headers['authorization'];
        let ok = false;
        if (header && header.startsWith('Bearer ')) {
            const token = header.slice(7).trim();
            if (this.bearer && this.timingSafeEqualStr(token, this.bearer)) {
                ok = true;
            }
        }
        else if (header && header.startsWith('Basic ')) {
            const payload = header.slice(6).trim();
            const decoded = Buffer.from(payload, 'base64').toString('utf8');
            const idx = decoded.indexOf(':');
            const user = idx >= 0 ? decoded.slice(0, idx) : decoded;
            const pass = idx >= 0 ? decoded.slice(idx + 1) : '';
            if (this.basicUser &&
                this.basicPass &&
                this.timingSafeEqualStr(user, this.basicUser) &&
                this.timingSafeEqualStr(pass, this.basicPass)) {
                ok = true;
            }
        }
        if (ok) {
            next();
            return;
        }
        res.status(401).send('Unauthorized');
    }
    timingSafeEqualStr(a, b) {
        if (typeof a !== 'string' || typeof b !== 'string')
            return false;
        const ab = Buffer.from(a, 'utf8');
        const bb = Buffer.from(b, 'utf8');
        if (ab.length !== bb.length)
            return false;
        return crypto_1.default.timingSafeEqual(ab, bb);
    }
}
exports.AdminAuth = AdminAuth;
//# sourceMappingURL=AdminAuth.js.map