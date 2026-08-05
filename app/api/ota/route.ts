import { NextRequest, NextResponse } from "next/server";
import { decideUpdate, type OtaCheckRequest } from "@/lib/otaServer";
import { loadManifest } from "@/lib/otaFiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Self-hosted OTA endpoint — replaces Capgo's cloud.
//
// `@capgo/capacitor-updater` is MPL-2.0 and its update/stats/channel URLs are all
// configurable, so we keep the (good) native client and drop the SaaS: no
// subscription, no third party, and — with statsUrl disabled in
// capacitor.config.ts — no crash/JS-error telemetry leaving athletes' phones.
//
// The bundles themselves are zips under /ota-bundles (NOT public/ — see
// `bundlePath`), published by scripts/ota-release.mjs and streamed by
// /api/ota/bundle/[version]. No object store, no database, no auth: a bundle is
// the same public JS the App Store already ships.
//
// IMPORTANT: the plugin treats any non-2xx as a failed check, so "nothing to do"
// must still be HTTP 200. All the decision logic is in lib/otaServer.ts (tested).
// ---------------------------------------------------------------------------

/** The origin to hand back for downloads. Explicit config wins; otherwise mirror
 *  the request, so this works on Railway, a preview deploy, and localhost alike. */
function originFor(req: NextRequest): string {
  const configured = process.env.OTA_PUBLIC_ORIGIN;
  if (configured) return configured;
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  return `${proto}://${host}`;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as OtaCheckRequest;
  const manifest = await loadManifest();
  const res = decideUpdate(body, manifest, originFor(req));
  return NextResponse.json(res);
}

// The plugin only POSTs, but a GET makes this trivially debuggable from a browser
// ("what would my phone be offered right now?") without reaching for curl.
export async function GET(req: NextRequest) {
  const manifest = await loadManifest();
  const url = new URL(req.url);
  const probe: OtaCheckRequest = {
    platform: "ios",
    version_build: url.searchParams.get("native") ?? "1.0.1",
    version_name: url.searchParams.get("current") ?? "builtin",
  };
  return NextResponse.json({ manifest, probe, wouldServe: decideUpdate(probe, manifest, originFor(req)) });
}
