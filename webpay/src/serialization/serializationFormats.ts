/**
 * Serialization format utilities and type definitions for WEBPAY.
 * Handles (de)serialization of MagicLinkU blobs (base64url-encoded JSON),
 * Invoice DTOs, and PublicProfile DTOs, as per static contracts.
 */

// --- Utility: base64url encoding/decoding (RFC 7515) ---
function base64urlEncode(str: string): string {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(b64url: string): string {
  let b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  return Buffer.from(b64, 'base64').toString('utf8');
}

// --- MagicLinkU blob (base64url-encoded JSON, canonical) ---

type FtPostCondition = {
  type: 'ft-postcondition';
  address: string;
  asset: string;
  condition: 'eq';
  amount: string;
};

type UnsignedCall = {
  contractId: string;
  function: string;
  args: string[];
  postConditions: FtPostCondition[];
  postConditionMode: 'deny';
  network: 'mainnet' | 'testnet';
};

type MagicLinkU = {
  v: 1;
  storeId: string;
  invoiceId?: string;
  subscriptionId?: string;
  unsignedCall: UnsignedCall;
  exp: number;
  sig: string;
};

/**
 * Canonical JSON stringify with sorted keys (deterministic, for HMAC)
 */
function canonicalJSONStringify(obj: any): string {
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJSONStringify).join(',') + ']';
  } else if (obj && typeof obj === 'object' && obj !== null) {
    const keys = Object.keys(obj).sort();
    return (
      '{' +
      keys
        .map((k) => JSON.stringify(k) + ':' + canonicalJSONStringify(obj[k]))
        .join(',') +
      '}'
    );
  } else {
    return JSON.stringify(obj);
  }
}

/**
 * Serialize a MagicLinkU object to base64url-encoded canonical JSON.
 */
function serializeMagicLinkU(uObj: MagicLinkU): string {
  const canonicalJson = canonicalJSONStringify(uObj);
  return base64urlEncode(canonicalJson);
}

/**
 * Deserialize a base64url-encoded MagicLinkU string to MagicLinkU object.
 */
function deserializeMagicLinkU(uBlob: string): MagicLinkU {
  const json = base64urlDecode(uBlob);
  return JSON.parse(json);
}

// --- Invoice DTO (strict JSON) ---

type InvoiceStoreBranding = {
  displayName: string | null;
  logoUrl: string | null;
  brandColor: string | null;
};

type Invoice = {
  invoiceId: string;
  idHex: string;
  storeId: string;
  amountSats: number;
  usdAtCreate: string;
  quoteExpiresAt: string;
  merchantPrincipal: string;
  memo: string;
  status: 'unpaid' | 'pending' | 'paid' | 'expired' | 'canceled' | 'PAY_READY';
  payer?: string;
  txId?: string;
  subscriptionId?: string;
  createdAt: string;
  refundAmount?: number;
  refundTxId?: string;
  store: InvoiceStoreBranding;
};

/**
 * Serialize an Invoice DTO to JSON string.
 */
function serializeInvoiceDto(invoice: Invoice): string {
  return JSON.stringify(invoice);
}

/**
 * Deserialize a JSON string into an Invoice DTO.
 */
function deserializeInvoiceDto(json: string): Invoice {
  return JSON.parse(json);
}

// --- PublicProfile DTO (strict JSON) ---

type PublicProfile = {
  displayName: string | null;
  logoUrl: string | null;
  brandColor: string | null;
  supportEmail: string | null;
  supportUrl: string | null;
};

/**
 * Serialize PublicProfile DTO to JSON string.
 */
function serializePublicProfile(profile: PublicProfile): string {
  return JSON.stringify(profile);
}

/**
 * Deserialize JSON string into PublicProfile DTO.
 */
function deserializePublicProfile(json: string): PublicProfile {
  return JSON.parse(json);
}

export {
  serializeMagicLinkU,
  deserializeMagicLinkU,
  serializeInvoiceDto,
  deserializeInvoiceDto,
  serializePublicProfile,
  deserializePublicProfile
};
