// Stamps a per-build id into the service worker's cache name so the browser
// detects a byte change on every deploy and installs the new worker. Runs
// before `next build` (see package.json). Idempotent — safe to run repeatedly.
import { readFileSync, writeFileSync } from "node:fs";

const swPath = new URL("../public/sw.js", import.meta.url);

// Prefer the git commit sha (stable per commit); fall back to a timestamp so a
// redeploy of the same commit still busts the cache.
const id =
  (process.env.RAILWAY_GIT_COMMIT_SHA || process.env.VERCEL_GIT_COMMIT_SHA || "")
    .slice(0, 12)
    .replace(/[^a-z0-9]/gi, "") || String(Date.now());

const src = readFileSync(swPath, "utf8");
const next = src.replace(/const CACHE = "[^"]*";/, `const CACHE = "amatri-${id}";`);

if (next === src) {
  console.warn("[stamp-sw] cache line not found — service worker not stamped");
} else {
  writeFileSync(swPath, next);
  console.log(`[stamp-sw] service worker cache → amatri-${id}`);
}
