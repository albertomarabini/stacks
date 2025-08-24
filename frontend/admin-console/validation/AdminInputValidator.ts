export class AdminInputValidator {
  static assertUuid(value: string, label: string = 'id'): string {
    const ok =
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(
        value,
      );
    if (!ok) {
      throw new TypeError(`Invalid ${label}`);
    }
    return value;
  }

  static assertStacksAddress(value: string, label: string = 'principal'): string {
    if (typeof value !== 'string' || value.length < 2 || !value.startsWith('S')) {
      throw new TypeError(`Invalid ${label}`);
    }
    return value;
  }

  static assertContractPrincipalPair(
    contractAddress: string,
    contractName: string,
  ): { contractAddress: string; contractName: string } {
    this.assertStacksAddress(contractAddress, 'contractAddress');
    if (!contractName || typeof contractName !== 'string') {
      throw new TypeError('Invalid contractName');
    }
    return { contractAddress, contractName };
  }
}
