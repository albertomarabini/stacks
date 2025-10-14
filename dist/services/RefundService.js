"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RefundService = void 0;
/** Two-entry coalescer (local to refund logs) */
class DuoCoalescer {
    constructor(emit) {
        this.emit = emit;
    }
    push(key, line) {
        if (this.last?.key === key) {
            this.last.count++;
            return;
        }
        if (this.prev?.key === key) {
            this.flushOne(this.last);
            this.last = { key, line: this.prev.line, count: this.prev.count + 1 };
            this.prev = undefined;
            return;
        }
        if (this.prev)
            this.flushOne(this.prev);
        this.prev = this.last;
        this.last = { key, line, count: 1 };
    }
    flushAll() { this.flushOne(this.prev); this.flushOne(this.last); this.prev = this.last = undefined; }
    flushOne(e) {
        if (!e)
            return;
        if (e.count <= 1)
            this.emit(e.line);
        else
            this.emit(`${e.line} … called x ${e.count} times`);
    }
}
class RefundService {
    constructor() {
        //DO NOT TOUCH! DEBUGGING FIXTURES
        this.debug = String(process.env.GLOBAL_DEBUGGING || '') === '1';
        this.dlog = (...a) => { if (this.debug)
            console.log('[REFUND]', ...a); };
        this.fold = new DuoCoalescer(line => this.dlog(line));
    }
    bindDependencies(deps) {
        this.chain = deps.chain;
        this.builder = deps.builder;
        this.pcf = deps.pcf;
        this.aif = deps.aif;
        this.codec = deps.codec;
        this.cfg = deps.cfg;
        // if (this.debug) process.once('beforeExit', () => this.fold.flushAll());
    }
    async precheckBalance(merchantPrincipal, amountSats) {
        const token = this.cfg.getSbtcContractId();
        // if (this.debug) this.dlog('precheckBalance', { merchantPrincipal, token });
        if (!token)
            return false;
        const bal = await this.chain.getFungibleBalance(token, merchantPrincipal);
        // if (this.debug) {
        //   this.fold.push(
        //     `BAL:${merchantPrincipal}:${bal.toString()}:${amountSats}`,
        //     `merchant sBTC balance { principal: ${merchantPrincipal}, balance: ${bal.toString()}, want: ${String(amountSats)} }`
        //   );
        // }
        return bal >= BigInt(amountSats);
    }
    async buildRefundPayload(store, invoice, amountSats, memo) {
        // Keep contract-level state machine: only paid/partially_refunded are refundable
        if (!(invoice.status === 'paid' || invoice.status === 'partially_refunded')) {
            throw new Error('not_refundable');
        }
        // Validate 64-hex id buffer
        this.codec.assertHex64(invoice.id_hex);
        if (this.debug)
            this.dlog('buildRefundPayload.in', {
                store: store.principal,
                idHex: invoice.id_hex.slice(0, 8) + '…',
                amountSats,
                memo: memo ?? null
            });
        // Keep only minimal sanity on the amount (positive integer).
        if (!Number.isFinite(amountSats) || amountSats <= 0) {
            throw new Error('invalid_amount');
        }
        const payload = this.builder.buildRefundInvoice({
            idHex: invoice.id_hex,
            amountSats,
            memo,
            merchantPrincipal: store.principal,
        });
        // show a compact view that proves PCs/mode are present (if builder sets them)
        const pcs = payload.postConditions || payload.post_conditions || [];
        this.dlog('buildRefundPayload.out', {
            fn: payload.functionName,
            where: `${payload.contractAddress}.${payload.contractName}`,
            args: (payload.functionArgs || []).map((a) => a?.type || typeof a),
            pcCount: pcs.length,
            pcm: payload.postConditionMode || payload.post_condition_mode
        });
        return payload;
    }
}
exports.RefundService = RefundService;
exports.default = RefundService;
//# sourceMappingURL=RefundService.js.map