import { IS_NATIVE } from "./runtime";

// Session-token store for the bundled native app.
//
// The web PWA authenticates with an httpOnly cookie and never uses this (IS_NATIVE
// is false). Native persists the Bearer token in the iOS Keychain via
// @aparajita/capacitor-secure-storage; a synchronous in-memory cache lets jsonFetch
// attach the Authorization header without awaiting on every request.
//
// Every native plugin call is time-boxed so a slow/misbehaving bridge can NEVER hang
// the caller (app boot, login) — worst case we fall back to the in-memory cache.

let cached: string | null = null;
const KEY = "trifecta.session.token";

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    Promise.resolve(p).catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

// Lazily loaded so the plugin's native bridge is only pulled into the native bundle.
async function keychain() {
  if (!IS_NATIVE) return null;
  const mod = await withTimeout(import("@aparajita/capacitor-secure-storage"), 2500, null);
  return mod ? mod.SecureStorage : null;
}

/** Synchronous read of the cached token (populated by loadToken / setToken). */
export function getTokenSync(): string | null {
  return cached;
}

/** Read the persisted token from the Keychain into the cache. Call once on boot. */
export async function loadToken(): Promise<string | null> {
  const ks = await keychain();
  if (ks) {
    const v = await withTimeout(ks.get(KEY) as Promise<unknown>, 2500, null);
    cached = (v as string | null) ?? null;
  }
  return cached;
}

export async function setToken(token: string): Promise<void> {
  cached = token; // set synchronously — getTokenSync() works immediately even if the persist below stalls
  const ks = await keychain();
  if (ks) await withTimeout(ks.set(KEY, token), 2500, undefined);
}

export async function clearToken(): Promise<void> {
  cached = null;
  const ks = await keychain();
  if (ks) await withTimeout(ks.remove(KEY) as Promise<unknown>, 2500, undefined);
}
