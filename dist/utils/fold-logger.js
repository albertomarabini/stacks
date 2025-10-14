"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FoldLog = void 0;
/* Minimal, zero-deps folding logger that keeps the last TWO keys.
 * Prints "… called x N times" when a streak ends.
 * Usage:
 *   const flog = new FoldLog('[CHAIN]', process.env.GLOBAL_DEBUGGING === '1');
 *   flog.line('RO|get-invoice|0x1234', '[RO] get-invoice(0x1234) → ok 177B');
 *   flog.flushAll() // on shutdown
 */
class FoldLog {
    constructor(scope = '', enabled = true) {
        this.last0 = null;
        this.last1 = null;
        this.enabled = !!enabled;
        this.scope = scope ? String(scope).trim() : '';
        if (this.enabled) {
            process.once('exit', () => this.flushAll());
            process.once('SIGINT', () => { this.flushAll(); process.exit(130); });
        }
    }
    print(line) {
        if (!this.enabled)
            return;
        if (this.scope) {
            // Match your style: [CHAIN] ...
            console.log(`${this.scope} ${line}`);
        }
        else {
            console.log(line);
        }
    }
    flushEntry(e) {
        if (!this.enabled || !e)
            return;
        if (e.count > 1) {
            // Print the compressed summary line once the streak ends
            this.print(`${e.line} … called x ${e.count} times`);
        }
    }
    /** Emit a (key,line). First time prints the line.
     *  Repeats with same key are buffered and later summarized.
     *  Keeps last two distinct keys; flushes the older one when a new third key appears.
     */
    line(key, line) {
        if (!this.enabled)
            return;
        if (this.last0 && this.last0.key === key) {
            this.last0.count++;
            return; // keep folding
        }
        if (this.last1 && this.last1.key === key) {
            this.last1.count++;
            return; // keep folding
        }
        // New distinct key
        // Flush the older of the TWO slots
        if (this.last1)
            this.flushEntry(this.last1);
        // Slide: last0 → last1
        this.last1 = this.last0;
        // Insert new as last0 and print its first occurrence immediately
        this.last0 = { key, line, count: 1 };
        this.print(line);
    }
    /** Force-flush both buffers (used at shutdown/tests). */
    flushAll() {
        if (!this.enabled)
            return;
        // Flush last1 then last0 in that order (older first)
        this.flushEntry(this.last1);
        this.last1 = null;
        this.flushEntry(this.last0);
        this.last0 = null;
    }
}
exports.FoldLog = FoldLog;
exports.default = FoldLog;
//# sourceMappingURL=fold-logger.js.map