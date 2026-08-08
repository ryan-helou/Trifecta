import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

// ---------------------------------------------------------------------------
// Encryption at rest for third-party OAuth tokens.
//
// A Strava access/refresh token pair is enough to read someone's entire activity
// history, so storing it in a plaintext TEXT column means a single leaked database
// dump hands over every connected athlete's Strava account. The API Policy makes
// this an explicit obligation rather than just good practice — §8.1 requires
// "commercially reasonable and appropriate administrative, technical,
// organizational, and physical measures", measured against "Section 32(1) of the
// GDPR", which names encryption first. "There are security or privacy concerns with
// the app" is one of the four reasons Strava gives for refusing capacity.
//
// AES-256-GCM, so the ciphertext is authenticated: a tampered row fails to decrypt
// rather than silently yielding a wrong token. The key is derived from an env
// secret; there is no key in the repo and none in the database.
//
// Backward compatible on purpose. Rows written before this existed are plaintext,
// and `decryptToken` returns anything that isn't in our envelope format unchanged,
// so nobody is signed out by the deploy. Each connection re-encrypts itself the
// next time its tokens are refreshed (Strava rotates them roughly every 6 hours),
// so the table converges without a migration window or a mass re-auth.
// ---------------------------------------------------------------------------

/** Marks our envelope so plaintext legacy rows are distinguishable. v1 = AES-256-GCM. */
const PREFIX = "enc:v1:";

/** Missing key = encryption off. Deliberately not a throw: a self-hoster who has
 *  not set the secret should still have a working app, and failing closed here
 *  would mean nobody can connect Strava at all. Logged once so it is visible. */
let warned = false;
function keyOf(): Buffer | null {
  const secret = process.env.TOKEN_ENC_KEY || process.env.AUTH_SECRET || "";
  if (!secret) {
    if (!warned) {
      warned = true;
      console.warn("tokenCrypto: no TOKEN_ENC_KEY/AUTH_SECRET set — OAuth tokens are being stored in plaintext");
    }
    return null;
  }
  // scrypt with a fixed salt: the secret is already high-entropy, and a random salt
  // would have to be stored next to the ciphertext for no security gain here.
  return scryptSync(secret, "trifecta:token:v1", 32);
}

/** Encrypt a token for storage. Returns the input unchanged when no key is set. */
export function encryptToken(plain: string): string {
  if (!plain) return plain;
  const key = keyOf();
  if (!key) return plain;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  const tag = c.getAuthTag();
  return PREFIX + [iv, tag, body].map((b) => b.toString("base64")).join(".");
}

/** Decrypt a stored token. Plaintext (pre-encryption) values pass through, so this
 *  is safe to run against a half-migrated table. */
export function decryptToken(stored: string): string {
  if (!stored || !stored.startsWith(PREFIX)) return stored; // legacy plaintext row
  const key = keyOf();
  if (!key) return stored;
  try {
    const [ivB, tagB, bodyB] = stored.slice(PREFIX.length).split(".");
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64"));
    d.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([d.update(Buffer.from(bodyB, "base64")), d.final()]).toString("utf8");
  } catch {
    // Wrong key or tampered row. Returning "" makes the connection read as invalid,
    // which sends the athlete through a normal reconnect instead of throwing on a
    // path (webhook delivery) where an exception would drop real data.
    console.warn("tokenCrypto: could not decrypt a stored token — the athlete will need to reconnect");
    return "";
  }
}
