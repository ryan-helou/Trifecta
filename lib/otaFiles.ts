import { readFile } from "node:fs/promises";
import path from "node:path";
import type { OtaManifest } from "./otaServer";

// Server-only helpers for the self-hosted OTA store. Kept apart from otaServer.ts
// so that file stays pure (and therefore testable without touching a disk).

/** Bundles live OUTSIDE public/ — see the note on `bundlePath` for why. */
export const BUNDLE_DIR = path.join(process.cwd(), "ota-bundles");

let cached: { manifest: OtaManifest; at: number } | null = null;
const CACHE_MS = 30_000;

/** The published manifest, or an empty one. A missing/unreadable manifest is a
 *  normal, safe state: every device simply stays on what it already has. */
export async function loadManifest(): Promise<OtaManifest> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.manifest;
  try {
    const raw = await readFile(path.join(BUNDLE_DIR, "manifest.json"), "utf8");
    const manifest = JSON.parse(raw) as OtaManifest;
    cached = { manifest, at: Date.now() };
    return manifest;
  } catch {
    return { latest: null, bundles: [] };
  }
}
