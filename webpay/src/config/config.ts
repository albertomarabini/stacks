/**
 * WEBPAY Config Module
 *
 * Loads and validates environment variables for configuration.
 * Exports a config object.
 *
 * .env template:
 * SENDER_DOMAIN=webpay.com
 * POSTMARK_API_KEY=<string>
 * WEBPAY_BASE_URL=https://example.webpay.com
 * BRIDGE_API_BASE_URL=https://bridge.webpay.com
 * # Per-store (created after rotate-keys, one-time reveal only):
 * # STORE_<STOREID>_API_KEY=<string>
 * # STORE_<STOREID>_HMAC_SECRET=<string>
 */

import * as dotenv from 'dotenv';

dotenv.config();

type StoreSecrets = {
  apiKey: string;
  hmacSecret: string;
};

// Utility: Load all STORE_<STOREID>_API_KEY and STORE_<STOREID>_HMAC_SECRET envs
function loadStoreSecrets(env: NodeJS.ProcessEnv): Record<string, StoreSecrets> {
  const storeSecrets: Record<string, StoreSecrets> = {};
  for (const key of Object.keys(env)) {
    const apiKeyMatch = key.match(/^STORE_([A-Za-z0-9\-_]+)_API_KEY$/);
    if (apiKeyMatch) {
      const storeId = apiKeyMatch[1];
      const apiKey = env[key]!;
      const hmacKey = `STORE_${storeId}_HMAC_SECRET`;
      const hmacSecret = env[hmacKey];
      if (hmacSecret) {
        storeSecrets[storeId] = {
          apiKey,
          hmacSecret,
        };
      }
    }
  }
  return storeSecrets;
}

const config = {
  /**
   * Email sender domain (e.g. webpay.com)
   */
  SENDER_DOMAIN: process.env.SENDER_DOMAIN!,
  /**
   * Postmark API key for sending transactional emails
   */
  POSTMARK_API_KEY: process.env.POSTMARK_API_KEY!,
  /**
   * Webpay public base URL
   */
  WEBPAY_BASE_URL: process.env.WEBPAY_BASE_URL!,
  /**
   * Bridge API private base URL
   */
  BRIDGE_API_BASE_URL: process.env.BRIDGE_API_BASE_URL!,
  /**
   * Per-store API keys and HMAC secrets, populated from env as STORE_<STOREID>_API_KEY/STORE_<STOREID>_HMAC_SECRET
   */
  STORE_SECRETS: loadStoreSecrets(process.env)
};

// Configuration schema for documentation/reference:
/*
.env template:
SENDER_DOMAIN=webpay.com
POSTMARK_API_KEY=<string>
WEBPAY_BASE_URL=https://example.webpay.com
BRIDGE_API_BASE_URL=https://bridge.webpay.com
# Per-store (created after rotate-keys, one-time reveal only):
# STORE_<STOREID>_API_KEY=<string>
# STORE_<STOREID>_HMAC_SECRET=<string>
*/

export { config };
