// /frontend/admin-console/wallet/AdminContractCallSequencer.ts

export class AdminContractCallSequencer {
  static async runSequential(
    calls: any[],
    openContractCall: (call: any) => Promise<void>,
  ): Promise<void> {
    for (const call of calls) {
      await openContractCall(call);
    }
  }

  static async runSingle(
    call: any,
    openContractCall: (call: any) => Promise<void>,
  ): Promise<void> {
    await openContractCall(call);
  }
}
