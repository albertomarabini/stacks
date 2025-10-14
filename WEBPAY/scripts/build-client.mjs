// scripts/build-client.mjs
import * as esbuild from "esbuild";
import fs from "fs";
import path from "path";

const islandsDir = "src/client/islands";
const outJs = "public/static/js";
const outCss = "public/static/css";

fs.mkdirSync(outJs, { recursive: true });
fs.mkdirSync(outCss, { recursive: true });
const cssStub = path.join(outCss, "app.css");
if (!fs.existsSync(cssStub)) fs.writeFileSync(cssStub, "/* stub */\n");

function getEntries(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const walk = d => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (p.endsWith(".ts") || p.endsWith(".tsx")) out.push(p);
    }
  };
  walk(dir);
  // sort for stable comparison
  out.sort();
  return out;
}

let files = getEntries(islandsDir);
if (files.length === 0) {
  console.log("[islands] no TS/TSX files found in", islandsDir);
  process.exit(0);
}

const baseOptions = {
  entryPoints: files,
  outdir: outJs,
  entryNames: "[name]",          // predictable: Foo.ts -> /static/js/Foo.js
  format: "esm",
  bundle: true,
  sourcemap: true,
  target: "es2020",
  loader: { ".ts": "ts", ".tsx": "tsx" },
  logLevel: "info",
  plugins: [
    {
      name: "log-after-build",
      setup(build) {
        build.onEnd((result) => {
          if (result.errors?.length) {
            console.error("[islands] ❌ build errors:", result.errors);
          } else {
            console.log("[islands] ✅ build succeeded", new Date().toLocaleTimeString());
          }
        });
      }
    }
  ]
};

async function createCtx(entries) {
  return esbuild.context({ ...baseOptions, entryPoints: entries });
}

async function watchMode() {
  let ctx = await createCtx(files);
  await ctx.watch();
  console.log("[islands] watching... entries:", files.length);

  // watch filesystem for new/deleted islands and refresh context
  let cooldown;
  const triggerRefresh = () => {
    clearTimeout(cooldown);
    cooldown = setTimeout(async () => {
      const next = getEntries(islandsDir);
      const changed =
        next.length !== files.length ||
        next.some((p, i) => p !== files[i]);
      if (changed) {
        files = next;
        console.log("[islands] entryPoints changed →", files.length, "files");
        await ctx.dispose();
        ctx = await createCtx(files);
        await ctx.watch();
        console.log("[islands] watcher refreshed");
      }
    }, 150);
  };

  // recursive file watching
  fs.watch(islandsDir, { recursive: true }, triggerRefresh);

  await new Promise(() => {}); // keep process alive
}

async function buildOnce() {
  await esbuild.build(baseOptions);
  console.log("[islands] build complete");
}

if (process.argv.includes("--watch")) {
  watchMode();
} else {
  buildOnce();
}
