// src/delegates/ContractCallEventNormalizer.ts
import type { IStacksChainClient } from '../contracts/interfaces';
import type { ISqliteStore } from '../contracts/dao';
import type { NormalizedEvent } from '../contracts/domain';
import { hexToCV, cvToJSON } from '@stacks/transactions';

function cleanHex64(x?: string) {
  return String(x ?? '').replace(/^0x/i, '').toLowerCase();
}
function toNumU(nLike: any) {
  const s = String(nLike ?? '');
  return Number(s.startsWith('u') ? s.slice(1) : s);
}
function isContractLog(ev: any) {
  const t = ev?.event_type || ev?.eventType;
  return t === 'smart_contract_log' || t === 'contract_log';
}

// Parse a contract_log `{ value: {hex, repr} }` into { tag, idHex, amountSats, ... }
function parsePrint(ev: any) {
  const v = ev?.contract_log?.value;
  const repr: string = String(v?.repr ?? '');
  const hex: string | undefined = v?.hex;

  if (hex) {
    try {
      const cv = hexToCV(hex);
      let j: any = cvToJSON(cv);
      if (j?.type === 'response' && j.value) j = j.value;

      // Normalize to the inner tuple
      let tuple = j;
      if (tuple?.type !== 'tuple' && tuple?.value?.type === 'tuple') tuple = tuple.value;

      // Tuples from cvToJSON are arrays of { name, value, type }
      const fields: any[] = Array.isArray(tuple?.value) ? tuple.value : [];
      const get = (k: string) => fields.find((x: any) => x?.name === k)?.value;

      // Tag/event
      const tagVal = get('event') ?? get('tag');
      const tag = String(tagVal?.value ?? tagVal ?? '').toLowerCase();

      // ID (buff)
      const idCV = get('id');
      const idHex = cleanHex64(String(idCV?.value ?? idCV ?? ''));

      // Amount (uint) — tolerate bigint or "u…" strings
      const amtCV = get('amount');
      const amountSats = toNumU(amtCV?.value ?? amtCV);

      // Optionals we sometimes print with subscriptions
      const merchantVal = get('merchant');
      const merchant = String(merchantVal?.value ?? merchantVal ?? '') || undefined;

      const subscriberVal = get('subscriber');
      const subscriber = String(subscriberVal?.value ?? subscriberVal ?? '') || undefined;

      const intervalVal = get('interval-blocks') ?? get('interval');
      const intervalBlocks = toNumU(intervalVal?.value ?? intervalVal);

      if (tag) {
        return { tag, idHex, amountSats, merchant, subscriber, intervalBlocks };
      }
    } catch {
      // fall through to repr parsing
    }
  }

  // Fallback: look for “…invoice-refunded… 0x<64> … u<amt> …”
  const m =
    /(invoice-(?:paid|refunded|canceled))(?:(?!\n).)*(0x[0-9a-fA-F]{64})?(?:(?!\n).)*u(\d+)/.exec(
      repr
    );
  if (m) {
    return {
      tag: m[1].toLowerCase(),
      idHex: cleanHex64(m[2] || ''),
      amountSats: Number(m[3] || '0'),
    };
  }

  const sm = /(subscription-(?:created|paid|canceled))/.exec(repr);
  if (sm) return { tag: sm[1].toLowerCase() };

  return null;
}


export class ContractCallEventNormalizer {
  async fetchAndFilterEvents(fromHeight: number, chain: IStacksChainClient, store: ISqliteStore) {
    const events = await chain.getContractCallEvents({ fromHeight });
    const out: NormalizedEvent[] = [];

    for (const ev of events) {
      if (!isContractLog(ev)) continue;

      const block_height = Number(ev?.block_height ?? ev?.tx?.block_height ?? NaN);
      if (!Number.isFinite(block_height)) continue;
      const tx_id: string = String(ev?.tx_id ?? ev?.txid ?? '');
      const tx_index: number = Number(ev?.tx_index ?? 0);

      const p = parsePrint(ev);

      // NEW: surface what we saw and why we skip
      if (!p) {
        console.debug('[EVT:NORM] skip (parse=null)', { tx_id, block_height, tx_index });
        continue;
      }
      console.debug('[EVT:NORM] parsed', { tag: p.tag, idHex: p.idHex, amountSats: p.amountSats, tx_id });

      if (p.tag === 'invoice-paid') {
        const idHex = cleanHex64(p.idHex);
        if (idHex && store.invoiceExists(idHex)) {
          out.push({ type: 'invoice-paid', idHex, block_height, tx_id, tx_index });
          console.debug('[EVT:NORM] -> push invoice-paid', { idHex, tx_id });
        } else {
          console.debug('[EVT:NORM] drop paid (missing/unknown idHex)', { idHex, tx_id });
        }
        continue;
      }

      if (p.tag === 'invoice-refunded') {
        const idHex = cleanHex64(p.idHex);
        if (idHex && store.invoiceExists(idHex)) {
          const amt = Number(p.amountSats ?? 0);
          out.push({ type: 'refund-invoice', idHex, amountSats: amt, block_height, tx_id, tx_index });
          console.debug('[EVT:NORM] -> push refund-invoice', { idHex, amt, tx_id });
        } else {
          console.debug('[EVT:NORM] drop refund (missing/unknown idHex)', { idHex, tx_id });
        }
        continue;
      }
      if (!p || !p.tag) continue;

      // Map prints → NormalizedEvent(s), always use **amountSats**
      if (p.tag === 'invoice-paid') {
        const idHex = cleanHex64(p.idHex);
        if (idHex && store.invoiceExists(idHex)) {
          out.push({ type: 'invoice-paid', idHex, block_height, tx_id, tx_index });
        }
        continue;
      }

      if (p.tag === 'invoice-refunded') {
        const idHex = cleanHex64(p.idHex);
        if (idHex && store.invoiceExists(idHex)) {
          out.push({
            type: 'refund-invoice',
            idHex,
            amountSats: Number(p.amountSats ?? 0),
            block_height,
            tx_id,
            tx_index,
          });
        }
        continue;
      }

      if (p.tag === 'invoice-canceled') {
        const idHex = cleanHex64(p.idHex);
        if (idHex && store.invoiceExists(idHex)) {
          out.push({ type: 'invoice-canceled', idHex, block_height, tx_id, tx_index });
        }
        continue;
      }

      if (p.tag === 'subscription-created') {
        const idHex = cleanHex64(p.idHex);
        if (!idHex) continue;
        out.push({
          type: 'create-subscription',
          idHex,
          block_height,
          tx_id,
          tx_index,
          merchantPrincipal: p.merchant,
          subscriber: p.subscriber,
          amountSats: Number(p.amountSats ?? 0),
          intervalBlocks: Number(p.intervalBlocks ?? 0),
        });
        continue;
      }

      if (p.tag === 'subscription-paid') {
        const idHex = cleanHex64(p.idHex);
        if (!idHex) continue;
        out.push({ type: 'pay-subscription', idHex, block_height, tx_id, tx_index });
        continue;
      }

      if (p.tag === 'subscription-canceled') {
        const idHex = cleanHex64(p.idHex);
        if (!idHex) continue;
        out.push({ type: 'cancel-subscription', idHex, block_height, tx_id, tx_index });
        continue;
      }
    }

    out.sort((a, b) => (a.block_height - b.block_height) || (a.tx_index - b.tx_index));
    return out;
  }
}
