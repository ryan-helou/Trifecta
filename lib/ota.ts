import { IS_NATIVE } from "./runtime";
import { CapacitorUpdater } from "@capgo/capacitor-updater";

// Capgo OTA. On the bundled native build (Path B) the updater auto-downloads new
// bundles; calling notifyAppReady() tells it the current bundle booted OK so it
// isn't rolled back. No-op on the web / Path A.
//
// STATICALLY imported for the same reason as lib/health.ts, lib/notify.ts and
// lib/tokenStore.ts: a lazy import() of a Capacitor plugin HANGS FOREVER in the
// bundled WKWebView. This one is the most dangerous of the four — notifyAppReady()
// tells Capgo the bundle booted successfully, so a hung import here means the call
// never lands and the OTA layer can roll the bundle back as a failed boot.
export async function notifyAppReady(): Promise<void> {
  if (!IS_NATIVE) return;
  try {
    await CapacitorUpdater.notifyAppReady();
  } catch {
    /* web / plugin unavailable */
  }
}
