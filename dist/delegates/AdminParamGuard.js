"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminParamGuard = void 0;
class AdminParamGuard {
    assertUuid(id) {
        const re = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
        if (!re.test(id)) {
            throw new TypeError('Invalid UUID');
        }
    }
    assertStacksPrincipal(p) {
        // allow mainnet (SP…) and testnet (ST…) standard principals
        if (!/^S[PT][0-9A-Z]{38,60}$/i.test(p))
            throw new TypeError('Invalid Stacks principal/address');
        return true;
    }
    parseInvoiceStatuses(input) {
        const allowed = new Set([
            'unpaid',
            'paid',
            'partially_refunded',
            'refunded',
            'canceled',
            'expired',
        ]);
        if (!input)
            return [];
        const arr = Array.isArray(input)
            ? input
            : String(input)
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
        const out = [];
        for (const s of arr) {
            if (allowed.has(s))
                out.push(s);
        }
        return out;
    }
}
exports.AdminParamGuard = AdminParamGuard;
//# sourceMappingURL=AdminParamGuard.js.map