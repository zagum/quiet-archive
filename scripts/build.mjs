import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
await build({
  entryPoints: [
    "src/background.ts",
    "src/popup.ts",
    "src/archive.ts",
    "src/guard.ts",
  ],
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome119",
  legalComments: "none",
  minify: false,
});
console.log("Built dist/ — load this directory in chrome://extensions");
