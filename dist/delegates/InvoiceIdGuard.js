"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvoiceIdGuard = void 0;
class InvoiceIdGuard {
    constructor(codec) {
        this.codec = codec;
    }
    validateHexIdOrThrow(idHex) {
        this.codec.assertHex64(idHex);
    }
}
exports.InvoiceIdGuard = InvoiceIdGuard;
//# sourceMappingURL=InvoiceIdGuard.js.map