// src/delegates/ContractCallEventNormalizer.ts
import type { IStacksChainClient } from '/src/contracts/interfaces';
import type { ISqliteStore } from '/src/contracts/dao';
import type { NormalizedEvent } from '/src/contracts/domain';

export class ContractCallEventNormalizer {
  async fetchAndFilterEvents(
    fromHeight: number,
    chain: IStacksChainClient,
    store: ISqliteStore,
  ): Promise<NormalizedEvent[]> {
    const raw = await chain.getContractCallEvents({ fromHeight });

    const allowed = new Set<string>([
      'pay-invoice',
      'refund-invoice',
      'cancel-invoice',
      'create-subscription',
      'cancel-subscription',
      'pay-subscription',
    ]);

    const normalizeHex64 = (arg: any): string => {
      const hex = String(arg?.hex ?? '').replace(/^0x/, '');
      return hex.toLowerCase();
    };

    const parseUInt = (arg: any): number => {
      const repr: string = String(arg?.repr ?? '');
      if (repr.startsWith('u')) return Number(repr.slice(1));
      return Number(repr);
    };

    const parsePrincipal = (arg: any): string => {
      return String(arg?.repr ?? '');
    };

    const out: NormalizedEvent[] = [];

    for (const tx of raw) {
      const fn = String(tx?.contract_call?.function_name ?? '');
      if (!allowed.has(fn)) continue;

      const args: any[] = tx?.contract_call?.function_args ?? [];
      const block_height: number = Number(tx.block_height);
      const tx_id: string = String(tx.tx_id);
      const tx_index: number = Number(tx.tx_index ?? 0);
      const sender: string = String(tx.sender_address ?? '');

      const idHex = args[0] ? normalizeHex64(args[0]) : '';
      if (!/^[0-9a-f]{64}$/.test(idHex)) continue;

      if (fn === 'pay-invoice') {
        if (store.invoiceExists(idHex)) {
          out.push({ type: 'invoice-paid', idHex, block_height, tx_id, tx_index, sender });
        }
        continue;
      }

      if (fn === 'refund-invoice') {
        if (store.invoiceExists(idHex)) {
          const refundAmountSats = parseUInt(args[1]);
          out.push({ type: 'refund-invoice', idHex, block_height, tx_id, tx_index, refundAmountSats });
        }
        continue;
      }

      if (fn === 'cancel-invoice') {
        if (store.invoiceExists(idHex)) {
          out.push({ type: 'invoice-canceled', idHex, block_height, tx_id, tx_index });
        }
        continue;
      }

      if (fn === 'create-subscription') {
        const merchantPrincipal = parsePrincipal(args[1]);
        const subscriber = parsePrincipal(args[2]);
        const amountSats = parseUInt(args[3]);
        const intervalBlocks = parseUInt(args[4]);
        out.push({
          type: 'create-subscription',
          idHex,
          block_height,
          tx_id,
          tx_index,
          merchantPrincipal,
          subscriber,
          amountSats,
          intervalBlocks,
        });
        continue;
      }

      if (fn === 'cancel-subscription') {
        out.push({ type: 'cancel-subscription', idHex, block_height, tx_id, tx_index });
        continue;
      }

      if (fn === 'pay-subscription') {
        out.push({ type: 'pay-subscription', idHex, block_height, tx_id, tx_index, sender });
        continue;
      }
    }

    out.sort((a, b) => {
      if (a.block_height !== b.block_height) return a.block_height - b.block_height;
      return a.tx_index - b.tx_index;
    });

    return out;
  }
}
