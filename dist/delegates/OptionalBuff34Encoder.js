"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OptionalBuff34Encoder = void 0;
const transactions_1 = require("@stacks/transactions");
class OptionalBuff34Encoder {
    encodeOptionalUtf8ToBuff34(input) {
        if (input === undefined || input === null || input === '') {
            return (0, transactions_1.noneCV)();
        }
        const buf = Buffer.from(input, 'utf8').subarray(0, 34);
        return (0, transactions_1.someCV)((0, transactions_1.bufferCV)(buf));
    }
}
exports.OptionalBuff34Encoder = OptionalBuff34Encoder;
//# sourceMappingURL=OptionalBuff34Encoder.js.map