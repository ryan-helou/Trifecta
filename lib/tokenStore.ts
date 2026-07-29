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
// Mirror of the token in the app's own (sandboxed) web storage.
//
// Why this exists: the Keychain write is fire-and-forget AND its errors are swallowed by
// withTimeout's `.catch`, so a failing write is completely silent — the in-memory cache
// keeps the current session working and the loss only shows up as "signed out again" on
// the next cold boot. Measured 2026-07-29: across both simulators used for testing, the
// keychain database contained ZERO items for this app after many successful logins, i.e.
// the write had never once landed, and every cold boot dropped the athlete on the welcome
// screen. Unsigned simulator builds carry no application-identifier entitlement, which is
// the classic cause (errSecMissingEntitlement / -34018), so this may well behave on a
// signed device build — but "may well" is not something to ship an auth path on.
//
// The Keychain stays the primary store. This is a fallback read/write in the same app
// sandbox that already holds the athlete's cached plan and profile (CACHE_KEY), so it
// widens no boundary that wasn't already open, and it means a Keychain that refuses us
// costs the athlete nothing.
const FALLBACK_KEY = "trifecta:session-token";

function fallbackGet(): string | null {
  try {
    return localStorage.getItem(FALLBACK_KEY);
  } catch {
    return null;
  }
}
function fallbackSet(token: string): void {
  try {
    localStorage.setItem(FALLBACK_KEY, token);
  } catch {
    /* private mode / quota — the Keychain is still the primary store */
  }
}
function fallbackClear(): void {
  try {
    localStorage.removeItem(FALLBACK_KEY);
  } catch {
    /* nothing persisted, nothing to clear */
  }
}

/** Whether the last Keychain write actually landed. Null until a write is attempted.
 *  Exposed so a boot diagnostic can tell "Keychain is unavailable on this device" apart
 *  from "the athlete really is signed out". */
let keychainHealthy: boolean | null = null;
export function keychainWriteOk(): boolean | null {
  return keychainHealthy;
}

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
  // Keychain unavailable or empty: fall back to the sandboxed mirror rather than
  // silently treating a storage failure as "this person is signed out".
  if (!cached) cached = fallbackGet();
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
  // Mirror first and synchronously: it's the write that cannot fail silently.
  fallbackSet(token);
  void (async () => {
    try {
      await withTimeout(
        (SecureStorage.set(KEY, token) as Promise<unknown>).then(() => "ok"),
        2500,
        "timeout",
      ).then((r) => {
        keychainHealthy = r === "ok";
      });
    } catch {
      keychainHealthy = false;
    }
  })();
}

/** Drop the token from the cache, the Keychain, and the mirror. Must clear BOTH, or a
 *  logout would leave a usable token behind in the fallback store. */
export function clearToken(): void {
  cached = null;
  fallbackClear();
  if (!IS_NATIVE) return;
  void withTimeout(SecureStorage.remove(KEY) as Promise<unknown>, 2500, null);
}
