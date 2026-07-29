/*
  Session lifetime invariants (ticket #71).

  The bug these exist for: the session token was a stateless HMAC over `userId.exp`
  with a 60-day TTL and no session id. Logout cleared the cookie and the app forgot its
  copy, but the token itself stayed valid the whole 60 days — a copied token was a
  permanent key. There was no revocation of any kind.

  These run against the in-memory store, which implements the same Store contract as
  Postgres, so the invariants are about the auth *design*, not one backend.
*/
import assert from "node:assert";
import {
  claimsFromRequest,
  createSessionToken,
  verifySessionToken,
} from "../lib/auth-server";
import { getStore } from "../lib/db";

process.env.NODE_ENV = "test";

let pass = 0;
function ok(label: string, cond: boolean) {
  assert.ok(cond, `FAILED: ${label}`);
  pass++;
}

/** Minimal NextRequest stand-in: claimsFromRequest only touches headers + cookies. */
function reqWith(token: string | null, via: "bearer" | "cookie" = "bearer") {
  return {
    headers: { get: (k: string) => (via === "bearer" && token && k.toLowerCase() === "authorization" ? `Bearer ${token}` : null) },
    cookies: { get: (k: string) => (via === "cookie" && token && k === "ip_session" ? { value: token } : undefined) },
  } as unknown as Parameters<typeof claimsFromRequest>[0];
}

async function main() {
  const store = getStore();
  await store.init();
  const user = await store.createUser(`revoke_${Date.now()}`, "scrypt$x$y");

  // ---- shape ----------------------------------------------------------------
  const token = createSessionToken(user.id);
  const claims = verifySessionToken(token);
  ok("a fresh token verifies", !!claims);
  ok("it carries the user", claims!.userId === user.id);
  ok("it carries a session id", typeof claims!.sid === "string" && claims!.sid.length >= 16);
  ok("iat precedes exp", claims!.iat < claims!.exp);

  // Two logins must not share a session id, or revoking one would revoke both.
  ok("each login gets a distinct sid", verifySessionToken(createSessionToken(user.id))!.sid !== claims!.sid);

  // ---- forgery ---------------------------------------------------------------
  ok("a tampered signature is rejected", verifySessionToken(token.slice(0, -2) + "xy") === null);
  ok("garbage is rejected", verifySessionToken("not-a-token") === null);
  ok("empty is rejected", verifySessionToken("") === null);

  // The old format is refused on purpose: it has no sid, so nothing can revoke it.
  // Built here the way the pre-fix code built it, to prove the door is shut.
  const crypto = await import("node:crypto");
  const legacyPayload = `${user.id}.${Math.floor(Date.now() / 1000) + 3600}`;
  const legacySig = crypto
    .createHmac("sha256", "trifecta-dev-secret-change-me-please")
    .update(legacyPayload)
    .digest("base64url");
  const legacy = `${Buffer.from(legacyPayload).toString("base64url")}.${legacySig}`;
  ok("a legacy two-field token is rejected", verifySessionToken(legacy) === null);

  // ---- revocation: the actual bug --------------------------------------------
  ok("session is live before logout", await store.isSessionLive(claims!.userId, claims!.sid, claims!.iat));

  await store.revokeSession(claims!.userId, claims!.sid, claims!.exp);
  ok("THE BUG: a revoked token no longer authenticates", !(await store.isSessionLive(claims!.userId, claims!.sid, claims!.iat)));

  // Revocation is per-device, not per-account.
  const other = verifySessionToken(createSessionToken(user.id))!;
  ok("logging out one device leaves the other signed in", await store.isSessionLive(other.userId, other.sid, other.iat));

  // ---- sign out everywhere ----------------------------------------------------
  await new Promise((r) => setTimeout(r, 1100)); // epoch has 1s resolution
  await store.revokeAllSessions(user.id);
  ok("sign-out-everywhere kills the surviving session", !(await store.isSessionLive(other.userId, other.sid, other.iat)));

  const afterEpoch = verifySessionToken(createSessionToken(user.id))!;
  ok("but a fresh login still works afterwards", await store.isSessionLive(afterEpoch.userId, afterEpoch.sid, afterEpoch.iat));

  // ---- a token must not outlive its account -----------------------------------
  await store.deleteUser(user.id);
  ok("a deleted account's token is dead", !(await store.isSessionLive(afterEpoch.userId, afterEpoch.sid, afterEpoch.iat)));

  // ---- transport --------------------------------------------------------------
  const t2 = createSessionToken("someone");
  ok("Bearer header is read", claimsFromRequest(reqWith(t2, "bearer"))?.sid === verifySessionToken(t2)!.sid);
  ok("session cookie is read", claimsFromRequest(reqWith(t2, "cookie"))?.sid === verifySessionToken(t2)!.sid);
  ok("no credentials ⇒ no claims", claimsFromRequest(reqWith(null)) === null);

  console.log(`\n✓ auth/session: ${pass}/${pass} checks passed\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
