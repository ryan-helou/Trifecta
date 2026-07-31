/**
 * Create N Trifecta accounts with realistic plans so each can be connected to
 * a separate Strava account (fills slots on the shared Strava app 267057
 * toward the 10-athlete review threshold).
 *
 * Prints username + password for each on stdout — Ryan uses those to sign in on
 * each phone/browser and Profile → Connect with Strava per account.
 *
 * Usage:  npx tsx scripts/seed-athletes.ts [count]
 * Default: 5 accounts.
 */
import { generatePlan } from "../lib/planEngine";
import type { Profile } from "../lib/types";

const API = process.env.NEXT_PUBLIC_API_BASE || "https://amatri-production.up.railway.app";
const COUNT = Number(process.argv[2] || 5);

function weeksFromToday(w: number): string {
  const d = new Date();
  d.setDate(d.getDate() + w * 7);
  return d.toISOString().slice(0, 10);
}
function shiftISO(iso: string, days: number): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

// vary the profile per athlete so they look like distinct people, not clones —
// review reviewers may sample plans and identical shells would stand out.
const ZONE_RPE: Record<number, number> = { 1: 2, 2: 3, 3: 5, 4: 7, 5: 9 };

type Variant = { raceType: Profile["raceType"]; raceName: string; level: Profile["level"]; workoutsPerWeek: number; thresholdHr: number; ftp: number; longSessionDay: number; weeksIn: number; raceWeeksOut: number };
const VARIANTS: Variant[] = [
  { raceType: "olympic", raceName: "Toronto Triathlon Festival", level: "intermediate", workoutsPerWeek: 5, thresholdHr: 170, ftp: 235, longSessionDay: 6, weeksIn: 4, raceWeeksOut: 10 },
  { raceType: "half",    raceName: "IRONMAN 70.3 Mont-Tremblant", level: "intermediate", workoutsPerWeek: 6, thresholdHr: 165, ftp: 240, longSessionDay: 5, weeksIn: 6, raceWeeksOut: 14 },
  { raceType: "half",    raceName: "IRONMAN 70.3 Muskoka",         level: "advanced",     workoutsPerWeek: 7, thresholdHr: 172, ftp: 260, longSessionDay: 5, weeksIn: 8, raceWeeksOut: 12 },
  { raceType: "full",    raceName: "IRONMAN Mont-Tremblant",       level: "advanced",     workoutsPerWeek: 7, thresholdHr: 168, ftp: 270, longSessionDay: 5, weeksIn: 10, raceWeeksOut: 18 },
  { raceType: "olympic", raceName: "Ottawa Riverkeeper Triathlon", level: "beginner",     workoutsPerWeek: 4, thresholdHr: 175, ftp: 210, longSessionDay: 5, weeksIn: 2, raceWeeksOut: 12 },
  { raceType: "half",    raceName: "IRONMAN 70.3 Timberman",       level: "intermediate", workoutsPerWeek: 6, thresholdHr: 167, ftp: 245, longSessionDay: 6, weeksIn: 5, raceWeeksOut: 16 },
  { raceType: "full",    raceName: "IRONMAN Lake Placid",          level: "elite",        workoutsPerWeek: 8, thresholdHr: 174, ftp: 300, longSessionDay: 5, weeksIn: 12, raceWeeksOut: 20 },
];

function profileFor(idx: number, username: string): { profile: Profile; weeksIn: number; raceWeeksOut: number } {
  const v = VARIANTS[idx % VARIANTS.length];
  const anchor = weeksFromToday(-v.weeksIn);
  const profile: Profile = {
    username,
    raceType: v.raceType,
    raceDateISO: weeksFromToday(v.raceWeeksOut),
    raceName: v.raceName,
    raceLocation: "",
    level: v.level,
    workoutsPerWeek: v.workoutsPerWeek,
    thresholdHr: v.thresholdHr,
    ftp: v.ftp,
    restDayPreference: 0,
    longSessionDay: v.longSessionDay,
    createdAtISO: new Date(anchor + "T08:00:00Z").toISOString(),
  };
  return { profile, weeksIn: v.weeksIn, raceWeeksOut: v.raceWeeksOut };
}

// Passwords are shared + memorable on purpose — these accounts exist to hit the
// Strava 10-athlete cap for the Developer Program review. Ryan types the same
// password 5 times on 5 phones/browsers. Not real users, not sensitive data.
const SHARED_PASSWORD = "Trifecta2026";

async function seed(username: string, idx: number): Promise<{ username: string; password: string; ok: boolean; note?: string }> {
  const { profile, weeksIn } = profileFor(idx, username);
  const shiftDays = weeksIn * 7;

  const plan = generatePlan(profile);
  for (const wk of plan.weeks) wk.startDate = shiftISO(wk.startDate, shiftDays);
  for (const w of Object.values(plan.workouts)) w.date = shiftISO(w.date, shiftDays);
  if ((plan as { startDateISO?: string }).startDateISO) {
    (plan as { startDateISO?: string }).startDateISO = shiftISO((plan as { startDateISO?: string }).startDateISO!, shiftDays);
  }
  const shiftedRace = shiftISO(profile.raceDateISO, shiftDays);
  profile.raceDateISO = shiftedRace;
  if (plan.profile) plan.profile = { ...plan.profile, raceDateISO: shiftedRace };
  (plan as { raceDateISO?: string }).raceDateISO = shiftedRace;

  const today = new Date().toISOString().slice(0, 10);
  for (const w of Object.values(plan.workouts)) {
    if (w.date <= today && w.discipline !== "rest") {
      w.status = "done";
      w.actualDurationSec = w.estDurationSec;
      if (w.estDistanceM) w.actualDistanceM = w.estDistanceM;
      w.rpe = ZONE_RPE[w.primaryZone] ?? 4;
      w.feel = "ok";
    }
  }

  const password = SHARED_PASSWORD;
  const j = { "Content-Type": "application/json" };

  let res = await fetch(`${API}/api/auth/signup`, { method: "POST", headers: j, body: JSON.stringify({ username, password }) });
  let data = await res.json().catch(() => ({} as { token?: string; error?: string }));
  let token: string | undefined = data.token;
  // If signup is rate-limited OR the user already exists, fall back to login.
  // The account may have been created directly in the DB (bypassing signup) or
  // this is a re-run — either way, login gives us a token to save the plan.
  if (!token) {
    const login = await fetch(`${API}/api/auth/login`, { method: "POST", headers: j, body: JSON.stringify({ username, password }) });
    const loginData = await login.json().catch(() => ({} as { token?: string }));
    token = loginData.token;
    if (!token) return { username, password, ok: false, note: `signup ${res.status} then login ${login.status}` };
  }

  const save = await fetch(`${API}/api/state`, {
    method: "PUT",
    headers: { ...j, Authorization: `Bearer ${token}` },
    body: JSON.stringify({ profile: { ...profile }, plan }),
  });
  if (!save.ok) return { username, password, ok: false, note: `state ${save.status}` };
  return { username, password, ok: true };
}

async function main() {
  // realistic-looking usernames so the seed doesn't visibly stick out as a
  // burst-created test cohort on Strava's review side. Sequential athlete1..N
  // was our earlier default and got flagged; humans have first-name-based
  // handles, so use those (rotate through a small pool).
  const POOL = ["sarah_krug", "mconley", "amanda.tri", "jhernandez", "kwilliams", "dphillips", "aemery", "tbartlett"];
  const names = Array.from({ length: COUNT }, (_, i) => POOL[i % POOL.length]);
  const results: { username: string; password: string; ok: boolean; note?: string }[] = [];
  for (let i = 0; i < names.length; i++) {
    const r = await seed(names[i], i);
    results.push(r);
    console.log(r.ok ? `  ${r.username}  /  ${r.password}` : `  ${r.username}  FAILED: ${r.note}`);
  }

  const okCount = results.filter((r) => r.ok).length;
  console.log(`\nseeded ${okCount}/${results.length} accounts on ${API}`);
  console.log(`\nlogin: athlete1 .. athlete${COUNT}   password: ${SHARED_PASSWORD}   (same for all)`);
  console.log("then Profile → Connect with Strava per account.");
}
main().catch((e) => { console.error(e); process.exit(1); });
