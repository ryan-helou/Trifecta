/*
  Read-only API keys (lib/apiKeys.ts, /api/tokens, GET /api/state).

  What these are defending. JARVIS — a separate dashboard — needs to read the
  training plan. Before this, its only way in was the athlete's password, which
  buys a session token, which authorizes PUT /api/state: full write access to the
  whole plan, held by something that only ever reads. An API key is meant to be
  strictly less than that. The moment a key can write, the feature is worse than
  no feature at all, because it looks like scoping and isn't.

  So these drive the ACTUAL route handlers, not a re-implementation of their rules.
  A test that reasons about `authenticateRead` in isolation would still pass if
  someone pointed PUT at it. The store is the in-memory one, which implements the
  same Store contract as Postgres.
*/
import assert from "node:assert";
import { NextRequest } from "next/server";
import {
  API_KEY_PREFIX,
  MAX_API_KEYS,
  generateApiKey,
  hashApiKey,
  isApiKey,
  maskApiKey,
  validateKeyName,
} from "../lib/apiKeys";
import { createSessionToken } from "../lib/auth-server";
import { getStore } from "../lib/db";

let pass = 0;
function ok(label: string, cond: boolean) {
  assert.ok(cond, `FAILED: ${label}`);
  pass++;
}
function section(name: string) {
  console.log(`\n  ${name}`);
}

/** tsx loads the route modules through CJS interop, which parks the named handlers
 *  on `default`. Normalise so the tests can call GET/PUT/POST/DELETE directly. */
async function route<T extends object>(mod: Promise<T>): Promise<T> {
  const m = (await mod) as T & { default?: T };
  return m.default ?? m;
}

type Creds = { session?: string; key?: string };

function req(url: string, init: { method?: string; body?: unknown } & Creds = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  // A session token and an API key both travel as `Authorization: Bearer …`, so a
  // request can only carry one — except in the both-at-once case below, where the
  // session rides in the cookie exactly as the web app sends it.
  if (init.key) headers["authorization"] = `Bearer ${init.key}`;
  else if (init.session) headers["authorization"] = `Bearer ${init.session}`;
  return new NextRequest(`http://localhost${url}`, {
    method: init.method ?? "GET",
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

/** A request carrying the session the way the WEB app does — in the cookie —
 *  optionally with a `tri_` key in the header at the same time. */
function reqCookie(url: string, method: string, session: string, body?: unknown, key?: string) {
  const headers: Record<string, string> = { "content-type": "application/json", cookie: `ip_session=${session}` };
  if (key) headers["authorization"] = `Bearer ${key}`;
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function main() {
  const state = await route(import("../app/api/state/route"));
  const tokens = await route(import("../app/api/tokens/route"));
  const tokenById = await route(import("../app/api/tokens/[id]/route"));

  const store = getStore();
  await store.init();

  const alice = await store.createUser(`alice_${Date.now()}`, "scrypt$x$y");
  const bob = await store.createUser(`bob_${Date.now()}`, "scrypt$x$y");
  const aliceSession = createSessionToken(alice.id);
  const bobSession = createSessionToken(bob.id);

  // Distinct, recognisable plans so a cross-user read is unmissable.
  await store.setData(alice.id, { profile: { name: "alice" }, plan: { secret: "ALICE-PLAN" } });
  await store.setData(bob.id, { profile: { name: "bob" }, plan: { secret: "BOB-PLAN" } });

  // ---- key shape -------------------------------------------------------------
  section("key shape");
  const sample = generateApiKey();
  ok("keys carry the tri_ prefix", sample.startsWith(API_KEY_PREFIX));
  ok("a key is greppable-length, not a paragraph", sample.length > 40 && sample.length < 60);
  ok("keys are unique", generateApiKey() !== generateApiKey());
  ok("a generated key passes the pre-filter", isApiKey(sample));
  ok("a session token is NOT mistaken for an API key", !isApiKey(aliceSession));
  ok("garbage is rejected before it reaches the database", !isApiKey("Bearer nonsense"));
  ok("an over-long 'key' is refused rather than hashed", !isApiKey(API_KEY_PREFIX + "a".repeat(500)));
  ok("hashing is stable", hashApiKey(sample) === hashApiKey(sample));
  ok("different keys hash differently", hashApiKey(sample) !== hashApiKey(generateApiKey()));
  ok("the hash does not contain the key", !hashApiKey(sample).includes(sample.slice(4)));
  ok("a mask reveals only the last 4", maskApiKey(sample).endsWith(sample.slice(-4)) && maskApiKey(sample).length < 12);
  ok("an unnamed key is refused", validateKeyName("") !== null && validateKeyName("   ") !== null);
  ok("a novel-length name is refused", validateKeyName("x".repeat(200)) !== null);
  ok("an ordinary name is fine", validateKeyName("JARVIS") === null);

  // ---- minting ---------------------------------------------------------------
  section("minting");
  const unauth = await tokens.POST(req("/api/tokens", { method: "POST", body: { name: "nope" } }));
  ok("minting requires a session", unauth.status === 401);

  const minted = await tokens.POST(req("/api/tokens", { method: "POST", session: aliceSession, body: { name: "JARVIS" } }));
  ok("a signed-in athlete can mint", minted.status === 201);
  const mintedBody = await minted.json();
  const aliceKey: string = mintedBody.key;
  ok("the response carries the plaintext key", typeof aliceKey === "string" && aliceKey.startsWith(API_KEY_PREFIX));
  ok("the key it returns is usable-looking", isApiKey(aliceKey));
  ok("minting echoes the metadata too", mintedBody.keyInfo?.name === "JARVIS" && mintedBody.keyInfo?.scope === "read");
  ok("a minted key is read-scoped, never write", mintedBody.keyInfo?.scope === "read");

  const noName = await tokens.POST(req("/api/tokens", { method: "POST", session: aliceSession, body: {} }));
  ok("a key must be named", noName.status === 400);

  // ---- the key is shown exactly once -----------------------------------------
  section("shown exactly once");
  const listed = await tokens.GET(req("/api/tokens", { session: aliceSession }));
  const listBody = await listed.json();
  ok("the list comes back", listed.status === 200 && Array.isArray(listBody.keys));
  ok("it holds the key we minted", listBody.keys.some((k: { name: string }) => k.name === "JARVIS"));
  const listedJson = JSON.stringify(listBody);
  ok("THE RULE: the plaintext key never appears again", !listedJson.includes(aliceKey));
  ok("nor does its hash", !listedJson.includes(hashApiKey(aliceKey)));
  ok("no field called key/keyHash rides on a listed row", listBody.keys.every((k: Record<string, unknown>) => !("key" in k) && !("keyHash" in k)));
  ok("but there IS enough to tell keys apart", listBody.keys.every((k: { id?: string; createdAtISO?: string }) => !!k.id && !!k.createdAtISO));

  // The store is the last line: even reaching past the HTTP layer must not yield it.
  const rows = await store.listApiKeys(alice.id);
  ok("the store itself hands back no key material", !JSON.stringify(rows).includes(aliceKey));

  // ---- a valid key reads -------------------------------------------------------
  section("a valid key reads");
  const readRes = await state.GET(req("/api/state", { key: aliceKey }));
  ok("GET /api/state accepts the key", readRes.status === 200);
  const readBody = await readRes.json();
  ok("and returns the athlete's own plan", readBody.state?.plan?.secret === "ALICE-PLAN");
  ok("with the version, so a consumer can detect change", typeof readBody.version === "number");

  const touched = (await store.listApiKeys(alice.id)).find((k) => k.name === "JARVIS");
  ok("using a key records last_used_at", !!touched?.lastUsedAtISO);

  // ?meta=1 — the cheap "has anything changed?" poll, so a consumer doesn't pull
  // ~110KB of plan on every sync just to find out it's the same plan.
  const meta = await state.GET(req("/api/state?meta=1", { key: aliceKey }));
  const metaBody = await meta.json();
  ok("?meta=1 answers with the version", meta.status === 200 && metaBody.version === readBody.version);
  ok("and carries NO state", metaBody.state === undefined);
  // Fixed-size whatever the plan holds — that is the entire point. (These fixtures
  // are toy plans; a real 16-week 70.3 blob is ~110KB against this handful of bytes.)
  ok("only version + updatedAtISO ride on it", Object.keys(metaBody).sort().join() === "updatedAtISO,version");
  ok("so the payload stays tiny", JSON.stringify(metaBody).length < 120);

  // The version has to actually move on a write, or polling it is useless.
  const beforeVersion = metaBody.version;
  await store.setData(alice.id, { profile: { name: "alice" }, plan: { secret: "ALICE-PLAN" } });
  const meta2 = await state.GET(req("/api/state?meta=1", { key: aliceKey }));
  ok("the version moves when the plan changes", (await meta2.json()).version > beforeVersion);

  // A session must keep working exactly as before — this whole feature is additive.
  const sessionRead = await state.GET(req("/api/state", { session: aliceSession }));
  ok("a session still reads (nothing regressed)", sessionRead.status === 200);
  ok("and gets the same plan", (await sessionRead.json()).state?.plan?.secret === "ALICE-PLAN");

  // ---- THE LOAD-BEARING RULE: a key cannot write --------------------------------
  section("a bearer key CANNOT write");
  const write = await state.PUT(
    req("/api/state", { method: "PUT", key: aliceKey, body: { profile: {}, plan: { secret: "OVERWRITTEN" } } }),
  );
  ok("PUT /api/state refuses an API key", write.status === 403);
  ok("and says why, without naming the key", !JSON.stringify(await write.json()).includes(aliceKey));

  const after = await store.getData(alice.id);
  ok("THE POINT: the plan is untouched", (after.plan as { secret: string }).secret === "ALICE-PLAN");

  // A key must not be able to escalate by minting or revoking either — a read
  // credential that can issue credentials is a write credential.
  const mintWithKey = await tokens.POST(req("/api/tokens", { method: "POST", key: aliceKey, body: { name: "escalation" } }));
  ok("an API key cannot mint another key", mintWithKey.status === 403);
  const listWithKey = await tokens.GET(req("/api/tokens", { key: aliceKey }));
  ok("an API key cannot even list keys", listWithKey.status === 403);
  const revokeWithKey = await tokenById.DELETE(req(`/api/tokens/${touched!.id}`, { method: "DELETE", key: aliceKey }), {
    params: Promise.resolve({ id: touched!.id }),
  });
  ok("an API key cannot revoke a key", revokeWithKey.status === 403);

  // Belt and braces: presenting a VALID session alongside the key must still be
  // refused. Fail closed — a request waving a read-only credential doesn't get to
  // write because it also brought a cookie.
  const both = await state.PUT(
    reqCookie("/api/state", "PUT", aliceSession, { profile: {}, plan: { secret: "SNEAKY" } }, aliceKey),
  );
  ok("session + key together is still refused", both.status === 403);
  ok("and the plan is still untouched", ((await store.getData(alice.id)).plan as { secret: string }).secret === "ALICE-PLAN");

  // The session path itself must still write, or the check above is over-broad and
  // this feature has quietly broken the web app.
  const sessionWrite = await state.PUT(
    reqCookie("/api/state", "PUT", aliceSession, { profile: { name: "alice" }, plan: { secret: "ALICE-PLAN" } }),
  );
  ok("a plain session CAN still write", sessionWrite.status === 200);

  // ---- user A's key cannot read user B ------------------------------------------
  section("keys are scoped to their owner");
  const crossRead = await state.GET(req("/api/state", { key: aliceKey }));
  ok("alice's key reads alice", (await crossRead.json()).state?.plan?.secret === "ALICE-PLAN");

  const bobMint = await tokens.POST(req("/api/tokens", { method: "POST", session: bobSession, body: { name: "bob-key" } }));
  const bobKey: string = (await bobMint.json()).key;
  const bobRead = await state.GET(req("/api/state", { key: bobKey }));
  ok("THE ISOLATION: bob's key reads bob, never alice", (await bobRead.json()).state?.plan?.secret === "BOB-PLAN");

  const bobSeesAlice = await tokens.GET(req("/api/tokens", { session: bobSession }));
  const bobKeys = (await bobSeesAlice.json()).keys as { name: string }[];
  ok("bob's key list holds none of alice's", bobKeys.every((k) => k.name !== "JARVIS"));

  // Revoking across accounts must fail — a key id is not a capability.
  const crossRevoke = await tokenById.DELETE(req(`/api/tokens/${touched!.id}`, { method: "DELETE", session: bobSession }), {
    params: Promise.resolve({ id: touched!.id }),
  });
  ok("bob cannot revoke alice's key", crossRevoke.status === 404);
  const stillLive = await state.GET(req("/api/state", { key: aliceKey }));
  ok("and it is provably still alive", stillLive.status === 200);

  // ---- a revoked key 401s ---------------------------------------------------------
  section("revocation");
  const revoke = await tokenById.DELETE(req(`/api/tokens/${touched!.id}`, { method: "DELETE", session: aliceSession }), {
    params: Promise.resolve({ id: touched!.id }),
  });
  ok("the owner can revoke", revoke.status === 200);

  const dead = await state.GET(req("/api/state", { key: aliceKey }));
  ok("THE BUG THIS PREVENTS: a revoked key no longer reads", dead.status === 401);

  const stillListed = (await store.listApiKeys(alice.id)).find((k) => k.id === touched!.id);
  ok("a revoked key stays visible, marked dead", !!stillListed?.revokedAtISO);

  const doubleRevoke = await tokenById.DELETE(req(`/api/tokens/${touched!.id}`, { method: "DELETE", session: aliceSession }), {
    params: Promise.resolve({ id: touched!.id }),
  });
  ok("revoking twice is a 404, not a second success", doubleRevoke.status === 404);

  // Revocation is per-key, not per-account: bob's key was never involved.
  ok("revoking one key leaves the others alive", (await state.GET(req("/api/state", { key: bobKey }))).status === 200);

  // ---- forged and malformed keys ---------------------------------------------------
  section("forgery");
  ok("a made-up tri_ key is rejected", (await state.GET(req("/api/state", { key: `${API_KEY_PREFIX}${"a".repeat(43)}` }))).status === 401);
  ok("a truncated real key is rejected", (await state.GET(req("/api/state", { key: bobKey.slice(0, -4) }))).status === 401);
  ok("a key with one character changed is rejected", (await state.GET(req("/api/state", {
    key: bobKey.slice(0, -1) + (bobKey.endsWith("A") ? "B" : "A"),
  }))).status === 401);
  ok("no credential at all is 401", (await state.GET(req("/api/state"))).status === 401);

  // A key is not a session: it must not open anything a session opens beyond reads.
  ok("a key does not authenticate as a session token", (await state.GET(req("/api/state", { session: `${API_KEY_PREFIX}fake` }))).status === 401);

  // ---- account deletion takes keys with it -------------------------------------------
  section("erasure");
  const doomed = await store.createUser(`doomed_${Date.now()}`, "scrypt$x$y");
  const doomedSession = createSessionToken(doomed.id);
  await store.setData(doomed.id, { profile: {}, plan: { secret: "DOOMED" } });
  const doomedKey: string = (await (
    await tokens.POST(req("/api/tokens", { method: "POST", session: doomedSession, body: { name: "temp" } }))
  ).json()).key;
  ok("the key works before erasure", (await state.GET(req("/api/state", { key: doomedKey }))).status === 200);
  await store.deleteUser(doomed.id);
  ok("GDPR erasure kills the key too", (await state.GET(req("/api/state", { key: doomedKey }))).status === 401);

  // ---- the cap ------------------------------------------------------------------------
  section("bounds");
  const capped = await store.createUser(`capped_${Date.now()}`, "scrypt$x$y");
  const cappedSession = createSessionToken(capped.id);
  let lastStatus = 0;
  for (let i = 0; i < MAX_API_KEYS + 1; i++) {
    const r = await tokens.POST(req("/api/tokens", { method: "POST", session: cappedSession, body: { name: `k${i}` } }));
    lastStatus = r.status;
  }
  ok(`the ${MAX_API_KEYS}-key cap holds`, lastStatus === 409);
  ok("and the store agrees", (await store.countLiveApiKeys(capped.id)) === MAX_API_KEYS);

  const oldest = (await store.listApiKeys(capped.id)).slice(-1)[0];
  await tokenById.DELETE(req(`/api/tokens/${oldest.id}`, { method: "DELETE", session: cappedSession }), {
    params: Promise.resolve({ id: oldest.id }),
  });
  const afterRevoke = await tokens.POST(req("/api/tokens", { method: "POST", session: cappedSession, body: { name: "replacement" } }));
  ok("revoking frees a slot (revoked keys don't count)", afterRevoke.status === 201);

  console.log(`\n✅ tokens: ${pass} assertions passed\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
