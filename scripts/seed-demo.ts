/**
 * Seed a showcase account on the live API with a realistic generated plan, so the
 * App Store screenshot flow has a populated main app (Today/Plan/Progress) to capture.
 * Run: npx tsx scripts/seed-demo.ts
 */
import { generatePlan } from "../lib/planEngine";
import type { Profile } from "../lib/types";

const API = process.env.NEXT_PUBLIC_API_BASE || "https://amatri-production.up.railway.app";
const USER = "trifectademo";
const PASS = "demopass123";

function weeksFromToday(w: number): string {
  const d = new Date();
  d.setDate(d.getDate() + w * 7);
  return d.toISOString().slice(0, 10);
}

// The demo athlete is ~8 weeks INTO the plan (not on day one), so the app looks like a
// working product: a banked fitness curve, a fuller volume chart, a real streak. We do
// that by anchoring the plan 8 weeks in the past and putting race day 8 weeks out — today
// lands mid-plan. (The plan always runs anchor -> race; with anchor at "now" the athlete
// is forever week 1 with an empty Progress curve.)
const WEEKS_IN = 8;
const SHIFT_DAYS = WEEKS_IN * 7; // shift the whole plan this far into the past
const ANCHOR = weeksFromToday(-WEEKS_IN); // plan-created reference, 8 weeks ago

/** Subtract `days` from an ISO date (YYYY-MM-DD or full ISO), return YYYY-MM-DD. */
function shiftISO(iso: string, days: number): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// Realistic RPE per training zone so completed sessions read "on track" rather than
// "consistently overreaching" (a flat rpe=5 on easy Z1/Z2 work trips the ease-off nudge
// — strain = rpe - zoneMid — and stamps that banner on every screen). Within-band values
// keep avg strain ~0, so no false adaptation banner clutters the shots.
const ZONE_RPE: Record<number, number> = { 1: 2, 2: 3, 3: 5, 4: 7, 5: 9 };

const profile: Profile = {
  username: USER,
  raceType: "half",
  raceDateISO: weeksFromToday(16),
  raceName: "IRONMAN 70.3 Mont-Tremblant",
  raceLocation: "Mont-Tremblant, QC",
  level: "intermediate",
  workoutsPerWeek: 6,
  thresholdHr: 165,
  ftp: 240,
  restDayPreference: 0,
  longSessionDay: 5,
  createdAtISO: new Date(ANCHOR + "T08:00:00Z").toISOString(),
};

async function main() {
  const plan = generatePlan(profile);
  // The engine always starts a plan "today", so a fresh athlete is forever week 1 with an
  // empty Progress curve. To make the demo look like a working product mid-journey, uniformly
  // time-shift the whole plan 8 weeks into the past — every week, every workout, and the race
  // date move together — so "today" lands ~week 9 of 17 with real banked history behind it.
  for (const wk of plan.weeks) wk.startDate = shiftISO(wk.startDate, SHIFT_DAYS);
  for (const w of Object.values(plan.workouts)) w.date = shiftISO(w.date, SHIFT_DAYS);
  if ((plan as { startDateISO?: string }).startDateISO) {
    (plan as { startDateISO?: string }).startDateISO = shiftISO((plan as { startDateISO?: string }).startDateISO!, SHIFT_DAYS);
  }
  const shiftedRace = shiftISO(profile.raceDateISO, SHIFT_DAYS);
  profile.raceDateISO = shiftedRace;
  if (plan.profile) plan.profile = { ...plan.profile, raceDateISO: shiftedRace };
  // the Today race widget reads plan.raceDateISO (the plan's OWN top-level copy, not the
  // embedded profile), so it must move too or the countdown desyncs from the week position.
  (plan as { raceDateISO?: string }).raceDateISO = shiftedRace;

  // Mark every session BEFORE today as completed (so no "you missed sessions" nudge, and
  // Progress shows a streak + banked volume + a real fitness curve instead of an empty shell).
  //
  // Today's session is deliberately left OPEN. Completing it too makes the demo account
  // useless for the two things the App Store screenshots exist to show: a Today screen
  // with work still ahead of you, and the guided player — a finished session has no
  // "Start guided session" to tap. It also just reads better; nobody markets a rest state.
  const today = new Date().toISOString().slice(0, 10);
  let done = 0;
  for (const w of Object.values(plan.workouts)) {
    if (w.date < today && w.discipline !== "rest") {
      w.status = "done";
      w.actualDurationSec = w.estDurationSec;
      if (w.estDistanceM) w.actualDistanceM = w.estDistanceM;
      w.rpe = ZONE_RPE[w.primaryZone] ?? 4; // felt appropriate for the zone → strain ~0
      w.feel = "ok";
      done++;
    }
  }

  // The screenshot flow has to tap today's session by name, and that name changes with
  // the date. Print it so scripts/screenshots-ios.sh can pass it into Maestro instead of
  // hardcoding a title that silently stops matching tomorrow.
  const todaysSession = Object.values(plan.workouts).find(
    (w) => w.date === today && w.discipline !== "rest",
  );
  console.log("generated plan:", plan.weeks.length, "weeks,", Object.keys(plan.workouts).length, "workouts;", done, "marked done before", today);
  console.log("TODAY_SESSION=" + (todaysSession?.title ?? ""));

  const j = { "Content-Type": "application/json" };
  let res = await fetch(`${API}/api/auth/signup`, { method: "POST", headers: j, body: JSON.stringify({ username: USER, password: PASS }) });
  let data = await res.json().catch(() => ({}));
  let token: string | undefined = data.token;
  if (!res.ok || !token) {
    res = await fetch(`${API}/api/auth/login`, { method: "POST", headers: j, body: JSON.stringify({ username: USER, password: PASS }) });
    data = await res.json().catch(() => ({}));
    token = data.token;
  }
  if (!token) { console.error("could not get a token:", res.status, data); process.exit(1); }

  const save = await fetch(`${API}/api/state`, {
    method: "PUT",
    headers: { ...j, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ profile: { ...profile }, plan }),
  });
  console.log("PUT /api/state →", save.status);

  const me = await fetch(`${API}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
  const meData = await me.json().catch(() => ({}));
  console.log("me authenticated:", meData.authenticated, "| has plan:", !!meData.state?.plan, "| workouts:", meData.state?.plan ? Object.keys(meData.state.plan.workouts).length : 0);
  console.log(`\ndemo login: ${USER} / ${PASS}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
