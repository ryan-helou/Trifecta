#!/usr/bin/env node
/**
 * Publish a self-hosted OTA bundle.
 *
 *   npm run ota
 *
 * Builds the Path-B static export, zips it, drops it in ota-bundles/ with a
 * manifest, and prunes old bundles. Then commit + push: /api/ota/bundle serves the
 * zip and /api/ota hands it to devices. No Capgo, no subscription, no
 * third party in the update path.
 *
 * The version comes from package.json and MUST outrank the native App Store build,
 * or the endpoint (correctly) refuses to serve it — see lib/otaServer.ts.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// NOT public/: `next build` copies public/ into the static export, so a zip parked
// there would be packed inside the next release's bundle, and that one inside the
// release after it — every release carrying every previous release. Served instead
// by /api/ota/bundle/[version].
const OTA_DIR = path.join(REPO, "ota-bundles");
const KEEP = 3; // current + two rollback targets; older zips are dead weight in git

const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8"));
const version = pkg.version;
const comment = process.argv.slice(2).join(" ").trim() || undefined;

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: REPO, stdio: "inherit", ...opts });

// --- 0. refuse to publish a version that already exists ---------------------
// Re-publishing a version under the same number would leave devices that already
// took it stuck on the OLD contents forever (they compare by version, not hash).
mkdirSync(OTA_DIR, { recursive: true });
const zipName = `${version}.zip`;
const zipPath = path.join(OTA_DIR, zipName);
if (existsSync(zipPath)) {
  console.error(`\n!! ota-bundles/${zipName} already exists.`);
  console.error("   Bump \"version\" in package.json — devices key off the version, so");
  console.error("   reusing one means anybody who already has it never sees the change.\n");
  process.exit(1);
}

// --- 1. build the bundle ----------------------------------------------------
console.log(`==> building static export for ${version}`);
run("npm", ["run", "build:static"], { env: { ...process.env, CAP_PATH_B: "1" } });

const OUT = path.join(REPO, "out");
if (!existsSync(path.join(OUT, "index.html"))) {
  console.error("!! out/index.html is missing — the updater requires index.html at the bundle root.");
  process.exit(1);
}

// --- 2. zip it --------------------------------------------------------------
// `zip -r . ` from inside out/ so paths are relative to the bundle root, which is
// what the plugin expects when it unpacks. -X drops extra attrs; -q keeps it quiet.
console.log("==> zipping");
run("zip", ["-rXq", zipPath, "."], { cwd: OUT });

const buf = readFileSync(zipPath);
const sha256 = createHash("sha256").update(buf).digest("hex");
const size = statSync(zipPath).size;

// --- 3. manifest ------------------------------------------------------------
const manifestPath = path.join(OTA_DIR, "manifest.json");
let manifest = { latest: null, bundles: [] };
if (existsSync(manifestPath)) manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

manifest.bundles = manifest.bundles.filter((b) => b.version !== version);
manifest.bundles.push({
  version,
  sha256,
  size,
  createdAtISO: new Date().toISOString(),
  ...(comment ? { comment } : {}),
});
manifest.bundles.sort((a, b) => {
  const pa = a.version.split(".").map(Number);
  const pb = b.version.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
});

// --- 4. prune ---------------------------------------------------------------
const keep = manifest.bundles.slice(-KEEP);
const dropped = manifest.bundles.slice(0, -KEEP);
for (const b of dropped) {
  const p = path.join(OTA_DIR, `${b.version}.zip`);
  if (existsSync(p)) {
    rmSync(p);
    console.log(`    pruned ${b.version}`);
  }
}
manifest.bundles = keep;
manifest.latest = keep[keep.length - 1].version;

writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

// tidy any orphan zips (a failed run, a hand-deleted manifest entry)
const known = new Set(manifest.bundles.map((b) => `${b.version}.zip`));
for (const f of readdirSync(OTA_DIR)) {
  if (f.endsWith(".zip") && !known.has(f)) {
    rmSync(path.join(OTA_DIR, f));
    console.log(`    removed orphan ${f}`);
  }
}

console.log(`\n==> published ${version}`);
console.log(`    ${(size / 1024 / 1024).toFixed(2)} MB · sha256 ${sha256.slice(0, 16)}…`);
console.log(`    manifest latest → ${manifest.latest} (keeping ${manifest.bundles.map((b) => b.version).join(", ")})`);
console.log(`\n    Commit and push to go live:`);
console.log(`      git add ota-bundles && git commit -m "chore(ota): publish ${version}" && git push\n`);
