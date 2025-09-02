// src/delegates/AdditionalControllerUsagesOfAdminParamGuard.ts
import { AdminParamGuard } from '../delegates/AdminParamGuard';

export class AdditionalControllerUsagesOfAdminParamGuard {
  private readonly guard = new AdminParamGuard();

  validateSetSbtcTokenBody(body: {
    contractAddress?: string;
    contractName?: string;
  }): { contractAddress: string; contractName: string } {
    const contractAddress = String(body.contractAddress ?? '');
    const contractName = String(body.contractName ?? '');
    this.guard.assertStacksPrincipal(contractAddress);
    if (!contractName) {
      throw new TypeError('Invalid contractName');
    }
    return { contractAddress, contractName };
  }

  validateActivateStoreParams(
    storeId: string,
    body: { active?: unknown },
  ): { storeId: string; active: boolean } {
    this.guard.assertUuid(storeId);
    const active = !!body.active;
    return { storeId, active };
  }

  validateCancelInvoiceParams(invoiceId: string): { invoiceId: string } {
    this.guard.assertUuid(invoiceId);
    return { invoiceId };
  }
}
