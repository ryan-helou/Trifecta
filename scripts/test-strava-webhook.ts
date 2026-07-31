/* Unit checks for the Strava webhook route (deauthorization + shape guards).
   Drives the exported POST handler directly against the in-memory store. */
import assert from "node:assert";
import { POST } from "../app/api/strava/webhook/route";
import { getStore } from "../lib/db";

let pass = 0;
const ok = (label: string, cond: boolean) => { assert.ok(cond, `FAILED: ${label}`); pass++; };

function reqWith(body: unknown, ip = "10.0.0.1") {
  return {
    headers: { get: (k: string) => (k.toLowerCase() === "x-forwarded-for" ? ip : null) },
    json: async () => body,
  } as unknown as Parameters<typeof POST>[0];
}

async function main() {
  const store = getStore();
  await store.init();

  // seed a connection to deauth
  const user = await store.createUser(`deauth_${Date.now()}`, "scrypt$x$y");
  const athleteId = 111111;
  await store.upsertStrava({
    userId: user.id,
    athleteId,
    accessToken: "at",
    refreshToken: "rt",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    scope: "read,activity:read_all",
  });
  ok("seeded conn exists", !!(await store.getStravaByUser(user.id)));

  // deauth event (Strava sends authorized as the STRING "false")
  const deauth = {
    object_type: "athlete",
    object_id: athleteId,
    aspect_type: "update",
    owner_id: athleteId,
    updates: { authorized: "false" },
  };
  const res = await POST(reqWith(deauth));
  ok("deauth returns 200", res.status === 200);
  ok("deauth dropped the connection", (await store.getStravaByUser(user.id)) === null);

  // idempotency: a second deauth on an already-gone connection is a no-op 200
  const res2 = await POST(reqWith(deauth));
  ok("second deauth still 200", res2.status === 200);

  // unrelated athlete deauth doesn't touch our other rows
  const other = await store.createUser(`other_${Date.now()}`, "scrypt$x$y");
  await store.upsertStrava({
    userId: other.id, athleteId: 222222,
    accessToken: "at", refreshToken: "rt",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  });
  const bogus = { object_type: "athlete", aspect_type: "update", owner_id: 999999, updates: { authorized: "false" } };
  await POST(reqWith(bogus));
  ok("unrelated deauth kept other conn", !!(await store.getStravaByUser(other.id)));

  // shape guards: authorized=true is NOT a deauth (e.g. re-auth event)
  await store.upsertStrava({
    userId: other.id, athleteId: 222222,
    accessToken: "at", refreshToken: "rt",
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  });
  await POST(reqWith({ object_type: "athlete", aspect_type: "update", owner_id: 222222, updates: { authorized: "true" } }));
  ok("authorized=true kept conn", !!(await store.getStravaByUser(other.id)));

  // athlete update WITHOUT authorized key is not a deauth either
  await POST(reqWith({ object_type: "athlete", aspect_type: "update", owner_id: 222222, updates: { profile: "changed" } }));
  ok("non-auth athlete update kept conn", !!(await store.getStravaByUser(other.id)));

  // malformed body: still 200 (never break the subscription)
  const bad = await POST(reqWith(null));
  ok("null body 200", bad.status === 200);
  const noOwner = await POST(reqWith({ object_type: "athlete", aspect_type: "update", updates: { authorized: "false" } }));
  ok("missing owner_id 200", noOwner.status === 200);
  ok("missing owner_id kept conn", !!(await store.getStravaByUser(other.id)));

  console.log(`\nStrava webhook: ${pass} passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
