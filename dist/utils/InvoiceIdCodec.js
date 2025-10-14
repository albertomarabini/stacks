"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.InvoiceIdCodec = void 0;
// src/utils/InvoiceIdCodec.ts
const crypto_1 = __importDefault(require("crypto"));
class InvoiceIdCodec {
    assertHex64(idHex) {
        if (typeof idHex !== 'string' || idHex.length !== 64) {
            throw new Error('idHex must be a 64-character hex string');
        }
        if (!/^[0-9A-Fa-f]{64}$/.test(idHex)) {
            throw new Error('idHex must contain only hexadecimal characters');
        }
        const buf = Buffer.from(idHex, 'hex');
        if (buf.length !== 32) {
            throw new Error('idHex must decode to exactly 32 bytes');
        }
        const roundTrip = Buffer.from(buf).toString('hex');
        if (roundTrip.length !== 64) {
            throw new Error('idHex round-trip failed to produce 64 chars');
        }
    }
    isValidHex64(idHex) {
        try {
            this.assertHex64(idHex);
            return true;
        }
        catch {
            return false;
        }
    }
    toBuff32Hex(idHex) {
        this.assertHex64(idHex);
        return Buffer.from(idHex, 'hex');
    }
    hexFromBuff32(buf) {
        if (!(buf instanceof Uint8Array) || buf.length !== 32) {
            throw new Error('buf32 must be a 32-byte buffer');
        }
        const hex = Buffer.from(buf).toString('hex');
        if (hex.length !== 64) {
            throw new Error('hex round-trip failed to produce 64 chars');
        }
        if (Buffer.from(hex, 'hex').length !== 32) {
            throw new Error('hex did not round-trip to 32 bytes');
        }
        return hex;
    }
    generateRandomBuff32Hex() {
        return crypto_1.default.randomBytes(32).toString('hex');
    }
    generateRandomBuff32() {
        return crypto_1.default.randomBytes(32);
    }
}
exports.InvoiceIdCodec = InvoiceIdCodec;
//# sourceMappingURL=InvoiceIdCodec.js.map