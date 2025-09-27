/**
 * Validation rule constants/objects for:
 * - Checkout POST
 * - Magic-link U blob
 * - Store Key Rotation
 * - Refund POST
 * - Subscription creation POST
 * - Branding/public-profile PATCH
 * - Email rendering
 */

// 1. Checkout POST /checkout/:storeId
const checkoutValidationRules = {
  amount_sats: { type: 'number', minimum: 1, required: true },
  ttl_seconds: { type: 'number', minimum: 120, maximum: 1800, required: true },
  memo: { type: 'string', required: true },
  orderId: { type: 'string', required: false },
  payerPrincipal: {
    type: 'string',
    required: false,
    pattern: '^SP[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{38,}$'
  }
};

// 2. Magic-link U blob validation (server and client)
const magicLinkValidationRules = {
  u: { required: true, type: 'base64url-encoded JSON' },
  'u.v': { type: 'number', value: 1, required: true },
  'u.storeId': { type: 'string', required: true, mustMatch: 'req.params.storeId' },
  'u.invoiceId': { type: 'string', requiredIf: 'invoice flow', mustMatch: 'req.params.invoiceId' },
  'u.subscriptionId': { type: 'string', requiredIf: 'subscription flow', mustMatch: 'req.params.subscriptionId' },
  'u.unsignedCall': {
    type: 'object',
    required: true,
    function: { type: 'string', required: true, enum: ['pay-invoice', 'pay-subscription'] },
    postConditionMode: { type: 'string', required: true, value: 'deny' },
    postConditions: {
      type: 'array',
      minItems: 1,
      contains: {
        type: 'object',
        typeField: 'ft-postcondition',
        asset: { type: 'string', required: true, mustMatch: '<SBTC_CONTRACT>::sbtc' },
        condition: { type: 'string', value: 'eq' },
        amount: { type: 'string', required: true }
      }
    },
    network: { type: 'string', required: true, enum: ['mainnet', 'testnet'], mustMatch: 'deployment' }
  },
  'u.exp': { type: 'number', required: true, minimum: 'now', maximum: 'now+300' },
  'u.sig': { type: 'string', required: true },
  signature: { mustValidate: true }
};

// 3. Store Key Rotation
const keyRotationValidationRules = {
  apiKey: { type: 'string', required: true },
  hmacSecret: { type: 'string', required: true },
  oneTimeReveal: { enforced: true }
};

// 4. Refund POST
const refundValidationRules = {
  invoiceId: { type: 'string', required: true },
  amount_sats: { type: 'number', minimum: 1, required: true },
  memo: { type: 'string', required: true }
};

// 5. Subscription creation POST
const subscriptionCreateValidationRules = {
  subscriberPrincipal: {
    type: 'string',
    required: true,
    pattern: '^SP[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{38,}$'
  },
  amountSats: { type: 'number', minimum: 1, required: true },
  intervalBlocks: { type: 'number', minimum: 1, required: true }
};

// 6. Branding/public-profile PATCH
const brandingPatchValidationRules = {
  displayName: { type: 'string', required: false },
  logoUrl: { type: 'string', format: 'uri', required: false },
  brandColor: { type: 'string', pattern: '^#[0-9A-Fa-f]{6}$', required: false },
  allowedOrigins: { type: 'array', items: { type: 'string', format: 'uri' }, required: false },
  webhookUrl: { type: 'string', format: 'uri', required: false }
};

// 7. Email rendering
const emailRenderingValidationRules = {
  branding: {
    displayName: { type: 'string', required: false, nullable: true },
    logoUrl: { type: 'string', required: false, nullable: true },
    brandColor: { type: 'string', required: false, nullable: true },
    supportEmail: { type: 'string', required: false, nullable: true },
    supportUrl: { type: 'string', required: false, nullable: true }
  }
};

export {
  checkoutValidationRules,
  magicLinkValidationRules,
  keyRotationValidationRules,
  refundValidationRules,
  subscriptionCreateValidationRules,
  brandingPatchValidationRules,
  emailRenderingValidationRules
};
