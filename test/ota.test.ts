/**
 * Self-hosted OTA decision tests.
 *
 * The updater plugin does NOT compare versions itself on the auto-update path — it
 * asks this server and obeys. So every safety rule lives in `decideUpdate`, and a
 * mistake here is not a cosmetic bug: it can downgrade every device on the next
 * launch, or loop them re-downloading the same bundle forever.
 *
 * Run: `npm test`.
 */
import { compareVersions, decideUpdate, type OtaManifest } from "../lib/otaServer";

let checks = 0;
let failures = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error("  ✗ " + msg);
  }
}
function section(name: string) {
  console.log("\n• " + name);
}

const ORIGIN = "https://amatri-production.up.railway.app";

const manifest = (latest: string | null, versions: string[]): OtaManifest => ({
  latest,
  bundles: versions.map((v) => ({
    version: v,
    sha256: "a".repeat(64),
    size: 1000,
    createdAtISO: "2026-08-05T00:00:00.000Z",
  })),
});

const M = manifest("1.0.2", ["1.0.1", "1.0.2"]);

// ---------------------------------------------------------------------------
section("compareVersions");
{
  ok(compareVersions("1.0.2", "1.0.1") > 0, "1.0.2 > 1.0.1");
  ok(compareVersions("1.0.1", "1.0.2") < 0, "1.0.1 < 1.0.2");
  ok(compareVersions("1.0.1", "1.0.1") === 0, "equal versions compare 0");
  ok(compareVersions("1.10.0", "1.9.0") > 0, "1.10.0 > 1.9.0 (numeric, not lexical)");
  ok(compareVersions("2.0", "1.9.9") > 0, "2.0 > 1.9.9 with unequal part counts");
  ok(compareVersions("1.0", "1.0.0") === 0, "1.0 == 1.0.0");
  ok(compareVersions("", "0.0.0") === 0, "garbage sorts as zero rather than throwing");
}

// ---------------------------------------------------------------------------
section("the normal case: a device behind the latest bundle");
{
  const r = decideUpdate({ platform: "ios", version_build: "1.0.1", version_name: "builtin" }, M, ORIGIN);
  ok("url" in r && r.version === "1.0.2", `serves 1.0.2 — got ${JSON.stringify(r)}`);
  ok("url" in r && r.url === `${ORIGIN}/api/ota/bundle/1.0.2`, "URL is absolute (a relative one fails URL(string:) natively)");
  ok("url" in r && r.checksum.length === 64, "a checksum rides along");
}

// ---------------------------------------------------------------------------
section("never re-serve what the device is already running");
{
  // Without this the plugin re-downloads the same zip on every single launch.
  const r = decideUpdate({ platform: "ios", version_build: "1.0.1", version_name: "1.0.2" }, M, ORIGIN);
  ok("kind" in r && r.kind === "up_to_date", `already on 1.0.2 → up_to_date, got ${JSON.stringify(r)}`);

  const ahead = decideUpdate({ platform: "ios", version_build: "1.0.1", version_name: "1.0.5" }, M, ORIGIN);
  ok("kind" in ahead && ahead.kind === "up_to_date", "a device ahead of the manifest is left alone");
}

// ---------------------------------------------------------------------------
section("NEVER downgrade a device that just took an App Store update");
{
  // The worst thing this endpoint can do. Native 1.1.0 ships newer web assets than
  // bundle 1.0.2; serving 1.0.2 would roll the athlete backwards.
  const fresh = decideUpdate({ platform: "ios", version_build: "1.1.0", version_name: "builtin" }, M, ORIGIN);
  ok("kind" in fresh && fresh.kind === "up_to_date", `native newer, on builtin → no update, got ${JSON.stringify(fresh)}`);

  // ...and a device still RUNNING the stale bundle must be sent back to builtin,
  // or it keeps showing pre-update code forever after a store release.
  const stale = decideUpdate({ platform: "ios", version_build: "1.1.0", version_name: "1.0.2" }, M, ORIGIN);
  ok("version" in stale && stale.version === "builtin", `stale bundle + newer native → builtin, got ${JSON.stringify(stale)}`);

  // equal native and bundle is not an update either
  const equal = decideUpdate({ platform: "ios", version_build: "1.0.2", version_name: "builtin" }, M, ORIGIN);
  ok("kind" in equal && equal.kind === "up_to_date", "native == latest bundle → nothing to do");
}

// ---------------------------------------------------------------------------
section("degenerate inputs never produce an update");
{
  const empty = decideUpdate({ platform: "ios", version_build: "1.0.1", version_name: "builtin" }, manifest(null, []), ORIGIN);
  ok("kind" in empty && empty.kind === "up_to_date", "an empty manifest serves nothing");

  const dangling = decideUpdate(
    { platform: "ios", version_build: "1.0.1", version_name: "builtin" },
    { latest: "9.9.9", bundles: [] },
    ORIGIN,
  );
  ok("kind" in dangling && dangling.kind === "up_to_date", "a `latest` with no matching bundle serves nothing");

  const android = decideUpdate({ platform: "android", version_build: "1.0.1", version_name: "builtin" }, M, ORIGIN);
  ok("kind" in android && android.kind === "up_to_date", "we only publish iOS bundles, so android gets nothing");

  const noVersions = decideUpdate({ platform: "ios" }, M, ORIGIN);
  ok("url" in noVersions, "a request with no version fields still resolves (treated as fresh install)");
}

// ---------------------------------------------------------------------------
section("URL building");
{
  const r = decideUpdate({ platform: "ios", version_build: "1.0.1", version_name: "builtin" }, M, ORIGIN + "/");
  ok("url" in r && r.url === `${ORIGIN}/api/ota/bundle/1.0.2`, `trailing slash on origin doesn't double up — got ${"url" in r ? r.url : "?"}`);
}

console.log(`\n${checks - failures}/${checks} OTA invariants passed`);
if (failures > 0) {
  console.error(`\n❌ ${failures} OTA invariant(s) FAILED`);
  process.exit(1);
}
console.log("\n✅ all OTA invariants passed");
