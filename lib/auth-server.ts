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

export function createSessionToken(userId: string): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const payload = `${userId}.${exp}`;
  const sig = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${b64url(payload)}.${sig}`;
}

export function verifySessionToken(token: string | undefined | null): string | null {
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
  const [userId, expStr] = payload.split(".");
  const exp = Number(expStr);
  if (!userId || !exp || exp < Math.floor(Date.now() / 1000)) return null;
  return userId;
}

export function getUserIdFromRequest(req: NextRequest): string | null {
  // Native (bundled) app: Bearer token in the Authorization header — no cookie
  // survives the capacitor://localhost origin. Web PWA: the httpOnly session cookie.
  const auth = req.headers.get("authorization");
  if (auth && auth.startsWith("Bearer ")) {
    const uid = verifySessionToken(auth.slice(7).trim());
    if (uid) return uid;
  }
  return verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
}

export function sessionCookie(userId: string) {
  return {
    name: SESSION_COOKIE,
    value: createSessionToken(userId),
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
