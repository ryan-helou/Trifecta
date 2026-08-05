import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BUNDLE_DIR, loadManifest } from "@/lib/otaFiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves an OTA bundle zip.
//
// These live in /ota-bundles, NOT /public, on purpose: `next build` copies public/
// into the static export, so a zip parked there would be packed inside the *next*
// release — and that one inside the release after it. Serving them through a route
// keeps each bundle exactly the size of the app.
//
// No auth: the contents are the same public JS the App Store already ships. The
// version is looked up in the manifest rather than joined onto a path, so a
// crafted "../../etc/passwd" can't reach the filesystem.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ version: string }> }) {
  const { version } = await ctx.params;
  const manifest = await loadManifest();
  const bundle = manifest.bundles.find((b) => b.version === version);
  if (!bundle) return NextResponse.json({ error: "Unknown bundle." }, { status: 404 });

  try {
    const buf = await readFile(path.join(BUNDLE_DIR, `${bundle.version}.zip`));
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Length": String(buf.byteLength),
        // Bundles are immutable — a given version's bytes never change (the release
        // script refuses to republish a version), so this can cache hard.
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Disposition": `attachment; filename="${bundle.version}.zip"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "Bundle missing on disk." }, { status: 404 });
  }
}
