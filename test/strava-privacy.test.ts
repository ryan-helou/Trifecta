/* Strava API Policy guards: §2.3 (owner-only display), §5.4 (derived data is still
   Strava Data), §5.3 (no ingestion into an LLM context), §6.2 (7-day retention).
   These are the paths by which Strava data reached somebody other than its owner,
   a model, or long-term storage. Pure — no network, no DB. */
import {
  STRAVA_RETENTION_DAYS,
  coachSafeTitle,
  isStravaSourced,
  purgeExpiredStravaData,
  withoutStravaSourced,
} from "../lib/stravaPrivacy";
import { feedItemsFor, publicCard } from "../lib/social";
import { decryptToken, encryptToken } from "../lib/tokenCrypto";
import type { Plan, Workout } from "../lib/types";

let pass = 0, fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (ok) pass++; else fail++;
}

const TODAY = "2026-08-20";
const old = "2026-08-01";  // well past the 7-day window
const fresh = "2026-08-18"; // inside it

function w(id: string, date: string, source: "strava" | "manual" | "healthkit", title = "Easy run"): Workout {
  return {
    id, date, weekIndex: 0, dayIndex: 0, discipline: "run", type: "endurance",
    title, purpose: "", segments: [], estDurationSec: 1800, primaryZone: 2,
    status: "done", actualDurationSec: 1800, actualDistanceM: 5000,
    actuals: { source, activityId: 1, durationSec: 1800, distanceM: 5000, startedAtISO: `${date}T07:00:00Z` },
  } as unknown as Workout;
}
const planOf = (...ws: Workout[]) =>
  ({ workouts: Object.fromEntries(ws.map((x) => [x.id, x])), weeks: [], profile: {} } as unknown as Plan);

console.log("\n§2.3/§5.4 — another athlete never sees Strava-derived data");
{
  const plan = planOf(w("s", fresh, "strava", "Morning Run"), w("m", fresh, "manual"), w("h", fresh, "healthkit"));
  const safe = withoutStravaSourced(plan);
  eq("the Strava session stops counting as done", safe.workouts.s.status, "planned");
  eq("its Strava payload is gone", safe.workouts.s.actuals, undefined);
  eq("...including the measurements", [safe.workouts.s.actualDistanceM, safe.workouts.s.actualDurationSec], [undefined, undefined]);
  eq("a manual session is untouched", safe.workouts.m.status, "done");
  eq("an Apple Health session is untouched", safe.workouts.h.status, "done");

  const clean = planOf(w("m", fresh, "manual"));
  eq("no Strava rows means the same object back", withoutStravaSourced(clean) === clean, true);
}

console.log("\n§2.3 — publicCard leaks nothing Strava-derived to others");
{
  // The specific leak: a synced session's title IS the Strava activity's own name,
  // and it was being shown on other people's feed cards.
  const data = { profile: { level: "intermediate" }, plan: planOf(w("s", fresh, "strava", "Morning Run")) };
  const mine = publicCard("ryan", data, TODAY, true);
  const theirs = publicCard("ryan", data, TODAY, false);

  eq("I still see my own Strava session", mine.latest?.title, "Morning Run");
  eq("someone else sees no latest session at all", theirs.latest, undefined);
  eq("and it isn't counted in their week", theirs.weekDone, 0);
  eq("my own week still counts it", mine.weekDone, 1);
  // isSelf defaults to false so a caller that forgets the flag fails closed.
  eq("the default is the safe one", publicCard("ryan", data, TODAY).latest, undefined);
}

console.log("\n§2.3/§5.4 — the session feed (#183) is the richest way to leak, and doesn't");
{
  // Comments and kudos made Friends a real feed carrying full session detail:
  // distance, pace, the athlete's note. Every one of those is "derived from"
  // Strava Data for a synced session, so the guard has to hold here or the
  // richer feed becomes the leak.
  const data = { profile: { level: "intermediate" }, plan: planOf(
    w("s", fresh, "strava", "Morning Run"),
    w("m", fresh, "manual", "Easy Aerobic Run"),
  ) };

  const theirs = feedItemsFor("ryan", data, TODAY);
  eq("another athlete sees only the non-Strava session", theirs.map((i) => i.title), ["Easy Aerobic Run"]);
  eq("no Strava distance reaches them", theirs.some((i) => i.workoutId === "s"), false);
  eq("...and no pace derived from one", theirs.every((i) => i.workoutId !== "s"), true);

  // isSelf mirrors publicCard: owner-only display is what §2.3 permits, and
  // without it a Strava athlete's own feed would be empty of their own training.
  const mine = feedItemsFor("ryan", data, TODAY, 5, true);
  eq("I still see my own Strava session", mine.some((i) => i.workoutId === "s"), true);
  // The flag defaults to the SAFE value, so a caller that forgets it fails closed.
  eq("the default is the safe one", feedItemsFor("ryan", data, TODAY).some((i) => i.workoutId === "s"), false);
}

console.log("\n§6.2 — Strava measurements expire after 7 days");
{
  eq("the window is 7 days", STRAVA_RETENTION_DAYS, 7);
  const plan = planOf(w("oldS", old, "strava"), w("newS", fresh, "strava"), w("oldM", old, "manual"));
  const swept = purgeExpiredStravaData(plan, TODAY);

  eq("expired Strava payload is dropped", swept.workouts.oldS.actuals, undefined);
  eq("...and its measurements with it", [swept.workouts.oldS.actualDistanceM, swept.workouts.oldS.actualDurationSec], [undefined, undefined]);
  // Our own record that the athlete trained is not Strava's to take back.
  eq("but the session stays completed", swept.workouts.oldS.status, "done");
  eq("a recent Strava session is kept whole", swept.workouts.newS.actuals?.distanceM, 5000);
  eq("an old MANUAL session is untouched", swept.workouts.oldM.actuals?.distanceM, 5000);

  eq("nothing expired means the same object back", purgeExpiredStravaData(planOf(w("newS", fresh, "strava")), TODAY) !== null, true);
}

console.log("\n§5.3 — no Strava-authored text reaches the model");
{
  eq("a Strava activity name is replaced", coachSafeTitle(w("s", fresh, "strava", "Morning Run")), "Run session");
  eq("an engine-written title passes through", coachSafeTitle(w("m", fresh, "manual", "Threshold 3x10")), "Threshold 3x10");
  eq("isStravaSourced is the discriminator", [isStravaSourced(w("a", fresh, "strava")), isStravaSourced(w("b", fresh, "manual"))], [true, false]);
}

console.log("\n§8.1 — OAuth tokens are encrypted at rest");
{
  process.env.TOKEN_ENC_KEY = "test-key-not-a-real-secret";
  const secret = "a1b2c3d4e5f6";
  const sealed = encryptToken(secret);
  eq("the stored value is not the token", sealed === secret, false);
  eq("it is tagged as our envelope", sealed.startsWith("enc:v1:"), true);
  eq("it round-trips", decryptToken(sealed), secret);
  eq("two encryptions differ (random IV)", encryptToken(secret) === encryptToken(secret), false);
  // the half-migrated table: rows written before this shipped are plaintext
  eq("a legacy plaintext row still reads", decryptToken(secret), secret);
  // authenticated: a tampered row must not yield a usable token
  eq("a tampered row fails closed", decryptToken(sealed.slice(0, -4) + "AAAA"), "");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
