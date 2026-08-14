// ---------------------------------------------------------------------------
// The shape of a read-only API key — constants and pure string logic, no crypto.
//
// Split from lib/apiKeys.ts for one concrete reason: that module imports
// `node:crypto`, and the settings UI is a client component. Importing the key
// LENGTH LIMIT from there would pull Node's crypto into the browser bundle (and
// fail the build). Everything isomorphic lives here; everything that needs
// randomness or hashing stays server-side in lib/apiKeys.ts, which re-exports
// this file so server code still has one place to import from.
// ---------------------------------------------------------------------------

/** Every key starts with this. Not decoration — it is what makes a leaked key
 *  greppable in logs, a git history, or a secret scanner. */
export const API_KEY_PREFIX = "tri_";

/** Bound what we're willing to hash. A key is a fixed 47 chars; anything longer
 *  is someone probing, and there's no reason to run SHA-256 over their payload. */
const MAX_KEY_CHARS = 100;

/** Longest key name we'll store. A label, not a description. */
export const API_KEY_NAME_MAX = 60;

/** How many keys one account may hold at once (revoked ones don't count).
 *  Rows are cheap, but nothing should be unbounded and per-app is the real unit. */
export const MAX_API_KEYS = 20;

/** The only scope that exists today, and the reason the feature is safe to have.
 *  Written as a union rather than a bare string so adding a "write" scope later is
 *  a deliberate, type-checked decision at every site that reads it — not a typo. */
export type ApiKeyScope = "read";

/** Does this string even look like one of our keys? Cheap pre-filter so a
 *  malformed Authorization header never reaches the database. */
export function isApiKey(value: string | null | undefined): value is string {
  if (!value || value.length > MAX_KEY_CHARS) return false;
  if (!value.startsWith(API_KEY_PREFIX)) return false;
  const body = value.slice(API_KEY_PREFIX.length);
  return body.length >= 20 && /^[A-Za-z0-9_-]+$/.test(body);
}

/** The raw token out of an `Authorization: Bearer …` header, whatever kind it is. */
export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  if (!header.startsWith("Bearer ")) return null;
  const t = header.slice(7).trim();
  return t || null;
}

/** How a key is shown once we can no longer show it: prefix + last 4. Enough to
 *  tell two keys apart, useless to anyone who finds it. */
export function maskApiKey(key: string): string {
  return `${API_KEY_PREFIX}…${key.slice(-4)}`;
}

/** Names are labels the athlete picks. Returns an error string, or null when fine. */
export function validateKeyName(name: unknown): string | null {
  if (typeof name !== "string") return "Give the key a name.";
  const n = name.trim();
  if (!n) return "Give the key a name.";
  if (n.length > API_KEY_NAME_MAX) return `Name must be ${API_KEY_NAME_MAX} characters or fewer.`;
  return null;
}
