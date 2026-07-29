import crypto from "node:crypto";
import { NextRequest } from "next/server";

// ---------------------------------------------------------------------------
// Dependency-free auth: scrypt password hashing + an HMAC-signed session token
// stored in an httpOnly cookie. No external auth library needed.
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = "ip_session";
const SESSION_TTL_SEC = 60 * 60 * 24 * 60; // 60 days

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 16) return s;
  // P0 (docs/knowledge/08 §3.6): never sign sessions with the hardcoded dev secret
  // in production — it lives in the repo, so anyone could forge a token for any
  // userId (full account takeover). Fall back to DATABASE_URL (not publicly known)
  // only as a last resort + warn; a dedicated SESSION_SECRET should be set. Throw
  // if neither exists rather than sign with a guessable value.
  if (process.env.NODE_ENV === "production") {
    if (process.env.DATABASE_URL) {
      console.warn(
        "[auth] SESSION_SECRET not set — using DATABASE_URL as a fallback. Set a dedicated SESSION_SECRET (>=16 chars).",
      );
      return process.env.DATABASE_URL;
    }
    throw new Error("SESSION_SECRET (>=16 chars) is required in production.");
  }
  return "trifecta-dev-secret-change-me-please";
}

// ---- passwords ----

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hash] = parts;
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(derived, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- session token ----

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}
function fromB64url(s: string): string {
  return Buffer.from(s, "base64url").toString();
}

/** What a structurally-valid, correctly-signed, unexpired token carries.
 *  Says nothing about whether the session is still *allowed* — see authenticate(). */
export interface SessionClaims {
  userId: string;
  /** Per-login session id. The handle logout revokes, so one device can be signed
   *  out without killing the others. */
  sid: string;
  /** Issued-at, derived rather than stored: every token has the same fixed TTL. */
  iat: number;
  exp: number;
}

export function createSessionToken(userId: string): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  // 16 bytes: this is the only thing standing between "log out" and "log out
  // everywhere", so it must not be guessable from a userId or a timestamp.
  const sid = crypto.randomBytes(16).toString("base64url");
  const payload = `${userId}.${exp}.${sid}`;
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${b64url(payload)}.${sig}`;
}

/** Signature + expiry only — no I/O. Returns null for anything malformed, forged,
 *  expired, or issued in the old two-field format.
 *
 *  Legacy `userId.exp` tokens are REJECTED rather than grandfathered. They carry no
 *  session id, so there is no handle to revoke them by: accepting one would mean
 *  honouring a 60-day credential that logout provably cannot kill, which is the whole
 *  bug. The cost is that every existing session signs in once more. */
export function verifySessionToken(token: string | undefined | null): SessionClaims | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let payload: string;
  try {
    payload = fromB64url(payloadB64);
  } catch {
    return null;
  }
  const expected = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const parts = payload.split(".");
  if (parts.length !== 3) return null; // legacy 2-field token, or garbage
  const [userId, expStr, sid] = parts;
  const exp = Number(expStr);
  if (!userId || !sid || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return null;
  return { userId, sid, iat: exp - SESSION_TTL_SEC, exp };
}

/** The claims on the request, if the token is well-formed. Still not proof of a live
 *  session — callers that touch user data must use authenticate(). */
export function claimsFromRequest(req: NextRequest): SessionClaims | null {
  // Native (bundled) app: Bearer token in the Authorization header — no cookie
  // survives the capacitor://localhost origin. Web PWA: the httpOnly session cookie.
  const auth = req.headers.get("authorization");
  if (auth && auth.startsWith("Bearer ")) {
    const c = verifySessionToken(auth.slice(7).trim());
    if (c) return c;
  }
  return verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
}

/** Authenticate a request: valid signature AND a session the server still honours.
 *
 *  Was synchronous and signature-only, which is why logout did nothing on the server —
 *  a copied token stayed good for its full 60 days. One round trip now answers all
 *  three questions at once: does the user still exist, has this sid been revoked, and
 *  was the token issued before a sign-out-everywhere. */
export async function getUserIdFromRequest(req: NextRequest): Promise<string | null> {
  const claims = claimsFromRequest(req);
  if (!claims) return null;
  const { getStore } = await import("./db");
  try {
    const ok = await getStore().isSessionLive(claims.userId, claims.sid, claims.iat);
    return ok ? claims.userId : null;
  } catch {
    // Fail CLOSED. A store that can't answer is not permission to proceed — the
    // alternative is that a database blip silently restores the old behaviour.
    return null;
  }
}

/** Wrap an ALREADY-ISSUED token in the session cookie.
 *
 *  Takes the token rather than a userId on purpose. Login and signup used to mint one
 *  token for the JSON body and a second, independent one for the cookie — two live
 *  sessions per sign-in. Logging out revoked only the one the client happened to
 *  present, quietly leaving the other valid for its full 60 days. One login, one sid. */
export function sessionCookieFor(token: string) {
  return {
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  };
}

export function clearCookie() {
  return {
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  };
}

// ---- validation ----

export function validateCredentials(username: unknown, password: unknown): string | null {
  if (typeof username !== "string" || typeof password !== "string") return "Invalid input.";
  const u = username.trim();
  if (u.length < 3 || u.length > 24) return "Username must be 3–24 characters.";
  if (!/^[a-zA-Z0-9_.-]+$/.test(u)) return "Username can use letters, numbers, and . _ - only.";
  if (password.length < 6) return "Password must be at least 6 characters.";
  return null;
}
