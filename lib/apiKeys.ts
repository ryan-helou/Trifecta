import crypto from "node:crypto";
import { API_KEY_PREFIX } from "./apiKeyFormat";

// ---------------------------------------------------------------------------
// Read-only API keys: a credential another app of yours can hold *instead of*
// your password.
//
// The problem this exists for: the only way into the API was POST /api/auth/login
// with a username and password, which mints a session token. That token is a full
// credential — it authorizes PUT /api/state, i.e. rewriting the entire plan — and
// it can only be obtained by handing over the password. A dashboard that only ever
// READS had to hold both risks.
//
// An API key is the opposite trade: it can't be turned back into a password, it
// authorizes nothing but reads, it never expires on a timer, and it can be killed
// on its own without touching any signed-in device.
//
// SERVER ONLY (imports node:crypto). Client code wanting the constants or the
// format checks imports ./apiKeyFormat directly; everything there is re-exported
// below so server code has a single import site.
// ---------------------------------------------------------------------------

export * from "./apiKeyFormat";

/** 32 bytes of CSPRNG = 256 bits. Base64url-encodes to 43 chars, so a whole key
 *  is 47 chars: short enough to paste, far beyond brute force. */
const KEY_BYTES = 32;

/** Mint a new key. The plaintext returned here is the ONLY time it exists in a
 *  form anyone can use — the caller shows it once and stores nothing but the hash. */
export function generateApiKey(): string {
  return API_KEY_PREFIX + crypto.randomBytes(KEY_BYTES).toString("base64url");
}

/** SHA-256, hex.
 *
 *  Deliberately NOT scrypt, unlike passwords. A password is low-entropy and
 *  guessable, so hashing it has to be *slow* to make a dictionary attack
 *  expensive. This key is 256 bits of CSPRNG output: there is no dictionary, and
 *  no amount of iteration changes that. What a slow KDF would buy instead is
 *  ~50-100ms of blocking work on the single Node thread for every authenticated
 *  read — a cost with no matching benefit. (Same reasoning GitHub applies to PATs.) */
export function hashApiKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}
