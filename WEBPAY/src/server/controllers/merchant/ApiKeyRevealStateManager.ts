export class ApiKeyRevealStateManager {
  /**
   * Manages display/masking of API keys and HMAC secrets for one-time reveal.
   * Controls and updates session flag `apiKeysRevealed`.
   * Returns the data object for SSR rendering (with real or masked secrets).
   *
   * @param req Express request object (with session)
   * @param branding Branding object for SSR context
   * @param apiKey Optional: new API Key for one-time display (from rotate-keys POST)
   * @param hmacSecret Optional: new HMAC Secret for one-time display
   * @returns Object with { apiKey, hmacSecret, branding }, ready for SSR render
   */
  handleApiKeysRevealAndMask(
    req: any,
    branding: any,
    apiKey?: string,
    hmacSecret?: string
  ): { apiKey: string; hmacSecret: string; branding: any } {
    if (apiKey && hmacSecret) {
      (req.session as any).apiKeysRevealed = true;
      return { apiKey, hmacSecret, branding };
    }
    if ((req.session as any).apiKeysRevealed) {
      (req.session as any).apiKeysRevealed = false;
      return { apiKey: '********', hmacSecret: '********', branding };
    }
    return { apiKey: '********', hmacSecret: '********', branding };
  }
}
