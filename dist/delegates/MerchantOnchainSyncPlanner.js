"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MerchantOnchainSyncPlanner = void 0;
class MerchantOnchainSyncPlanner {
    async planForStore(store, chain, builder, storeId) {
        // Resolve merchant row (projection has enough fields for principal/active/name)
        const merchant = store.listMerchantsProjection().find((m) => m.id === storeId);
        if (!merchant)
            return { notFound: true };
        const principal = merchant.principal;
        // Determine if the merchant is already registered on-chain
        const isRegistered = await chain.isMerchantRegisteredOnChain(principal);
        // We will accumulate calls in the correct dependency order:
        // 1) register-merchant (if missing)
        // 2) set-merchant-active (mirror current DB flag)
        // 3) create-invoice for any unpaid DTOs that are not yet on-chain (best-effort)
        const calls = [];
        if (!isRegistered) {
            calls.push(builder.buildRegisterMerchant({
                merchant: principal,
                name: merchant.name ?? undefined,
            }));
        }
        calls.push(builder.buildSetMerchantActive({
            merchant: principal,
            active: !!merchant.active,
        }));
        // Best-effort: propose create-invoice for every unpaid DTO of this store.
        // We intentionally omit expiresAtBlock (builder handles undefined).
        try {
            const unpaid = store.listInvoicesByStore(storeId, {
                status: 'unpaid',
                orderByCreatedDesc: false,
            });
            for (const inv of unpaid) {
                // Defensive checks (shape may vary across DAO versions)
                const idHex = inv?.id_hex;
                const amountSats = inv?.amount_sats;
                if (!idHex || typeof amountSats !== 'number' || amountSats <= 0)
                    continue;
                calls.push(builder.buildCreateInvoice({
                    idHex,
                    amountSats,
                    memo: inv?.memo ?? undefined,
                    // expiresAtBlock intentionally omitted; builder accepts undefined
                }));
            }
        }
        catch {
            // If DAO shape lacks listInvoicesByStore, just skip invoice mirroring.
        }
        return { calls };
    }
}
exports.MerchantOnchainSyncPlanner = MerchantOnchainSyncPlanner;
//# sourceMappingURL=MerchantOnchainSyncPlanner.js.map