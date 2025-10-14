"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toJsonSafe = toJsonSafe;
// utils/json-safe.ts (you already have something like this)
function toJsonSafe(v) {
    const seen = new WeakMap();
    const walk = (x) => {
        if (x === null || typeof x !== 'object') {
            return typeof x === 'bigint' ? x.toString() : x;
        }
        if (seen.has(x))
            return seen.get(x);
        if (Array.isArray(x)) {
            const arr = x.map(walk);
            seen.set(x, arr);
            return arr;
        }
        if (typeof Buffer !== 'undefined' && Buffer.isBuffer(x))
            return `0x${x.toString('hex')}`;
        if (x instanceof Map)
            return Object.fromEntries([...x].map(([k, v]) => [k, walk(v)]));
        if (x instanceof Set)
            return [...x].map(walk);
        const out = {};
        seen.set(x, out);
        for (const [k, v] of Object.entries(x))
            out[k] = walk(v);
        return out;
    };
    return walk(v);
}
//# sourceMappingURL=json-safe.js.map