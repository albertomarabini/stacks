"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContractCallEventNormalizer = void 0;
const transactions_1 = require("@stacks/transactions");
// ─── helpers ─────────────────────────────────────────────────────────────────
const cleanHex64 = (x) => String(x ?? '').replace(/^0x/i, '').toLowerCase();
const toNumU = (nLike) => {
    const s = String(nLike ?? '');
    return Number(s.startsWith('u') ? s.slice(1) : s);
};
const isContractLog = (ev) => {
    const t = ev?.event_type || ev?.eventType;
    return t === 'smart_contract_log' || t === 'contract_log';
};
const short = (s, n = 120) => s.length > n ? `${s.slice(0, n)}…` : s;
// Parse a contract_log `{ value: {hex, repr} }` into { tag, idHex, amountSats, ... }
function parsePrint(ev) {
    const v = ev?.contract_log?.value;
    const repr = String(v?.repr ?? '');
    const hex = v?.hex;
    if (hex) {
        try {
            const cv = (0, transactions_1.hexToCV)(hex);
            let j = (0, transactions_1.cvToJSON)(cv);
            if (j?.type === 'response' && j.value)
                j = j.value;
            // Normalize to the inner tuple
            let tuple = j;
            if (tuple?.type !== 'tuple' && tuple?.value?.type === 'tuple')
                tuple = tuple.value;
            // Tuples from cvToJSON can be arrays of { name, value, type }
            const fields = Array.isArray(tuple?.value) ? tuple.value : [];
            const get = (k) => fields.find((x) => x?.name === k)?.value;
            // Tag/event
            const tagVal = get('event') ?? get('tag');
            const tag = String(tagVal?.value ?? tagVal ?? '').toLowerCase();
            // ID (buff)
            const idCV = get('id');
            const idHex = cleanHex64(String(idCV?.value ?? idCV ?? ''));
            // Amount (uint)
            const amtCV = get('amount');
            const amountSats = toNumU(amtCV?.value ?? amtCV);
            // Optionals
            const merchantVal = get('merchant');
            const merchant = String(merchantVal?.value ?? merchantVal ?? '') || undefined;
            const subscriberVal = get('subscriber');
            const subscriber = String(subscriberVal?.value ?? subscriberVal ?? '') || undefined;
            const intervalVal = get('interval-blocks') ?? get('interval');
            const intervalBlocks = toNumU(intervalVal?.value ?? intervalVal);
            if (tag) {
                return { tag, idHex, amountSats, merchant, subscriber, intervalBlocks, repr };
            }
        }
        catch {
            // fall through to repr parsing
        }
    }
    // Fallback: “…invoice-refunded… 0x<64> … u<amt> …”
    const m = /(invoice-(?:paid|refunded|canceled))(?:(?!\n).)*(0x[0-9a-fA-F]{64})?(?:(?!\n).)*u(\d+)/.exec(repr);
    if (m) {
        return {
            tag: m[1].toLowerCase(),
            idHex: cleanHex64(m[2] || ''),
            amountSats: Number(m[3] || '0'),
            repr,
        };
    }
    const sm = /(subscription-(?:created|paid|canceled))/.exec(repr);
    if (sm)
        return { tag: sm[1].toLowerCase(), repr };
    return null;
}
// ─── main ────────────────────────────────────────────────────────────────────
class ContractCallEventNormalizer {
    async fetchAndFilterEvents(fromHeight, chain, store) {
        const events = await chain.getContractCallEvents({ fromHeight });
        const out = [];
        for (const ev of events) {
            // gate 1: only contract logs
            if (!isContractLog(ev)) {
                console.debug('[EVT:NORM] skip:non-contract-log', {
                    tx_id: ev?.tx_id ?? ev?.txid,
                    event_type: ev?.event_type || ev?.eventType,
                });
                continue;
            }
            // gate 2: block height must be present
            const block_height = Number(ev?.block_height ?? ev?.tx?.block_height ?? NaN);
            if (!Number.isFinite(block_height)) {
                console.debug('[EVT:NORM] skip:no-block-height', {
                    tx_id: ev?.tx_id ?? ev?.txid,
                });
                continue;
            }
            const tx_id = String(ev?.tx_id ?? ev?.txid ?? '');
            const tx_index = Number(ev?.tx_index ?? 0);
            // parse the printed payload
            const p = parsePrint(ev);
            if (!p) {
                const repr = String(ev?.contract_log?.value?.repr ?? '');
                console.debug('[EVT:NORM] skip:parse-null', {
                    tx_id, block_height, tx_index, repr: short(repr),
                });
                continue;
            }
            console.debug('[EVT:NORM] parsed', {
                tag: p.tag, idHex: p.idHex, amountSats: p.amountSats, tx_id, block_height, tx_index,
                repr: p.repr ? short(p.repr) : undefined,
            });
            // Map → NormalizedEvent
            const tag = p.tag;
            const idHex = cleanHex64(p.idHex);
            const ensureKnownInvoice = () => {
                if (!idHex) {
                    console.debug('[EVT:NORM] drop:empty-id', { tx_id, tag });
                    return false;
                }
                if (!store.invoiceExists(idHex)) {
                    console.debug('[EVT:NORM] drop:unknown-invoice', { tx_id, tag, idHex });
                    return false;
                }
                return true;
            };
            if (tag === 'invoice-paid') {
                if (!ensureKnownInvoice())
                    continue;
                out.push({ type: 'invoice-paid', idHex, block_height, tx_id, tx_index });
                console.debug('[EVT:NORM] push:invoice-paid', { idHex, tx_id });
                continue;
            }
            if (tag === 'invoice-refunded') {
                if (!ensureKnownInvoice())
                    continue;
                const amt = Number(p.amountSats ?? 0);
                out.push({ type: 'refund-invoice', idHex, amountSats: amt, block_height, tx_id, tx_index });
                console.debug('[EVT:NORM] push:refund-invoice', { idHex, amountSats: amt, tx_id });
                continue;
            }
            if (tag === 'invoice-canceled') {
                if (!ensureKnownInvoice())
                    continue;
                out.push({ type: 'invoice-canceled', idHex, block_height, tx_id, tx_index });
                console.debug('[EVT:NORM] push:invoice-canceled', { idHex, tx_id });
                continue;
            }
            if (tag === 'subscription-created') {
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
                console.debug('[EVT:NORM] push:subscription-created', { idHex, tx_id });
                continue;
            }
            if (tag === 'subscription-paid') {
                out.push({ type: 'pay-subscription', idHex, block_height, tx_id, tx_index });
                console.debug('[EVT:NORM] push:subscription-paid', { idHex, tx_id });
                continue;
            }
            if (tag === 'subscription-canceled') {
                out.push({ type: 'cancel-subscription', idHex, block_height, tx_id, tx_index });
                console.debug('[EVT:NORM] push:subscription-canceled', { idHex, tx_id });
                continue;
            }
            // Unknown tag — show a crumb so you notice typos/schema drifts
            console.debug('[EVT:NORM] skip:unknown-tag', { tag, tx_id, block_height, tx_index, repr: p.repr ? short(p.repr) : undefined });
        }
        out.sort((a, b) => (a.block_height - b.block_height) || (a.tx_index - b.tx_index));
        console.debug('[EVT:NORM] done', { fromHeight, fetched: events.length, kept: out.length });
        return out;
    }
}
exports.ContractCallEventNormalizer = ContractCallEventNormalizer;
//# sourceMappingURL=ContractCallEventNormalizer.js.map