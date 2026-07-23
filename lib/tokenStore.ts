import { IS_NATIVE } from "./runtime";

// Session-token store for the bundled native app.
//
// The web PWA authenticates with an httpOnly cookie and never uses this (IS_NATIVE
// is false). Native persists the Bearer token in the iOS Keychain via
// @aparajita/capacitor-secure-storage; a synchronous in-memory cache lets jsonFetch
// attach the Authorization header without awaiting on every request.

let cached: string | null = null;
const KEY = "trifecta.session.token";

// Lazily loaded so the plugin's native bridge is only pulled into the native bundle.
async function keychain() {
  if (!IS_NATIVE) return null;
  try {
    const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
    return SecureStorage;
  } catch {
    return null;
  }
}

/** Synchronous read of the cached token (populated by loadToken / setToken). */
export function getTokenSync(): string | null {
  return cached;
}

/** Read the persisted token from the Keychain into the cache. Call once on boot. */
export async function loadToken(): Promise<string | null> {
  const ks = await keychain();
  if (ks) {
    try {
      cached = ((await ks.get(KEY)) as string | null) ?? null;
    } catch {
      /* keep whatever is cached */
    }
  }
  return cached;
}

export async function setToken(token: string): Promise<void> {
  cached = token;
  const ks = await keychain();
  if (ks) {
    try {
      await ks.set(KEY, token);
    } catch {
      /* ignore — the in-memory cache still works for this session */
    }
  }
}

export async function clearToken(): Promise<void> {
  cached = null;
  const ks = await keychain();
  if (ks) {
    try {
      await ks.remove(KEY);
    } catch {
      /* ignore */
    }
  }
}
