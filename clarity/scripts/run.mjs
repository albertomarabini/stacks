#!/usr/bin/env node
/* Small launcher that:
 * - picks network from argv[2] or STACKS_NETWORK
 * - loads .env + .env.<network> (if present)
 * - sets STACKS_NETWORK explicitly
 * - hands off to scripts/quick-sim.mjs (your main test)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve repo root
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

// 1) Decide network
const argNet = (process.argv[2] || "").toLowerCase();
const envNet = (process.env.STACKS_NETWORK || "").toLowerCase();
const NETWORK = ["simnet", "devnet", "testnet"].includes(argNet)
  ? argNet
  : (["simnet", "devnet", "testnet"].includes(envNet) ? envNet : "simnet");

// 2) Load .env files (optional, non-fatal)
function loadDotenv(file) {
  const fp = path.join(ROOT, file);
  if (fs.existsSync(fp)) {
    const content = fs.readFileSync(fp, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}
loadDotenv(".env");
loadDotenv(`.env.${NETWORK}`);

// 3) Force the resolved network in env
process.env.STACKS_NETWORK = NETWORK;

// (Optional) Friendly banner
console.log(`[run.mjs] Using STACKS_NETWORK=${NETWORK}`);

// 4) Hand off to your test runner (the file you pasted earlier)
await import(path.join(ROOT, "scripts", "quick-devnet.mjs"));
