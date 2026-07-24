import { IS_NATIVE } from "./runtime";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";

// Session-token store for the bundled native app.
//
// The web PWA authenticates with an httpOnly cookie and never uses this (IS_NATIVE
// is false). Native persists the Bearer token in the iOS Keychain via
// @aparajita/capacitor-secure-storage; a synchronous in-memory cache lets jsonFetch
// attach the Authorization header without awaiting on every request.
//
// IMPORTANT: the token is cached SYNCHRONOUSLY; the Keychain write is best-effort and
// must NEVER be on the critical path of login. (An earlier version dynamically
// imported the plugin and AWAITED the Keychain write inside login — the dynamic import
// could hang forever in the bundled WKWebView, freezing the app on "One sec…". The
// plugin is now statically imported, and callers persist fire-and-forget.)

let cached: string | null = null;
const KEY = "trifecta.session.token";

// Time-box any native call so a slow/misbehaving bridge can't hang the caller.
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    Promise.resolve(p).catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** Synchronous read of the cached token (populated by loadToken / setToken). */
export function getTokenSync(): string | null {
  return cached;
}

/** Read the persisted token from the Keychain into the cache. Call once on boot. */
export async function loadToken(): Promise<string | null> {
  if (!IS_NATIVE) return cached;
  const v = await withTimeout(SecureStorage.get(KEY) as Promise<unknown>, 2500, null);
  cached = typeof v === "string" ? v : null;
  return cached;
}

/**
 * Cache the token immediately (synchronous) and persist it to the Keychain in the
 * background. Do NOT await this in the auth flow — the cached value is what jsonFetch
 * reads, and the persist is only needed to survive an app restart.
 */
export function setToken(token: string): void {
  cached = token;
  if (!IS_NATIVE) return;
  void withTimeout(SecureStorage.set(KEY, token) as Promise<unknown>, 2500, null);
}

/** Drop the token from the cache and (best-effort) the Keychain. */
export function clearToken(): void {
  cached = null;
  if (!IS_NATIVE) return;
  void withTimeout(SecureStorage.remove(KEY) as Promise<unknown>, 2500, null);
}
