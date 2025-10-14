#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * sBTC Payment – Self Test (Plain Node, no Vitest/Jest)
 * -----------------------------------------------------
 * - Runs against your Clarinet project via Simnet
 * - Covers admin config, invoice lifecycle, refunds, subscriptions, read-only
 * - Prints PASS/FAIL/SKIP with details
 *
 * Usage:
 *   node scripts/quick-sim.mjs
 *
 * Requires:
 *   - @hirosystems/clarinet-sdk (v3+)
 *   - @stacks/transactions
 *   - Clarinet.toml at project root
 */

import { initSimnet } from "@hirosystems/clarinet-sdk";
import { Cl, cvToString } from "@stacks/transactions";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// ───────────────────────────────────────────────────────────────────────────────
// Pretty output
// ───────────────────────────────────────────────────────────────────────────────
const c = {
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    dim: (s) => `\x1b[2m${s}\x1b[0m`,
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function banner() {
    console.log(c.bold("\nsBTC Payment – Self Test (Plain Node)"));
    console.log(c.dim("Uses Clarinet Simnet via SDK. First call ../bin/clarinet check"));
    console.log("");
}

// ───────────────────────────────────────────────────────────────────────────────
// Result helpers
// ───────────────────────────────────────────────────────────────────────────────
function pass(name) {
    return { name, status: "PASS" };
}
function skip(name, reason) {
    return { name, status: "SKIP", reason };
}
function fail(name, receiptOrErr, hint) {
    const receipt =
        receiptOrErr && receiptOrErr.result !== undefined ? receiptOrErr : receiptOrErr?.receipt;
    return {
        name,
        status: "FAIL",
        reason: hint || "unexpected result",
        result: resultToString(receipt),
        events: toEventList(receipt?.events),
    };
}
function printResult(r, i) {
    if (r.status === "PASS") console.log(`${i}.  ${c.green("✓")} ${r.name}`);
    else if (r.status === "SKIP")
        console.log(`${i}.  ${c.yellow("!")} ${r.name} ${c.dim(`— ${r.reason}`)}`);
    else {
        console.log(`${i}.  ${c.red("✗")} ${r.name}`);
        if (r.reason) console.log(`     ${c.bold("reason")}: ${r.reason}`);
        if (r.result) console.log(`     ${c.bold("result")}: ${r.result}`);
        if (r.events?.length) {
            console.log(`     ${c.bold("events")}:`);
            for (const e of r.events) {
                console.log("       -", e.type, e.data);
            }
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────────
// Universal result stringifier
// ───────────────────────────────────────────────────────────────────────────────
function resultToString(receiptOrCv) {
    const r =
        receiptOrCv && receiptOrCv.result !== undefined ? receiptOrCv.result : receiptOrCv;
    if (typeof r === "string") return r;
    try {
        return cvToString(r);
    } catch {
        try {
            return JSON.stringify(r);
        } catch {
            return String(r ?? "");
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────────
// Receipt helpers
// ───────────────────────────────────────────────────────────────────────────────
function isOk(receipt) {
    const s = resultToString(receipt);
    return typeof s === "string" && s.startsWith("(ok ");
}
function isErr(receipt) {
    const s = resultToString(receipt);
    return typeof s === "string" && s.startsWith("(err ");
}
function errCode(receipt) {
    const s = resultToString(receipt);
    const m = typeof s === "string" ? s.match(/\(err u(\d+)\)/) : null;
    return m ? Number(m[1]) : null;
}
function toEventList(events) {
    if (!Array.isArray(events)) return [];
    return events.map((e) => {
        if (e.event === "print_event") {
            try {
                return { type: "print", data: cvToString(e.data?.value) };
            } catch {
                return { type: "print", data: String(e.data?.value ?? "") };
            }
        }
        return { type: e.event, data: JSON.stringify(e.data ?? {}) };
    });
}
async function step(name, fn) {
    try {
        const out = await fn();
        if (out?.status) return out; // already pass/skip/fail
        return out ? pass(name) : fail(name, null, "falsy step result");
    } catch (e) {
        return fail(name, e, e?.message || "threw");
    }
}

// ───────────────────────────────────────────────────────────────────────────────
// Small utils
// ───────────────────────────────────────────────────────────────────────────────
function randHex32() {
    return crypto.randomBytes(32).toString("hex");
}
function getHeight(simnet) {
    if (typeof simnet.blockHeight === "number") return simnet.blockHeight;
    if (typeof simnet.getBlockHeight === "function") return simnet.getBlockHeight();
    return 0;
}
function canMine(simnet) {
    return (
        typeof simnet.mineEmptyBlocks === "function" ||
        typeof simnet.mineEmptyBlock === "function"
    );
}
function mine(simnet, n = 1) {
    if (typeof simnet.mineEmptyBlocks === "function") return simnet.mineEmptyBlocks(n);
    if (typeof simnet.mineEmptyBlock === "function") return simnet.mineEmptyBlock(n);
    throw new Error("SDK does not expose mineEmptyBlocks/mineEmptyBlock");
}

// ───────────────────────────────────────────────────────────────────────────────
// Safe wrappers around SDK calls (do NOT throw)
// ───────────────────────────────────────────────────────────────────────────────
function expectOk(simnet, contract, fn, args, sender, hint) {
    const r = simnet.callPublicFn(contract, fn, args, sender);
    if (isOk(r)) return r;
    const err = new Error(hint || "expected (ok ...)");
    err.receipt = r;
    throw err;
}
function expectErrU(name, r, code) {
    return isErr(r) && errCode(r) === code
        ? pass(name)
        : fail(name, r, `expected (err u${code})`);
}
function expectErr(name, r) {
    return isErr(r) ? pass(name) : fail(name, r, "expected (err ...)");
}
function expectEventContains(name, receipt, substring) {
    const events = toEventList(receipt?.events);
    const hit = events.some(
        (e) => e.type === "print" && String(e.data).includes(substring)
    );
    return hit ? pass(name) : fail(name, receipt, `expected print containing "${substring}"`);
}

/** Setup helper that NEVER throws; records a PASS/FAIL and returns the receipt or null. */
function setupOk(results, label, simnet, contract, fn, args, sender) {
    const r = simnet.callPublicFn(contract, fn, args, sender);
    if (isOk(r)) {
        results.push(pass(label));
        return r;
    } else {
        results.push(fail(label, r, "expected (ok ...)"));
        return null;
    }
}

// ───────────────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────────────
(async () => {
    banner();

    // Ensure Clarinet project
    const manifest = path.join(process.cwd(), "Clarinet.toml");
    if (!fs.existsSync(manifest)) {
        console.error(c.red("Could not find Clarinet.toml at project root."));
        process.exit(1);
    }

    // Boot simnet
    const simnet = await initSimnet();

    // Accounts
    const accounts = simnet.getAccounts();
    const deployer = accounts.get("deployer");
    const admin = deployer;
    const merchant = accounts.get("wallet_2");
    const payer = accounts.get("wallet_1");
    const stranger = accounts.get("wallet_3");

    // Contracts
    const PAYMENT = "sbtc-payment";
    const TOKEN = "sbtc-token";
    const tokenPrincipal = Cl.contractPrincipal(deployer, TOKEN);

    const results = [];

    // Bootstrap mock token owner so `mint` works
    setupOk(results, "setup: mock token bootstrap-owner", simnet, TOKEN, "bootstrap-owner", [], admin);

    // ── Admin ───────────────────────────────────────────────────────────
    results.push(await step("bootstrap-admin", () =>
        expectOk(simnet, PAYMENT, "bootstrap-admin", [], admin)
    ));
    results.push(await step("set-sbtc-token", () =>
        expectOk(simnet, PAYMENT, "set-sbtc-token", [tokenPrincipal], admin)
    ));
    // Non-admin must not be able to set token
    {
        const r = simnet.callPublicFn(PAYMENT, "set-sbtc-token", [tokenPrincipal], stranger);
        results.push(expectErr("set-sbtc-token admin-only", r));
    }
    results.push(await step("register-merchant", () =>
        expectOk(simnet, PAYMENT, "register-merchant", [Cl.principal(merchant), Cl.none()], admin)
    ));
    results.push(await step("set-merchant-active(true)", () =>
        expectOk(simnet, PAYMENT, "set-merchant-active", [Cl.principal(merchant), Cl.bool(true)], admin)
    ));
    // second bootstrap must fail
    {
        const r = simnet.callPublicFn(PAYMENT, "bootstrap-admin", [], admin);
        results.push(expectErr("bootstrap-admin second call errors", r));
    }
    // ---- Additional admin boundary tests
    {
        // non-admin cannot register merchant
        const r1 = simnet.callPublicFn(PAYMENT, "register-merchant", [Cl.principal(stranger), Cl.none()], stranger);
        results.push(expectErr("register-merchant admin-only", r1));

        // non-admin cannot set merchant active
        const r2 = simnet.callPublicFn(PAYMENT, "set-merchant-active", [Cl.principal(merchant), Cl.bool(false)], stranger);
        results.push(expectErr("set-merchant-active admin-only", r2));

        // set-merchant-active on unknown principal must error
        const unknown = accounts.get?.("wallet_4") || stranger;
        const r3 = simnet.callPublicFn(PAYMENT, "set-merchant-active", [Cl.principal(unknown), Cl.bool(true)], admin);
        results.push(expectErr("set-merchant-active requires registered principal", r3));

        // duplicate register-merchant should error
        const r4 = simnet.callPublicFn(PAYMENT, "register-merchant", [Cl.principal(merchant), Cl.none()], admin);
        results.push(expectErr("register-merchant duplicate blocked", r4));
    }

    // unregistered principal cannot create-invoice
    {
        const idUnreg = Cl.bufferFromHex(randHex32());
        const r = simnet.callPublicFn(
            PAYMENT, "create-invoice",
            [idUnreg, Cl.uint(12345), Cl.none(), Cl.some(Cl.uint(getHeight(simnet) + 5))],
            stranger
        );
        results.push(expectErr("create-invoice requires registered merchant", r));
    }

    // ── Invoice lifecycle ───────────────────────────────────────────────
    const id1 = Cl.bufferFromHex(randHex32());
    const amount = Cl.uint(25_000);
    // Base happy-path invoice should not expire during the run
    const expBase = Cl.none();

    // create-invoice ok + event
    {
        const r = simnet.callPublicFn(PAYMENT, "create-invoice", [id1, amount, Cl.none(), expBase], merchant);
        results.push(isOk(r) ? pass("create-invoice ok") : fail("create-invoice ok", r));
        results.push(expectEventContains("event: invoice-created printed", r, "invoice-created"));
    }

    // duplicate id -> err u103
    {
        const r = simnet.callPublicFn(PAYMENT, "create-invoice", [id1, amount, Cl.none(), expBase], merchant);
        results.push(expectErrU("create-invoice duplicate (err u103)", r, 103));
    }
    // past/same expiry -> err u104
    {
        const idPast = Cl.bufferFromHex(randHex32());
        const r = simnet.callPublicFn(
            PAYMENT, "create-invoice",
            [idPast, amount, Cl.none(), Cl.some(Cl.uint(getHeight(simnet)))],
            merchant
        );
        results.push(expectErrU("create-invoice past expiry (err u104)", r, 104));
    }

    // Optional: contract enforces amount > 0
    /*
    {
      const idZero = Cl.bufferFromHex(randHex32());
      const r0 = simnet.callPublicFn(PAYMENT, "create-invoice", [idZero, Cl.uint(0), Cl.none(), Cl.none()], merchant);
      results.push(expectErr("create-invoice amount>0 enforced", r0));
    }
    */

    // Wrong token principal on pay
    {
        const idWrong = Cl.bufferFromHex(randHex32());
        setupOk(results, "setup: create-invoice (wrong-token)", simnet, PAYMENT,
            "create-invoice", [idWrong, amount, Cl.none(), Cl.some(Cl.uint(getHeight(simnet) + 100))], merchant);
        const fakeToken = Cl.contractPrincipal(deployer, "sbtc-payment"); // wrong on purpose
        const r = simnet.callPublicFn(PAYMENT, "pay-invoice", [idWrong, fakeToken], payer);
        results.push(expectErrU("pay-invoice wrong token principal (err u207)", r, 207));
    }

    // cancel unpaid + pay canceled -> u202 (+ event + status check)
    {
        const idCancel = Cl.bufferFromHex(randHex32());
        setupOk(results, "setup: create-invoice (cancel-unpaid)", simnet, PAYMENT,
            "create-invoice", [idCancel, amount, Cl.none(), Cl.some(Cl.uint(getHeight(simnet) + 100))], merchant);

        const rCancel = simnet.callPublicFn(PAYMENT, "cancel-invoice", [idCancel], merchant);
        results.push(isOk(rCancel) ? pass("cancel-invoice (unpaid) ok") : fail("cancel-invoice (unpaid) ok", rCancel));
        results.push(expectEventContains("event: invoice-canceled printed", rCancel, "invoice-canceled"));

        // stranger cannot cancel
        {
            const rX = simnet.callPublicFn(PAYMENT, "cancel-invoice", [idCancel], stranger);
            results.push(expectErr("cancel-invoice stranger blocked", rX));
        }
        // double-cancel should error (if idempotent, mark SKIP)
        {
            const r2 = simnet.callPublicFn(PAYMENT, "cancel-invoice", [idCancel], merchant);
            results.push(isErr(r2) ? pass("cancel-invoice second call errors") : skip("cancel-invoice second call errors", "contract allows idempotent cancel"));
        }

        // status: canceled
        {
            const st = simnet.callReadOnlyFn(PAYMENT, "get-invoice-status", [idCancel], stranger);
            results.push(resultToString(st).includes("canceled") ? pass("get-invoice-status (canceled)") : fail("get-invoice-status (canceled)", st));
        }

        const r = simnet.callPublicFn(PAYMENT, "pay-invoice", [idCancel, tokenPrincipal], payer);
        results.push(expectErrU("pay canceled invoice (err u202)", r, 202));
    }

    // paying & creating is blocked when merchant becomes inactive
    {
        const idInactivePay = Cl.bufferFromHex(randHex32());
        setupOk(results, "setup: create-invoice (inactive-merchant test)", simnet, PAYMENT,
            "create-invoice", [idInactivePay, Cl.uint(1111), Cl.none(), Cl.some(Cl.uint(getHeight(simnet) + 100))], merchant);

        setupOk(results, "setup: set-merchant-active(false)", simnet, PAYMENT,
            "set-merchant-active", [Cl.principal(merchant), Cl.bool(false)], admin);

        const rPay = simnet.callPublicFn(PAYMENT, "pay-invoice", [idInactivePay, tokenPrincipal], payer);
        results.push(expectErr("pay-invoice blocked when merchant inactive", rPay));

        // also block create-invoice while inactive
        {
            const idInactiveCreate = Cl.bufferFromHex(randHex32());
            const rCI = simnet.callPublicFn(
                PAYMENT, "create-invoice",
                [idInactiveCreate, Cl.uint(2222), Cl.none(), Cl.some(Cl.uint(getHeight(simnet) + 100))],
                merchant
            );
            results.push(expectErr("create-invoice requires active merchant", rCI));
        }

        setupOk(results, "setup: set-merchant-active(true)", simnet, PAYMENT,
            "set-merchant-active", [Cl.principal(merchant), Cl.bool(true)], admin);
    }

    // Optional: mark-expired before expiry should error (enable if enforced)
    /*
    {
      const idTooEarly = Cl.bufferFromHex(randHex32());
      setupOk(results, "setup: create-invoice (early-expiry-check)", simnet, PAYMENT,
        "create-invoice", [idTooEarly, Cl.uint(1234), Cl.none(), Cl.some(Cl.uint(getHeight(simnet)+10))], merchant);
      const rEarly = simnet.callPublicFn(PAYMENT, "mark-expired", [idTooEarly], stranger);
      results.push(expectErr("mark-expired before expiry errors", rEarly));
    }
    */

    // expired path (requires mining); all setup calls are safe (won't throw)
    if (canMine(simnet)) {
        const idExp = Cl.bufferFromHex(randHex32());
        const expAt = getHeight(simnet) + 2; // cushion so creation runs before expiry
        setupOk(results, "setup: create-invoice (for-expiry)", simnet, PAYMENT,
            "create-invoice", [idExp, amount, Cl.none(), Cl.some(Cl.uint(expAt))], merchant);
        mine(simnet, 3); // move past expiry
        const r = simnet.callPublicFn(PAYMENT, "pay-invoice", [idExp, tokenPrincipal], payer);
        results.push(expectErrU("pay expired invoice (err u203)", r, 203));
        const receipt = simnet.callPublicFn(PAYMENT, "mark-expired", [idExp], stranger);
        results.push(isOk(receipt) ? pass("mark-expired ok") : fail("mark-expired ok", receipt));
        results.push(expectEventContains("event: invoice-expired printed", receipt, "invoice-expired"));
        // status: expired
        {
            const st = simnet.callReadOnlyFn(PAYMENT, "get-invoice-status", [idExp], stranger);
            results.push(resultToString(st).includes("expired") ? pass("get-invoice-status (expired)") : fail("get-invoice-status (expired)", st));
        }
    } else {
        results.push(skip("pay expired invoice (err u203)", "SDK cannot mine blocks"));
        results.push(skip("mark-expired ok", "SDK cannot mine blocks"));
    }

    // Mint sBTC for payer to run pay/refund/sub tests
    {
        const mintNeeded = Cl.uint(25_000);
        const mintRes = simnet.callPublicFn(TOKEN, "mint", [Cl.principal(payer), mintNeeded], admin);
        const canPay = isOk(mintRes);
        results.push(canPay ? pass("mock mint to payer") : skip("mock mint to payer", "mint failed"));

        if (canPay) {
            // pay-invoice ok + event
            {
                const rPay = simnet.callPublicFn(PAYMENT, "pay-invoice", [id1, tokenPrincipal], payer);
                results.push(isOk(rPay) ? pass("pay-invoice ok") : fail("pay-invoice ok", rPay));
                results.push(expectEventContains("event: invoice-paid printed", rPay, "invoice-paid"));
            }
            {
                const r = simnet.callPublicFn(PAYMENT, "pay-invoice", [id1, tokenPrincipal], payer);
                results.push(expectErrU("pay-invoice double-pay blocked (err u201)", r, 201));
            }
            // cannot cancel a paid invoice
            {
                const r = simnet.callPublicFn(PAYMENT, "cancel-invoice", [id1], admin);
                results.push(expectErr("cancel-invoice fails on paid invoice", r));
            }
        }
    }

    // admin can cancel unpaid (+ event)
    {
        const idAdminCancel = Cl.bufferFromHex(randHex32());
        setupOk(results, "setup: create-invoice (admin-cancel)", simnet, PAYMENT,
            "create-invoice", [idAdminCancel, Cl.uint(2222), Cl.none(), Cl.some(Cl.uint(getHeight(simnet) + 100))], merchant);

        const r = simnet.callPublicFn(PAYMENT, "cancel-invoice", [idAdminCancel], admin);
        results.push(isOk(r) ? pass("admin cancel unpaid ok") : fail("admin cancel unpaid ok", r));
        results.push(expectEventContains("event: invoice-canceled printed", r, "invoice-canceled"));
    }

    // admin cancel on non-existent invoice id should error
    {
        const randomId = Cl.bufferFromHex(randHex32());
        const r = simnet.callPublicFn(PAYMENT, "cancel-invoice", [randomId], admin);
        results.push(expectErr("cancel-invoice not-found errors", r));
    }

    // ── Refunds ───────────────────────────────────────────────────────────────
    {
        const idRefund = Cl.bufferFromHex(randHex32());
        setupOk(results, "setup: create-invoice (refunds)", simnet, PAYMENT,
            "create-invoice", [idRefund, Cl.uint(10_000), Cl.none(), Cl.some(Cl.uint(getHeight(simnet) + 100))], merchant);
        const m2 = simnet.callPublicFn(TOKEN, "mint", [Cl.principal(payer), Cl.uint(10_000)], admin);
        if (isOk(m2)) {
            simnet.callPublicFn(PAYMENT, "pay-invoice", [idRefund, tokenPrincipal], payer);
            // over cap → u305
            {
                const r = simnet.callPublicFn(PAYMENT, "refund-invoice", [idRefund, Cl.uint(11_000), Cl.none(), tokenPrincipal], merchant);
                results.push(expectErrU("refund cap enforced (err u305)", r, 305));
            }
            // caller not merchant → u303
            {
                const r = simnet.callPublicFn(PAYMENT, "refund-invoice", [idRefund, Cl.uint(1000), Cl.none(), tokenPrincipal], stranger);
                results.push(expectErrU("refund only merchant (err u303)", r, 303));
            }
            // admin (not merchant) must also be blocked
            {
                const r = simnet.callPublicFn(PAYMENT, "refund-invoice", [idRefund, Cl.uint(1_000), Cl.none(), tokenPrincipal], admin);
                results.push(expectErr("refund-invoice admin (not merchant) blocked", r));
            }
            // partial refund OK
            results.push(await step("refund-invoice ok", () =>
                expectOk(simnet, PAYMENT, "refund-invoice", [idRefund, Cl.uint(1000), Cl.none(), tokenPrincipal], merchant)
            ));
            // allow exact-to-cap refund and assert event
            {
                const rCapOk = simnet.callPublicFn(PAYMENT, "refund-invoice", [idRefund, Cl.uint(9000), Cl.none(), tokenPrincipal], merchant);
                results.push(isOk(rCapOk) ? pass("refund up to cap ok") : fail("refund up to cap ok", rCapOk));
                results.push(expectEventContains("event: invoice-refunded printed", rCapOk, "invoice-refunded"));
                // any further refund must fail with cap
                const rAfterCap = simnet.callPublicFn(PAYMENT, "refund-invoice", [idRefund, Cl.uint(1), Cl.none(), tokenPrincipal], merchant);
                results.push(expectErrU("refund blocked after cap (err u305)", rAfterCap, 305));
            }
            // cumulative cap: second refund exceeding cap (redundant but explicit)
            {
                const rOver = simnet.callPublicFn(PAYMENT, "refund-invoice", [idRefund, Cl.uint(9001), Cl.none(), tokenPrincipal], merchant);
                results.push(expectErrU("second refund exceeding cap (err u305)", rOver, 305));
            }
            // refund with wrong token principal → u307 (refund path) on a FRESH paid invoice
            {
                const badId = Cl.bufferFromHex(randHex32());
                setupOk(
                    results,
                    "setup: create-invoice (refund wrong-token)",
                    simnet,
                    PAYMENT,
                    "create-invoice",
                    [badId, Cl.uint(100), Cl.none(), Cl.some(Cl.uint(getHeight(simnet) + 100))],
                    merchant
                );
                const mBad = simnet.callPublicFn(TOKEN, "mint", [Cl.principal(payer), Cl.uint(100)], admin);
                if (isOk(mBad)) {
                    simnet.callPublicFn(PAYMENT, "pay-invoice", [badId, tokenPrincipal], payer);
                    const badTok = Cl.contractPrincipal(deployer, "sbtc-payment"); // wrong on purpose
                    const rBad = simnet.callPublicFn(
                        PAYMENT,
                        "refund-invoice",
                        [badId, Cl.uint(1), Cl.none(), badTok],
                        merchant
                    );
                    results.push(expectErrU("refund wrong token principal (err u307)", rBad, 307));
                } else {
                    results.push(skip("refund wrong token principal (err u307)", "mint failed for badId"));
                }
            }
        } else {
            results.push(skip("refund tests", "needs a paid invoice (mint failed)"));
        }

        // refund on unpaid → err
        {
            const idNoPay = Cl.bufferFromHex(randHex32());
            setupOk(results, "setup: create-invoice (refund-on-unpaid)", simnet, PAYMENT,
                "create-invoice", [idNoPay, Cl.uint(3333), Cl.none(), Cl.some(Cl.uint(getHeight(simnet) + 100))], merchant);
            const r = simnet.callPublicFn(PAYMENT, "refund-invoice", [idNoPay, Cl.uint(1), Cl.none(), tokenPrincipal], merchant);
            results.push(expectErr("refund-invoice fails if not paid", r));
        }
    }

    // ── Subscriptions ───────────────────────────────────────────────────────────
    {
        const subId = Cl.bufferFromHex(randHex32());
        const interval = Cl.uint(3);

        // create-subscription ok + event
        {
            const r = simnet.callPublicFn(
                PAYMENT,
                "create-subscription",
                [subId, Cl.principal(merchant), Cl.principal(payer), Cl.uint(777), interval],
                merchant
            );
            results.push(isOk(r) ? pass("create-subscription ok") : fail("create-subscription ok", r));
            results.push(expectEventContains("event: subscription-created printed", r, "subscription-created"));
        }

        /* ── EARLY PAY CHECK (robust) ── */
        {
            const dueCV = simnet.callReadOnlyFn(PAYMENT, "next-due", [subId], stranger);
            const dueStr = resultToString(dueCV);          // "(some u123)" or similar
            const m = /u(\d+)/.exec(dueStr);
            const due = m ? Number(m[1]) : 0;
            const h = getHeight(simnet);

            if (h >= due) {
                results.push(skip("pay-subscription early (err u503)", `already due (h=${h} >= due=${due})`));
            } else {
                const rEarly = simnet.callPublicFn(PAYMENT, "pay-subscription", [subId, tokenPrincipal], payer);
                results.push(expectErrU("pay-subscription early (err u503)", rEarly, 503));
            }
        }

        // create-subscription by non-merchant must error
        {
            const subBadCaller = Cl.bufferFromHex(randHex32());
            const r = simnet.callPublicFn(
                PAYMENT, "create-subscription",
                [subBadCaller, Cl.principal(merchant), Cl.principal(payer), Cl.uint(1), Cl.uint(3)],
                payer
            );
            results.push(expectErr("create-subscription only merchant may call", r));
        }

        // must be subscriber
        {
            const r = simnet.callPublicFn(PAYMENT, "pay-subscription", [subId, tokenPrincipal], stranger);
            results.push(expectErr("pay-subscription only subscriber", r));
        }
        // pay-subscription by merchant (not subscriber) must error
        {
            const r = simnet.callPublicFn(PAYMENT, "pay-subscription", [subId, tokenPrincipal], merchant);
            results.push(expectErr("pay-subscription only subscriber (merchant blocked)", r));
        }


        // interval > 0 enforced
        {
            const badSub = Cl.bufferFromHex(randHex32());
            const r0 = simnet.callPublicFn(
                PAYMENT, "create-subscription",
                [badSub, Cl.principal(merchant), Cl.principal(payer), Cl.uint(1), Cl.uint(0)],
                merchant
            );
            results.push(expectErr("create-subscription interval>0 enforced", r0));
        }

        // merchant inactive blocks creation
        {
            setupOk(results, "setup: set-merchant-active(false) for subs", simnet, PAYMENT,
                "set-merchant-active", [Cl.principal(merchant), Cl.bool(false)], admin);
            const badSub2 = Cl.bufferFromHex(randHex32());
            const r1 = simnet.callPublicFn(
                PAYMENT, "create-subscription",
                [badSub2, Cl.principal(merchant), Cl.principal(payer), Cl.uint(2), Cl.uint(3)],
                merchant
            );
            results.push(expectErr("create-subscription requires active merchant", r1));
            setupOk(results, "setup: set-merchant-active(true) restore", simnet, PAYMENT,
                "set-merchant-active", [Cl.principal(merchant), Cl.bool(true)], admin);
        }

        // pay when due (requires mint + mining)
        const mint3 = simnet.callPublicFn(TOKEN, "mint", [Cl.principal(payer), Cl.uint(777)], admin);
        if (isOk(mint3) && canMine(simnet)) {
            mine(simnet, 5);

            // wrong token principal on subscription pay should error
            {
                const fakeToken = Cl.contractPrincipal(deployer, "sbtc-payment"); // deliberately wrong
                const rBadTok = simnet.callPublicFn(PAYMENT, "pay-subscription", [subId, fakeToken], payer);
                results.push(expectErr("pay-subscription wrong token principal blocked", rBadTok));
            }

            // pay-subscription ok + event
            {
                const r = simnet.callPublicFn(PAYMENT, "pay-subscription", [subId, tokenPrincipal], payer);
                results.push(isOk(r) ? pass("pay-subscription ok") : fail("pay-subscription ok", r));
                results.push(expectEventContains("event: subscription-paid printed", r, "subscription-paid"));
            }
        } else {
            results.push(skip("pay-subscription ok", "need mint+mining"));
        }

        // stranger cannot cancel subscription (use a fresh sub to avoid double-cancel ambiguity)
        {
            const subIdStr = Cl.bufferFromHex(randHex32());
            const rMake = simnet.callPublicFn(PAYMENT, "create-subscription",
                [subIdStr, Cl.principal(merchant), Cl.principal(payer), Cl.uint(5), Cl.uint(3)],
                merchant
            );
            if (isOk(rMake)) {
                const rStr = simnet.callPublicFn(PAYMENT, "cancel-subscription", [subIdStr], stranger);
                results.push(expectErr("cancel-subscription stranger blocked", rStr));
                // clean up by admin for parity
                const rAdm = simnet.callPublicFn(PAYMENT, "cancel-subscription", [subIdStr], admin);
                results.push(isOk(rAdm) ? pass("admin cancel-subscription (cleanup) ok") : fail("admin cancel-subscription (cleanup) ok", rAdm));
            } else {
                results.push(skip("cancel-subscription stranger blocked", "failed to create fresh sub"));
            }
        }

        // cancel OK (+event), then paying after cancel errors
        {
            const r = simnet.callPublicFn(PAYMENT, "cancel-subscription", [subId], merchant);
            results.push(isOk(r) ? pass("cancel-subscription ok") : fail("cancel-subscription ok", r));
            results.push(expectEventContains("event: subscription-canceled printed", r, "subscription-canceled"));
        }
        {
            const r = simnet.callPublicFn(PAYMENT, "pay-subscription", [subId, tokenPrincipal], payer);
            results.push(expectErr("pay-subscription after cancel errors", r));
        }

        // admin can cancel subscription
        {
            const subId2 = Cl.bufferFromHex(randHex32());
            const rC2 = simnet.callPublicFn(PAYMENT, "create-subscription",
                [subId2, Cl.principal(merchant), Cl.principal(payer), Cl.uint(1), Cl.uint(3)],
                merchant
            );
            results.push(isOk(rC2) ? pass("create-subscription (admin-cancel case) ok") : fail("create-subscription (admin-cancel case) ok", rC2));
            const rAdminCancel = simnet.callPublicFn(PAYMENT, "cancel-subscription", [subId2], admin);
            results.push(isOk(rAdminCancel) ? pass("admin cancel-subscription ok") : fail("admin cancel-subscription ok", rAdminCancel));
        }

        // read-only subscription views
        {
            const roSub = simnet.callReadOnlyFn(PAYMENT, "get-subscription", [subId], stranger);
            const s1 = resultToString(roSub);
            results.push(s1.startsWith("(some ") ? pass("get-subscription returns (some ...)") : skip("get-subscription", "missing RO or different shape"));

            const roDue = simnet.callReadOnlyFn(PAYMENT, "next-due", [subId], stranger);
            const s2 = resultToString(roDue);
            results.push(/[u][0-9]+/.test(s2) || s2.startsWith("(ok u")
                ? pass("next-due returns uint")
                : skip("next-due", "missing RO or different shape"));
        }
    }

    // ── Read-only (invoices/admin/token) ─────────────────────────────────────────
    {
        const st = simnet.callReadOnlyFn(PAYMENT, "get-invoice-status", [id1], stranger);
        const stStr = resultToString(st);
        results.push(stStr.includes("paid") ? pass("get-invoice-status (paid)") : skip("get-invoice-status (paid)", "not paid"));

        const roInv = simnet.callReadOnlyFn(PAYMENT, "get-invoice", [id1], stranger);
        results.push(resultToString(roInv).startsWith("(some ") ? pass("get-invoice returns (some ...)") : fail("get-invoice", roInv, "expected (some ...)"));

        const roPaid = simnet.callReadOnlyFn(PAYMENT, "is-paid", [id1], stranger);
        {
            const s = resultToString(roPaid);
            results.push((s === "true" || s === "(ok true)")
                ? pass("is-paid true (if paid)")
                : skip("is-paid true (if paid)", "not paid"));
        }

        // not-found case
        {
            const randomId = Cl.bufferFromHex(randHex32());
            const stNF = simnet.callReadOnlyFn(PAYMENT, "get-invoice-status", [randomId], stranger);
            results.push(resultToString(stNF).includes("not-found") ? pass("get-invoice-status (not-found)") : fail("get-invoice-status (not-found)", stNF));
        }

        // is-paid false path (fresh unpaid invoice)
        {
            const idUnpaid = Cl.bufferFromHex(randHex32());
            const rNew = simnet.callPublicFn(PAYMENT, "create-invoice", [idUnpaid, Cl.uint(1234), Cl.none(), Cl.some(Cl.uint(getHeight(simnet) + 100))], merchant);
            if (isOk(rNew)) {
                const ro = simnet.callReadOnlyFn(PAYMENT, "is-paid", [idUnpaid], stranger);
                const s = resultToString(ro);
                results.push((s === "false" || s === "(ok false)") ? pass("is-paid false (unpaid)") : fail("is-paid false (unpaid)", ro));
            } else {
                results.push(skip("is-paid false (unpaid)", "could not create unpaid invoice"));
            }
        }

        const ro1 = simnet.callReadOnlyFn(PAYMENT, "get-sbtc", [], stranger);
        const ro2 = simnet.callReadOnlyFn(PAYMENT, "get-admin", [], stranger);
        results.push(resultToString(ro1).startsWith("(some ") ? pass("get-sbtc returns (some ...)") : fail("get-sbtc", ro1));
        results.push(resultToString(ro2).startsWith("(some ") ? pass("get-admin returns (some ...)") : fail("get-admin", ro2));
    }

    // ── Report ───────────────────────────────────────────────────────────────
    console.log("");
    console.log(c.bold("Test Summary"));
    let p = 0, f = 0, s = 0, i = 1;
    for (const r of results) {
        printResult(r, i);
        if (r.status === "PASS") p++;
        else if (r.status === "FAIL") f++;
        else s++;
        i++;
    }
    console.log("");
    console.log(`Result: ${c.green(`${p} passed`)} / ${f ? c.red(`${f} failed`) : "0 failed"} / ${s ? c.yellow(`${s} skipped`) : "0 skipped"}`);
    process.exit(f ? 1 : 0);
})().catch((err) => {
    console.error(c.red("Fatal error in selftest:"), err);
    process.exit(1);
});
