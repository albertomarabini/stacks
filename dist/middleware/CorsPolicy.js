"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CorsPolicy = void 0;
/**
 * Public CORS policy
 * - Enforced ONLY for customer-facing routes:
 *   • GET  /i/:invoiceId
 *   • POST /create-tx
 *   • GET  /api/v1/stores/:storeId/public-profile
 *
 * Goals:
 * 1) Server-to-server (no Origin) must always pass (admin/merchant APIs, curl, Node fetch).
 * 2) Browser requests are allowed IFF their Origin is in the store’s allowed_origins CSV.
 * 3) OPTIONS preflights for public routes must pass (even when /create-tx has no query/body yet).
 * 4) If applied globally by mistake, non-public paths will:
 *    - allow if no Origin (server-to-server), or
 *    - reject when an Origin is present (browser) to avoid leaking CORS on private/admin APIs.
 *
 * Notes:
 * - This class only provides the `origin` validator. Use with `cors({ origin })`.
 * - Use `CorsPolicy.ALLOWED_HEADERS` in your CORS config for Access-Control-Allow-Headers.
 */
class CorsPolicy {
    bindStore(store) {
        this.store = store;
    }
    /**
     * Origin validator compatible with `cors` package. We accept an extra `req` param
     * by wrapping this method in your middleware factory (capture `req` via closure).
     *
     * Example usage:
     *   const origin = (o: string | undefined, cb: any) =>
     *     policy.publicCorsOriginValidator(o, cb, req);
     *   app.use('/i/:invoiceId', cors({ origin }));
     */
    publicCorsOriginValidator(origin, cb, req) {
        // (1) Server-to-server (no CORS): allow pass-through
        if (!origin) {
            cb(null, true);
            return;
        }
        // Normalize browser-provided Origin and path
        const normOrigin = this.normalizeOrigin(origin);
        const path = req.path;
        const isPublicInvoice = /^\/i\/[^/]+$/.test(path);
        const isPublicCreateTx = path === '/create-tx';
        const isPublicStoreProfile = /^\/api\/v1\/stores\/[^/]+\/public-profile$/.test(path);
        // (2) If not a public route: allow server-to-server (handled above), block browsers here.
        if (!isPublicInvoice && !isPublicCreateTx && !isPublicStoreProfile) {
            cb(new Error('Not allowed'), false);
            return;
        }
        // (3) OPTIONS preflight for public routes: only allow if Origin is allow-listed.
        if (req.method === 'OPTIONS') {
            const allowedCsv = this.lookupAllowedOriginsCsv(req, {
                isPublicInvoice,
                isPublicCreateTx,
                isPublicStoreProfile,
                origin: normOrigin,
            });
            // no allow-list found → deny, but do NOT throw
            if (!allowedCsv) {
                cb(null, false);
                return;
            }
            const allowlist = this.parseAllowlist(allowedCsv);
            const ok = allowlist.has(normOrigin);
            // allow if in list; otherwise deny quietly (no error throw)
            cb(null, ok);
            return;
        }
        // (4) Resolve store.allowed_origins for the route
        const allowedCsv = this.lookupAllowedOriginsCsv(req, {
            isPublicInvoice,
            isPublicCreateTx,
            isPublicStoreProfile,
            origin: normOrigin,
        });
        if (!allowedCsv) {
            cb(null, false);
            return;
        }
        const allowlist = this.parseAllowlist(allowedCsv);
        const ok = allowlist.has(normOrigin);
        if (ok) {
            cb(null, true);
            return;
        }
        cb(null, false);
    }
    // ───────────────────────────── helpers ─────────────────────────────
    normalizeOrigin(o) {
        // Lowercase and strip trailing slash to match CSV entries consistently
        try {
            const u = new URL(o);
            // Keep scheme + host + optional port (the canonical Origin form)
            const origin = `${u.protocol}//${u.host}`.toLowerCase();
            return origin.endsWith('/') ? origin.slice(0, -1) : origin;
        }
        catch {
            const s = (o || '').toLowerCase();
            return s.endsWith('/') ? s.slice(0, -1) : s;
        }
    }
    parseAllowlist(csv) {
        const out = new Set();
        for (const raw of csv.split(',')) {
            const s = raw.trim();
            if (!s)
                continue;
            // Accept either full origin ("https://app.example.com") or with trailing slash
            const norm = this.normalizeOrigin(s);
            out.add(norm);
        }
        return out;
    }
    /**
     * Attempts to fetch the per-store allowed_origins CSV for the current request.
     * For /create-tx when we cannot extract an invoiceId (e.g., early CORS phase),
     * we fall back to: allow if the Origin appears in *any* store's allowlist.
     */
    lookupAllowedOriginsCsv(req, flags) {
        if (flags.isPublicInvoice) {
            const invoiceId = req.params?.invoiceId;
            if (!invoiceId)
                return undefined;
            const row = this.store.getInvoiceWithStore(invoiceId);
            return row?.store?.allowed_origins;
        }
        if (flags.isPublicStoreProfile) {
            const storeId = req.params?.storeId;
            const rows = this.store.listMerchantsProjection() || [];
            // 1) Try direct store match first
            if (storeId) {
                const m = rows.find(r => r?.id === storeId);
                if (m?.allowed_origins)
                    return m.allowed_origins;
            }
            // 2) Fallback: allow if Origin is present in any store's allowlist
            const origin = String(flags.origin || '');
            for (const r of rows) {
                const csv = (r?.allowed_origins ?? '');
                if (!csv)
                    continue;
                const set = this.parseAllowlist(csv);
                if (set.has(origin))
                    return csv;
            }
            return undefined;
        }
        // /create-tx
        if (flags.isPublicCreateTx) {
            // Best-effort invoiceId read from query (body likely not parsed here).
            const qInvoiceId = req.query?.invoiceId;
            if (qInvoiceId) {
                const row = this.store.getInvoiceWithStore(qInvoiceId);
                return row?.store?.allowed_origins;
            }
            // Fallback (safe): allow only if this Origin is configured for any store.
            // This keeps /create-tx usable from known merchant frontends during preflight/early phases
            // without opening it to arbitrary sites.
            const rows = this.store.listMerchantsProjection() || [];
            for (const r of rows) {
                const csv = r?.allowed_origins;
                if (!csv)
                    continue;
                const set = this.parseAllowlist(csv);
                if (set.has(flags.origin))
                    return csv;
            }
            return undefined;
        }
        return undefined;
    }
}
exports.CorsPolicy = CorsPolicy;
CorsPolicy.ALLOWED_HEADERS = 'Content-Type,X-API-Key,X-Webhook-Timestamp,X-Webhook-Signature';
//# sourceMappingURL=CorsPolicy.js.map