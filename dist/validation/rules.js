"use strict";
// Validation & Constraint Definitions; Error Handling & Fault Tolerance enums/types
Object.defineProperty(exports, "__esModule", { value: true });
exports.Validation = void 0;
exports.Validation = {
    idHex64: /^[0-9A-Fa-f]{64}$/,
    url: /^(https?):\/\/[^\s]+$/i,
    colorHex: /^#[0-9A-Fa-f]{6}$/,
    uuid: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/,
    stacksPrincipal: /^S[^\s]{10,}$/,
    // Rules
    createInvoice: {
        amount_sats: 'integer > 0',
        ttl_seconds: 'integer > 0',
        memoMaxUtf8Bytes: 34,
        webhook_url: 'optional URL',
    },
    refund: {
        invoice_id: 'uuid',
        amount_sats: 'integer > 0',
        memoMaxUtf8Bytes: 34,
        cap: 'refund_amount + request ≤ amount_sats',
    },
    subscription: {
        subscriber: 'stacks principal',
        amount_sats: 'integer > 0',
        interval_blocks: 'integer > 0',
        mode: ['invoice', 'direct'],
    },
    publicCreateTxGate: [
        'invoice exists',
        'merchant active',
        'status not in [paid,canceled,expired]',
        'TTL not expired',
        'on-chain status not expired',
        'id_hex valid 64-hex',
        'sBTC token configured',
    ],
    storeProfileUpdate: {
        brand_color: 'optional color hex #RRGGBB',
        allowed_origins: 'CSV string',
    },
};
//# sourceMappingURL=rules.js.map