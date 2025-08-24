// tests/sbtc_payment_test.ts

// 🔧 If this version 404s on your machine, change to v1.7.0 or v1.8.0 and re-run.
// e.g. "https://deno.land/x/clarinet@v1.8.0/index.ts" or "@v1.7.0"
// ⬇️ use the version you have installed (3.5.0 per your note)
import {
    Clarinet,
    Tx,
    Chain,
    Account,
    types,
    assertEquals,
    assertTrue,
    assertFalse,
  } from "npm:@hirosystems/clarinet-sdk@3.5.0";


  /* ---------- local helpers (Deno-safe) ---------- */
  const te = new TextEncoder();
  const toBytes = (s: string) => te.encode(s);
  function hexToBytes(hex: string): Uint8Array {
    const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
    if (clean.length % 2 !== 0) throw new Error("hex length must be even");
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < clean.length; i += 2) {
      out[i / 2] = parseInt(clean.slice(i, i + 2), 16);
    }
    return out;
  }

  const CONTRACT = "sbtc-payment";
  const TOKEN = "mock-sbtc-token";

  Clarinet.test({
    name: "admin bootstrap + set token + register merchant",
    async fn(chain: Chain, accounts: Map<string, Account>) {
      const admin = accounts.get("deployer")!;
      const merchant = accounts.get("wallet_1")!;

      // bootstrap admin
      let block = chain.mineBlock([
        Tx.contractCall(CONTRACT, "bootstrap-admin", [], admin.address),
      ]);
      block.receipts[0].result.expectOk().expectBool(true);

      // set token
      block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT,
          "set-sbtc-token",
          [types.contractPrincipal(admin.address, TOKEN)],
          admin.address
        ),
      ]);
      block.receipts[0].result.expectOk().expectBool(true);

      // register merchant
      block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT,
          "register-merchant",
          [types.principal(merchant.address), types.none()],
          admin.address
        ),
      ]);
      block.receipts[0].result.expectOk().expectBool(true);
    },
  });

  Clarinet.test({
    name: "create-invoice → pay-invoice emits event and marks paid",
    async fn(chain: Chain, accounts: Map<string, Account>) {
      const admin = accounts.get("deployer")!;
      const merchant = accounts.get("wallet_1")!;
      const payer = accounts.get("wallet_2")!;
      const id = "0x" + "11".repeat(32);
      const amount = 25_000;

      // Setup admin, token, merchant
      chain.mineBlock([
        Tx.contractCall(CONTRACT, "bootstrap-admin", [], admin.address),
        Tx.contractCall(
          CONTRACT,
          "set-sbtc-token",
          [types.contractPrincipal(admin.address, TOKEN)],
          admin.address
        ),
        Tx.contractCall(
          CONTRACT,
          "register-merchant",
          [types.principal(merchant.address), types.some(types.buff(toBytes("Shop")))],
          admin.address
        ),
      ]);

      // Mint sBTC to payer
      chain.mineBlock([
        Tx.contractCall(
          TOKEN,
          "mint",
          [types.principal(payer.address), types.uint(amount)],
          admin.address
        ),
      ]);

      // Create invoice
      let block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT,
          "create-invoice",
          [types.buff(hexToBytes(id)), types.uint(amount), types.none(), types.none()],
          merchant.address
        ),
      ]);
      block.receipts[0].result.expectOk().expectBool(true);

      // Pay invoice
      block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT,
          "pay-invoice",
          [types.buff(hexToBytes(id))],
          payer.address
        ),
      ]);
      block.receipts[0].result.expectOk().expectBool(true);

      // Check event
      const ev = block.receipts[0].events.find(
        (e: any) => e.type === "contract_event",
      );
      assertTrue(!!ev);

      // Status getter
      const status = chain.callReadOnlyFn(
        CONTRACT,
        "get-invoice-status",
        [types.buff(hexToBytes(id))],
        payer.address
      );
      status.result.expectAscii("paid");
    },
  });

  Clarinet.test({
    name: "cannot pay: duplicate, canceled, expired, or inactive merchant",
    async fn(chain: Chain, accounts: Map<string, Account>) {
      const admin = accounts.get("deployer")!;
      const merchant = accounts.get("wallet_1")!;
      const payer = accounts.get("wallet_2")!;
      const id1 = "0x" + "22".repeat(32);
      const id2 = "0x" + "23".repeat(32);
      const amount = 7_000;

      chain.mineBlock([
        Tx.contractCall(CONTRACT, "bootstrap-admin", [], admin.address),
        Tx.contractCall(
          CONTRACT,
          "set-sbtc-token",
          [types.contractPrincipal(admin.address, TOKEN)],
          admin.address
        ),
        Tx.contractCall(
          CONTRACT,
          "register-merchant",
          [types.principal(merchant.address), types.none()],
          admin.address
        ),
        Tx.contractCall(
          TOKEN,
          "mint",
          [types.principal(payer.address), types.uint(100_000)],
          admin.address
        ),
      ]);

      // Duplicate ID check
      chain.mineBlock([
        Tx.contractCall(
          CONTRACT,
          "create-invoice",
          [types.buff(hexToBytes(id1)), types.uint(amount), types.none(), types.none()],
          merchant.address
        ),
      ]);
      let block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT,
          "create-invoice",
          [types.buff(hexToBytes(id1)), types.uint(amount), types.none(), types.none()],
          merchant.address
        ),
      ]);
      block.receipts[0].result.expectErr().expectUint(103);

      // Cancel then try to pay
      chain.mineBlock([
        Tx.contractCall(
          CONTRACT,
          "cancel-invoice",
          [types.buff(hexToBytes(id1))],
          merchant.address
        ),
      ]);
      block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT,
          "pay-invoice",
          [types.buff(hexToBytes(id1))],
          payer.address
        ),
      ]);
      block.receipts[0].result.expectErr().expectUint(202); // canceled

      // Expired invoice
      const currentHeight = chain.blockHeight;
      const expAt = currentHeight + 1;
      chain.mineBlock([
        Tx.contractCall(
          CONTRACT,
          "create-invoice",
          [types.buff(hexToBytes(id2)), types.uint(amount), types.none(), types.some(types.uint(expAt))],
          merchant.address
        ),
      ]);
      chain.mineEmptyBlock(2); // advance beyond expiry
      block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT,
          "pay-invoice",
          [types.buff(hexToBytes(id2))],
          payer.address
        ),
      ]);
      block.receipts[0].result.expectErr().expectUint(203);

      // Merchant inactive => cannot pay
      const id3 = "0x" + "24".repeat(32);
      chain.mineBlock([
        Tx.contractCall(
          CONTRACT,
          "create-invoice",
          [types.buff(hexToBytes(id3)), types.uint(amount), types.none(), types.none()],
          merchant.address
        ),
        Tx.contractCall(
          CONTRACT,
          "set-merchant-active",
          [types.principal(merchant.address), types.bool(false)],
          admin.address
        ),
      ]);
      block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT,
          "pay-invoice",
          [types.buff(hexToBytes(id3))],
          payer.address
        ),
      ]);
      block.receipts[0].result.expectErr().expectUint(205);
    },
  });

  Clarinet.test({
    name: "refunds: partial, cumulative cap, and auth",
    async fn(chain: Chain, accounts: Map<string, Account>) {
      const admin = accounts.get("deployer")!;
      const merchant = accounts.get("wallet_1")!;
      const payer = accounts.get("wallet_2")!;
      const id = "0x" + "33".repeat(32);
      const amount = 50_000;

      chain.mineBlock([
        Tx.contractCall(CONTRACT, "bootstrap-admin", [], admin.address),
        Tx.contractCall(
          CONTRACT,
          "set-sbtc-token",
          [types.contractPrincipal(admin.address, TOKEN)],
          admin.address
        ),
        Tx.contractCall(
          CONTRACT,
          "register-merchant",
          [types.principal(merchant.address), types.none()],
          admin.address
        ),
        Tx.contractCall(
          TOKEN,
          "mint",
          [types.principal(payer.address), types.uint(amount)],
          admin.address
        ),
        Tx.contractCall(
          CONTRACT,
          "create-invoice",
          [types.buff(hexToBytes(id)), types.uint(amount), types.none(), types.none()],
          merchant.address
        ),
        Tx.contractCall(
          CONTRACT,
          "pay-invoice",
          [types.buff(hexToBytes(id))],
          payer.address
        ),
      ]);

      // Partial refund ok
      let block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT,
          "refund-invoice",
          [types.buff(hexToBytes(id)), types.uint(10_000), types.none()],
          merchant.address
        ),
      ]);
      block.receipts[0].result.expectOk().expectBool(true);

      // Over cap (remaining 40_000)
      block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT,
          "refund-invoice",
          [types.buff(hexToBytes(id)), types.uint(50_000), types.none()],
          merchant.address
        ),
      ]);
      block.receipts[0].result.expectErr().expectUint(305);

      // Unauthorized: payer cannot refund
      block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT,
          "refund-invoice",
          [types.buff(hexToBytes(id)), types.uint(1_000), types.none()],
          payer.address
        ),
      ]);
      block.receipts[0].result.expectErr().expectUint(303);
    },
  });

  Clarinet.test({
    name: "subscriptions: create, pay (due), inactive merchant blocked, cancel",
    async fn(chain: Chain, accounts: Map<string, Account>) {
      const admin = accounts.get("deployer")!;
      const merchant = accounts.get("wallet_1")!;
      const subscriber = accounts.get("wallet_3")!;
      const id = "0x" + "44".repeat(32);

      // bootstrap + set token + register + fund subscriber
      chain.mineBlock([
        Tx.contractCall(CONTRACT, "bootstrap-admin", [], admin.address),
        Tx.contractCall(
          CONTRACT,
          "set-sbtc-token",
          [types.contractPrincipal(admin.address, TOKEN)],
          admin.address
        ),
        Tx.contractCall(
          CONTRACT,
          "register-merchant",
          [types.principal(merchant.address), types.none()],
          admin.address
        ),
        Tx.contractCall(
          TOKEN,
          "mint",
          [types.principal(subscriber.address), types.uint(100_000)],
          admin.address
        ),
      ]);

      // Create sub (interval 2 blocks)
      let block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT,
          "create-subscription",
          [
            types.buff(hexToBytes(id)),
            types.principal(merchant.address),
            types.principal(subscriber.address),
            types.uint(12_345),
            types.uint(2),
          ],
          merchant.address
        ),
      ]);
      block.receipts[0].result.expectOk().expectBool(true);

      // Too early
      block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT,
          "pay-subscription",
          [types.buff(hexToBytes(id))],
          subscriber.address
        ),
      ]);
      block.receipts[0].result.expectErr().expectUint(503);

      // Reach due height
      chain.mineEmptyBlock(2);

      // Pay ok
      block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT,
          "pay-subscription",
          [types.buff(hexToBytes(id))],
          subscriber.address
        ),
      ]);
      block.receipts[0].result.expectOk().expectBool(true);

      // Deactivate merchant → next payment blocked
      chain.mineBlock([
        Tx.contractCall(
          CONTRACT,
          "set-merchant-active",
          [types.principal(merchant.address), types.bool(false)],
          admin.address
        ),
      ]);
      chain.mineEmptyBlock(2);
      block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT,
          "pay-subscription",
          [types.buff(hexToBytes(id))],
          subscriber.address
        ),
      ]);
      block.receipts[0].result.expectErr().expectUint(505);

      // Cancel sub (admin)
      block = chain.mineBlock([
        Tx.contractCall(
          CONTRACT,
          "cancel-subscription",
          [types.buff(hexToBytes(id))],
          admin.address
        ),
      ]);
      block.receipts[0].result.expectOk().expectBool(true);
    },
  });
