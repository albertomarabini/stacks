// src/delegates/ReorgGuard.ts
import type { IStacksChainClient } from '../contracts/interfaces';

export type CursorSnapshot = { lastHeight: number; lastBlockHash?: string };

export class ReorgGuard {
  async detectReorg(
    firstBlockToProcessHeight: number,
    tipHeight: number,
    cursor: CursorSnapshot,
    chain: IStacksChainClient,
  ): Promise<boolean> {
    if (tipHeight < cursor.lastHeight) return true;
    if (cursor.lastHeight === 0) return false;
    const header = await chain.getBlockHeader(firstBlockToProcessHeight);
    const parent = header.parent_block_hash;
    return parent !== cursor.lastBlockHash;
  }

  computeRewindTarget(cursor: CursorSnapshot, reorgWindowBlocks: number): number {
    const back = Math.max(0, cursor.lastHeight - reorgWindowBlocks);
    return back;
  }
}
