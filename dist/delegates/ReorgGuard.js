"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReorgGuard = void 0;
class ReorgGuard {
    async detectReorg(firstBlockToProcessHeight, tipHeight, cursor, chain) {
        if (tipHeight < cursor.lastHeight)
            return true;
        if (cursor.lastHeight === 0)
            return false;
        const header = await chain.getBlockHeader(firstBlockToProcessHeight).catch(() => null);
        if (!header)
            return false;
        const parent = header.parent_block_hash;
        return parent !== cursor.lastBlockHash;
    }
    computeRewindTarget(cursor, reorgWindowBlocks) {
        const back = Math.max(0, cursor.lastHeight - reorgWindowBlocks);
        return back;
    }
}
exports.ReorgGuard = ReorgGuard;
//# sourceMappingURL=ReorgGuard.js.map