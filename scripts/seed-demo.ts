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
  createdAtISO: new Date().toISOString(),
};

async function main() {
  const plan = generatePlan(profile);
  // Make the demo athlete look ON-TRACK for the App Store screenshots: mark every session
  // up to today as completed (so no "you missed sessions / ease off" nudge, and Progress
  // shows a streak + banked volume instead of an empty shell).
  const today = new Date().toISOString().slice(0, 10);
  let done = 0;
  for (const w of Object.values(plan.workouts)) {
    if (w.date <= today && w.discipline !== "rest") {
      w.status = "done";
      w.actualDurationSec = w.estDurationSec;
      if (w.estDistanceM) w.actualDistanceM = w.estDistanceM;
      w.rpe = 5;
      done++;
    }
  }
  console.log("generated plan:", plan.weeks.length, "weeks,", Object.keys(plan.workouts).length, "workouts;", done, "marked done through", today);

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
