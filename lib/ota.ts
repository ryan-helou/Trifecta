import { IS_NATIVE } from "./runtime";

// Capgo OTA. On the bundled native build (Path B) the updater auto-downloads new
// bundles; calling notifyAppReady() tells it the current bundle booted OK so it
// isn't rolled back. No-op on the web / Path A.
export async function notifyAppReady(): Promise<void> {
  if (!IS_NATIVE) return;
  try {
    const { CapacitorUpdater } = await import("@capgo/capacitor-updater");
    await CapacitorUpdater.notifyAppReady();
  } catch {
    /* web / plugin unavailable */
  }
}
