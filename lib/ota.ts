import { IS_NATIVE } from "./runtime";
import { CapacitorUpdater } from "@capgo/capacitor-updater";
import { SplashScreen } from "@capacitor/splash-screen";

// Capgo OTA. On the bundled native build (Path B) the updater auto-downloads new
// bundles; calling notifyAppReady() tells it the current bundle booted OK so it
// isn't rolled back. No-op on the web / Path A.
//
// STATICALLY imported for the same reason as lib/health.ts, lib/notify.ts and
// lib/tokenStore.ts: a lazy import() of a Capacitor plugin HANGS FOREVER in the
// bundled WKWebView. This one is the most dangerous of the four — notifyAppReady()
// tells Capgo the bundle booted successfully, so a hung import here means the call
// never lands and the OTA layer can roll the bundle back as a failed boot.
/** The bundle actually running, which is NOT always the one baked into the binary:
 *  after an OTA the native build number stays put while the web bundle moves. Support
 *  needs the second number, so both are surfaced (#179). Falls back to the build-time
 *  version on web, or when the plugin can't answer. */
export async function currentBundleVersion(): Promise<string | null> {
  if (!IS_NATIVE) return null;
  try {
    const cur = await CapacitorUpdater.current();
    return cur?.bundle?.version ?? null;
  } catch {
    return null;
  }
}

export async function notifyAppReady(): Promise<void> {
  if (!IS_NATIVE) return;
  try {
    await CapacitorUpdater.notifyAppReady();
  } catch {
    /* web / plugin unavailable */
  }
  // Now that the bundle has booted, drop the native launch screen. It is held open
  // (launchAutoHide:false) so a cold start never flashes blank white between the
  // launch mark and the first painted frame. STATICALLY imported for the same reason
  // as the updater above: a lazy import() of a Capacitor plugin hangs forever in the
  // bundled WKWebView, and a hang here would leave the splash up permanently.
  try {
    await SplashScreen.hide();
  } catch {
    /* plugin unavailable — nothing to hide */
  }
}
