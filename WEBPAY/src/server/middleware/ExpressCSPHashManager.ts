import crypto from "crypto";
import express from "express";

type DirMap = Map<string, Set<string>>;

function parseCsp(header?: string | number | string[] | undefined): DirMap {
  const map: DirMap = new Map();
  if (!header) return map;
  const h = Array.isArray(header) ? header.join("; ") : String(header);
  for (const raw of h.split(";")) {
    const dir = raw.trim();
    if (!dir) continue;
    const [k, ...vals] = dir.split(/\s+/);
    const key = k.toLowerCase();
    const set = map.get(key) ?? new Set<string>();
    vals.forEach(v => v && set.add(v));
    map.set(key, set);
  }
  return map;
}

function serializeCsp(map: DirMap): string {
  return Array.from(map.entries())
    .map(([k, vals]) => `${k} ${Array.from(vals).join(" ")}`.trim())
    .join("; ");
}

function ensure(map: DirMap, dir: string, ...vals: string[]) {
  const key = dir.toLowerCase();
  const set = map.get(key) ?? new Set<string>();
  vals.forEach(v => set.add(v));
  map.set(key, set);
}

export class ExpressCSPHashManager {
  static middleware(): express.RequestHandler {
    return (req, res, next) => {
      const originalRender = res.render.bind(res);

      // type-compatible wrapper: assign via `as any`, and treat cb as `any`
      const patchedRender: typeof res.render = function (
        view: string,
        optionsOrCb?: any,
        cbMaybe?: any
      ): void {
        let options = optionsOrCb;
        let cb = cbMaybe;

        // overload normalization
        if (typeof optionsOrCb === "function") {
          cb = optionsOrCb;
          options = {};
        }

        // use a loosely-typed callback to avoid the strict `(err: Error)` constraint
        originalRender(view, options, (err: any, html: any) => {
          if (err) {
            if (typeof cb === "function") return cb(err);
            return next(err);
          }
          if (typeof html !== "string") {
            if (typeof cb === "function") return cb(undefined as any, html);
            return res.send(html);
          }

          // collect inline <script> blocks (no src=)
          const scriptBlocks: string[] = [];
          const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
          for (let m; (m = re.exec(html)) !== null; ) {
            const code = (m[1] || "").trim();
            if (code) scriptBlocks.push(code);
          }

          // compute sha256 hashes
          const hashes = scriptBlocks.map(code =>
            `'sha256-${crypto.createHash("sha256").update(code, "utf8").digest("base64")}'`
          );

          // merge with existing CSP (from Helmet)
          const existing = res.getHeader("Content-Security-Policy");
          const map = parseCsp(existing);

          if (map.size === 0) {
            // fallback if Helmet wasn't installed earlier
            ensure(map, "default-src", "'self'");
            ensure(map, "script-src", "'self'");
            ensure(map, "style-src", "'self'", "'unsafe-inline'");
            ensure(map, "img-src", "'self'", "data:", "blob:", "https:");
            ensure(map, "connect-src", "'self'");
          }

          // always keep self
          ensure(map, "script-src", "'self'");

          // add hashes (no need for 'unsafe-inline' on script-src if you hash)
          if (hashes.length) ensure(map, "script-src", ...hashes);

          // write merged header (preserves style-src, etc.)
          const merged = serializeCsp(map);
          res.setHeader("Content-Security-Policy", merged);

          // send HTML; if user provided a callback, call it with `undefined` (not null)
          res.send(html);
          if (typeof cb === "function") cb(undefined as any, html);
        });
      };

      (res as any).render = patchedRender;
      next();
    };
  }
}
