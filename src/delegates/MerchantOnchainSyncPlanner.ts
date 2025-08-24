// src/delegates/MerchantOnchainSyncPlanner.ts
import type { ISqliteStore } from '/src/contracts/dao';
import type { IStacksChainClient, IContractCallBuilder } from '/src/contracts/interfaces';
import type { UnsignedContractCall } from '/src/contracts/domain';

export class MerchantOnchainSyncPlanner {
  async planForStore(
    store: ISqliteStore,
    chain: IStacksChainClient,
    builder: IContractCallBuilder,
    storeId: string
  ): Promise<{ notFound: true } | { calls: UnsignedContractCall[] }> {
    const merchant = store.listMerchantsProjection().find((m: any) => m.id === storeId);
    if (!merchant) return { notFound: true };

    const principal: string = merchant.principal;
    const isRegistered: boolean = await (chain as any).isMerchantRegisteredOnChain(principal);

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

    return { calls };
  }
}
