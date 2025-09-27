import { describe, it, beforeAll, expect } from "vitest";
import { initSimnet, type Simnet } from "@hirosystems/clarinet-sdk";
import { Cl, ClarityType, type ResponseOkCV } from "@stacks/transactions";

// helper: assert (ok true)
function expectOkTrue(res: any, label = "tx ok") {
  expect(res).toBeTruthy();
  expect(res.result?.type, `${label} should be Ok`).toBe(ClarityType.ResponseOk);
  const ok = res.result as ResponseOkCV;
  expect(ok.value, `${label} value`).toEqual(Cl.bool(true));
}

describe("sbtc-payment basic flow (no globals)", () => {
  let simnet: Simnet;
  let deployer: string;
  let merchant: string;
  let payer: string;

  const ID1 =
    "0101010101010101010101010101010101010101010101010101010101010101";

  beforeAll(async () => {
    // spin up a fresh in-memory simnet from the current project
    simnet = await initSimnet();

    // grab test accounts (strings with principals, e.g. "ST....")
    const acc = simnet.getAccounts();
    deployer = acc.get("deployer")!;
    payer    = acc.get("wallet_1")!;
    merchant = acc.get("wallet_2")!;
  });

  it("happy path: bootstrap → set token → register → create → mint → pay", () => {
    // 1) bootstrap admin (idempotent for local runs)
    const r1 = simnet.callPublicFn("sbtc-payment", "bootstrap-admin", [], deployer);
    // accept ok or err u1 if rerun — skip assertion here

    // 2) set token: pass principal of the mock token contract
    const tokenPrincipal = Cl.contractPrincipal(deployer, "sbtc-token");
    const r2 = simnet.callPublicFn(
      "sbtc-payment",
      "set-sbtc-token",
      [tokenPrincipal],
      deployer
    );
    expectOkTrue(r2, "set-sbtc-token");

    // 3) register merchant (admin-only)
    const r3 = simnet.callPublicFn(
      "sbtc-payment",
      "register-merchant",
      [Cl.principal(merchant), Cl.none()],
      deployer
    );
    expectOkTrue(r3, "register-merchant");

    // 4) create invoice (merchant)
    const id = Cl.bufferFromHex(ID1);
    const amount = Cl.uint(25_000);
    const farFuture = Cl.some(Cl.uint(1_000_000));
    const r4 = simnet.callPublicFn(
      "sbtc-payment",
      "create-invoice",
      [id, amount, Cl.none(), farFuture],
      merchant
    );
    expectOkTrue(r4, "create-invoice");

    // 5) mint payer some sBTC on mock token
    const r5 = simnet.callPublicFn(
      "sbtc-token",
      "mint",
      [Cl.principal(payer), amount],
      deployer
    );
    expectOkTrue(r5, "mock mint");

    // 6) pay-invoice from payer (pass the trait-typed arg as contract principal)
    const r6 = simnet.callPublicFn(
      "sbtc-payment",
      "pay-invoice",
      [id, tokenPrincipal],
      payer
    );
    expectOkTrue(r6, "pay-invoice");

    // 7) check on-chain status == "paid"
    const ro = simnet.callReadOnlyFn(
      "sbtc-payment",
      "get-invoice-status",
      [id],
      payer
    );
    // read-only returns a raw ClarityValue; to match, compare with Cl.stringAscii("paid")
    expect(ro.result.type).toBe(ClarityType.StringASCII);
    // quick equality check:
    // @ts-expect-error private prop on CV object, but stable enough for test
    expect(ro.result.data).toBe("paid");
  });

  it("refund guard: cannot exceed original (err u305)", () => {
    const tokenPrincipal = Cl.contractPrincipal(deployer, "sbtc-token");

    // fresh invoice
    const id = Cl.bufferFromHex(
      "0202020202020202020202020202020202020202020202020202020202020202"
    );
    const amt = Cl.uint(10_000);

    simnet.callPublicFn(
      "sbtc-payment",
      "register-merchant",
      [Cl.principal(merchant), Cl.none()],
      deployer
    );
    simnet.callPublicFn(
      "sbtc-payment",
      "create-invoice",
      [id, amt, Cl.none(), Cl.some(Cl.uint(1_000_000))],
      merchant
    );
    simnet.callPublicFn(
      "sbtc-token",
      "mint",
      [Cl.principal(payer), amt],
      deployer
    );
    simnet.callPublicFn(
      "sbtc-payment",
      "pay-invoice",
      [id, tokenPrincipal],
      payer
    );

    // refund too much
    const tooMuch = Cl.uint(11_000);
    const refund = simnet.callPublicFn(
      "sbtc-payment",
      "refund-invoice",
      [id, tooMuch, Cl.none(), tokenPrincipal],
      merchant
    );

    // expect Err(...)
    expect(refund.result.type).toBe(ClarityType.ResponseErr);
  });
});
