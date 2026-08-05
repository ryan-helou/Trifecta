// ---------------------------------------------------------------------------
// Self-hosted OTA — the update decision, as a pure function.
//
// We use @capgo/capacitor-updater (MPL-2.0, free) as the client, but point it at
// THIS server instead of Capgo's cloud, so no third party is in the loop and no
// telemetry leaves the app. The plugin is deliberately dumb: in the auto-update
// path it does NOT compare versions itself. It calls the endpoint and obeys:
//
//   • `error` or `kind` present   → no update this cycle
//   • `version: "builtin"`        → drop back to the bundle baked into the binary
//   • anything else               → download `url` and install it as `version`
//
// So EVERY safety rule lives here. Get this wrong and you can silently downgrade
// every device, or loop them on a download forever. Hence a pure function with
// tests (test/ota.test.ts) rather than logic buried in a route handler.
//
// The response shape mirrors the plugin's `AppVersionDec` (see the plugin's
// ios/Sources/CapacitorUpdaterPlugin/InternalUtils.swift). Note the plugin treats
// any non-2xx as a failure, so "nothing to do" is still an HTTP 200.
// ---------------------------------------------------------------------------

/** What the plugin POSTs. Only the fields we actually reason about are typed. */
export interface OtaCheckRequest {
  platform?: string;
  app_id?: string;
  /** the version of the NATIVE binary (the App Store build) */
  version_build?: string;
  /** the bundle currently running — a version string, or "builtin" */
  version_name?: string;
  is_emulator?: boolean;
  is_prod?: boolean;
}

export interface OtaBundle {
  version: string;
  sha256: string;
  size: number;
  createdAtISO: string;
  comment?: string;
}

/** Where a bundle is downloaded from. Deliberately an API route and NOT a file in
 *  `public/`: `next build` copies public/ wholesale into the static export, so a zip
 *  living there would be packed INSIDE the next release's bundle — and the one after
 *  that would contain both. Every release would carry every previous release. */
export function bundlePath(version: string): string {
  return `/api/ota/bundle/${encodeURIComponent(version)}`;
}

export interface OtaManifest {
  latest: string | null;
  bundles: OtaBundle[];
}

export type OtaResponse =
  | { kind: "up_to_date"; message: string }
  | { version: "builtin"; message: string }
  | { version: string; url: string; checksum: string; comment?: string };

/** Compare dotted numeric versions. Returns <0, 0, >0. Non-numeric parts sort as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

const UP_TO_DATE: OtaResponse = { kind: "up_to_date", message: "No new version available" };

/**
 * Decide what a device should do.
 *
 * @param req      the plugin's POST body
 * @param manifest the bundles we have published
 * @param origin   absolute origin to build download URLs from (the plugin needs
 *                 an absolute URL — a relative one fails `URL(string:)` natively)
 */
export function decideUpdate(req: OtaCheckRequest, manifest: OtaManifest, origin: string): OtaResponse {
  // iOS only for now; an Android build would need its own bundles.
  if (req.platform && req.platform !== "ios") return UP_TO_DATE;

  const native = (req.version_build || "").trim();
  const current = (req.version_name || "").trim();
  const latest = manifest.latest ? manifest.bundles.find((b) => b.version === manifest.latest) : undefined;

  if (!latest) return UP_TO_DATE; // nothing published

  // ---- rule 1: never serve a bundle the native binary already contains -----
  // A new App Store build ships newer web assets than any old OTA bundle. Serving
  // one anyway would DOWNGRADE a freshly-updated app — the single worst thing this
  // endpoint can do, and the reason Capgo has `disableAutoUpdateUnderNative`.
  if (native && compareVersions(latest.version, native) <= 0) {
    // The device may still be *running* a stale OTA bundle from before the store
    // update. Tell it to fall back to the binary's own assets, which are newer.
    if (current && current !== "builtin" && compareVersions(current, native) < 0) {
      return { version: "builtin", message: "Native build is newer than any bundle" };
    }
    return UP_TO_DATE;
  }

  // ---- rule 2: don't re-serve what they're already running ----------------
  // Without this the plugin re-downloads the same zip on every launch forever.
  if (current && current !== "builtin" && compareVersions(latest.version, current) <= 0) {
    return UP_TO_DATE;
  }

  return {
    version: latest.version,
    url: `${origin.replace(/\/$/, "")}${bundlePath(latest.version)}`,
    checksum: latest.sha256,
    ...(latest.comment ? { comment: latest.comment } : {}),
  };
}
