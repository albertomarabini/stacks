// src/delegates/MerchantOnchainSyncPlanner.ts
import type { ISqliteStore } from '../contracts/dao';
import type { IStacksChainClient, IContractCallBuilder } from '../contracts/interfaces';
import type { UnsignedContractCall } from '../contracts/domain';

export class MerchantOnchainSyncPlanner {
  async planForStore(
    store: ISqliteStore,
    chain: IStacksChainClient,
    builder: IContractCallBuilder,
    storeId: string
  ): Promise<{ notFound: true } | { calls: UnsignedContractCall[] }> {
    // Resolve merchant row (projection has enough fields for principal/active/name)
    const merchant = store.listMerchantsProjection().find((m: any) => m.id === storeId);
    if (!merchant) return { notFound: true };

    const principal: string = merchant.principal;

    // Determine if the merchant is already registered on-chain
    const isRegistered: boolean = await (chain as any).isMerchantRegisteredOnChain(principal);

    // We will accumulate calls in the correct dependency order:
    // 1) register-merchant (if missing)
    // 2) set-merchant-active (mirror current DB flag)
    // 3) create-invoice for any unpaid DTOs that are not yet on-chain (best-effort)
    const calls: UnsignedContractCall[] = [];

    if (!isRegistered) {
      calls.push(
        builder.buildRegisterMerchant({
          merchant: principal,
          name: merchant.name ?? undefined,
        }),
      );
    }

    calls.push(
      builder.buildSetMerchantActive({
        merchant: principal,
        active: !!merchant.active,
      }),
    );

    // Best-effort: propose create-invoice for every unpaid DTO of this store.
    // We intentionally omit expiresAtBlock (builder handles undefined).
    try {
      const unpaid = store.listInvoicesByStore(storeId, {
        status: 'unpaid',
        orderByCreatedDesc: false,
      }) as any[];

      for (const inv of unpaid) {
        // Defensive checks (shape may vary across DAO versions)
        const idHex: string | undefined = inv?.id_hex;
        const amountSats: number | undefined = inv?.amount_sats;
        if (!idHex || typeof amountSats !== 'number' || amountSats <= 0) continue;

        calls.push(
          builder.buildCreateInvoice({
            idHex,
            amountSats,
            memo: inv?.memo ?? undefined,
            // expiresAtBlock intentionally omitted; builder accepts undefined
          }),
        );
      }
    } catch {
      // If DAO shape lacks listInvoicesByStore, just skip invoice mirroring.
    }

    return { calls };
  }
}
