export class SecretFieldOmitter {
  private static readonly OMIT_LIST = [
    'apiKey',
    'hmacSecret',
    'adminPassword',
    'sessionToken',
    'jwt',
    'adminSecret'
  ];
  private static readonly UNSIGNED_CALL_WHITELIST = [
    'contractId',
    'function',
    'args',
    'postConditions',
    'postConditionMode',
    'network'
  ];

  /**
   * Removes all secret or non-whitelisted fields from the provided props.
   * @param props The raw props object intended for SSR or hydration.
   * @returns A new object with secrets omitted and nested whitelisting applied.
   */
  public omitSecretsFromProps(props: Record<string, any>): Record<string, any> {
    const filtered: Record<string, any> = {};
    for (const key of Object.keys(props)) {
      if (SecretFieldOmitter.OMIT_LIST.includes(key)) continue;

      if (key === 'unsignedCall' && typeof props[key] === 'object' && props[key]) {
        const uc = props[key];
        filtered[key] = {};
        for (const allowedField of SecretFieldOmitter.UNSIGNED_CALL_WHITELIST) {
          if (Object.prototype.hasOwnProperty.call(uc, allowedField)) {
            filtered[key][allowedField] = uc[allowedField];
          }
        }
        continue;
      }
      filtered[key] = props[key];
    }
    return filtered;
  }
}
