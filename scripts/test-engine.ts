import { generatePlan } from "../lib/planEngine";
import { Profile } from "../lib/types";
import { fmtDuration } from "../lib/format";

function mk(over: Partial<Profile>): Profile {
  const race = new Date();
  race.setDate(race.getDate() + 7 * (over as any).__weeks || 7 * 20);
  return {
    username: "test",
    raceType: "half",
    raceDateISO: race.toISOString().slice(0, 10),
    level: "intermediate",
    workoutsPerWeek: 6,
    createdAtISO: new Date().toISOString(),
    ...over,
  };
}

function raceInWeeks(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n * 7 + 3);
  return d.toISOString().slice(0, 10);
}

const scenarios: { name: string; p: Profile }[] = [
  { name: "70.3 intermediate 6w 20wk", p: mk({ raceType: "half", raceDateISO: raceInWeeks(20), workoutsPerWeek: 6, runPR: { distanceM: 21097, timeSec: 5700, label: "HM" }, swimPR: { distanceM: 400, timeSec: 400, label: "400" }, ftp: 230 }) },
  { name: "Ironman beginner 5w 28wk", p: mk({ raceType: "full", level: "beginner", raceDateISO: raceInWeeks(28), workoutsPerWeek: 5 }) },
  { name: "Olympic advanced 7w 12wk", p: mk({ raceType: "olympic", level: "advanced", raceDateISO: raceInWeeks(12), workoutsPerWeek: 7 }) },
  { name: "Olympic beginner 3w 10wk", p: mk({ raceType: "olympic", level: "beginner", raceDateISO: raceInWeeks(10), workoutsPerWeek: 3 }) },
  { name: "70.3 compressed 6wk", p: mk({ raceType: "half", raceDateISO: raceInWeeks(6), workoutsPerWeek: 6 }) },
  { name: "Ironman delayed 40wk", p: mk({ raceType: "full", raceDateISO: raceInWeeks(40), workoutsPerWeek: 6 }) },
  { name: "Custom 4w", p: mk({ raceType: "custom", custom: { swimM: 1000, bikeM: 60000, runM: 15000, name: "Local Tri" }, raceDateISO: raceInWeeks(16), workoutsPerWeek: 4 }) },
  // range extremes for the new 1–21 workouts/week model
  { name: "Minimal 1/wk", p: mk({ raceType: "olympic", raceDateISO: raceInWeeks(16), workoutsPerWeek: 1 }) },
  { name: "Light 2/wk", p: mk({ raceType: "olympic", raceDateISO: raceInWeeks(16), workoutsPerWeek: 2 }) },
  { name: "High 10/wk", p: mk({ raceType: "full", raceDateISO: raceInWeeks(24), workoutsPerWeek: 10 }) },
  { name: "Doubles 14/wk", p: mk({ raceType: "full", level: "advanced", raceDateISO: raceInWeeks(24), workoutsPerWeek: 14 }) },
  { name: "Max 21/wk", p: mk({ raceType: "full", level: "elite", raceDateISO: raceInWeeks(28), workoutsPerWeek: 21 }) },
  { name: "Rest-day pref 8/wk (Mon off)", p: mk({ raceType: "half", raceDateISO: raceInWeeks(18), workoutsPerWeek: 8, restDayPreference: 0 }) },
  // ---- deep-personalization scenarios ----
  { name: "Per-sport 3/2/4 + strength full 2×", p: mk({ raceType: "half", raceDateISO: raceInWeeks(18), perSport: { swim: 3, bike: 2, run: 4 }, strength: { enabled: true, daysPerWeek: 2, split: "full" } }) },
  { name: "Strength PPL 3× (advanced)", p: mk({ raceType: "full", level: "advanced", raceDateISO: raceInWeeks(24), perSport: { swim: 2, bike: 3, run: 3 }, strength: { enabled: true, daysPerWeek: 3, split: "push-pull-legs" } }) },
  { name: "Injury: moderate knee (run+bike)", p: mk({ raceType: "half", raceDateISO: raceInWeeks(18), perSport: { swim: 2, bike: 3, run: 3 }, injuries: [{ id: "i1", area: "left knee", disciplines: ["run", "bike"], severity: "moderate" }] }) },
  { name: "Injury: severe run (substitute)", p: mk({ raceType: "half", raceDateISO: raceInWeeks(18), perSport: { swim: 2, bike: 3, run: 3 }, injuries: [{ id: "i2", area: "achilles", disciplines: ["run"], severity: "severe" }] }) },
  { name: "Injury: niggle shoulder (swim)", p: mk({ raceType: "olympic", raceDateISO: raceInWeeks(14), perSport: { swim: 3, bike: 2, run: 2 }, injuries: [{ id: "i3", area: "right shoulder", disciplines: ["swim"], severity: "niggle" }] }) },
  { name: "Blackout: week 3 off", p: mk({ raceType: "half", raceDateISO: raceInWeeks(18), perSport: { swim: 2, bike: 3, run: 3 }, blackouts: [{ startISO: raceInWeeks(3), endISO: raceInWeeks(4), label: "Holiday" }] }) },
  { name: "Focus: swim limiter", p: mk({ raceType: "half", raceDateISO: raceInWeeks(18), workoutsPerWeek: 8, focusDiscipline: "swim" }) },
  // ---- equipment scenarios ----
  { name: "No pool (dryland swim)", p: mk({ raceType: "olympic", raceDateISO: raceInWeeks(14), perSport: { swim: 3, bike: 2, run: 2 }, equipment: { pool: false, trainer: true, gym: true } }) },
  { name: "No gym (home strength, PPL)", p: mk({ raceType: "half", raceDateISO: raceInWeeks(18), perSport: { swim: 2, bike: 3, run: 3 }, strength: { enabled: true, daysPerWeek: 3, split: "push-pull-legs" }, equipment: { pool: true, trainer: true, gym: false } }) },
];

let problems = 0;
for (const { name, p } of scenarios) {
  const plan = generatePlan(p);
  console.log(`\n=== ${name} ===`);
  console.log(`weeks=${plan.totalWeeks} start=${plan.startDateISO} race=${plan.raceDateISO} compressed=${plan.compressed} delayed=${plan.delayedStart}`);
  const phaseCounts: Record<string, number> = {};
  let totalWk = 0;
  for (const wk of plan.weeks) {
    phaseCounts[wk.phase] = (phaseCounts[wk.phase] ?? 0) + 1;
    totalWk += wk.workoutIds.length;
    // per-week checks
    let wkHours = 0;
    const days = new Set<number>();
    for (const id of wk.workoutIds) {
      const w = plan.workouts[id];
      if (!w) { console.log(`  !! missing workout ${id}`); problems++; continue; }
      if (w.estDurationSec != null && (isNaN(w.estDurationSec) || w.estDurationSec < 0)) { console.log(`  !! bad duration ${id} = ${w.estDurationSec}`); problems++; }
      if (w.estDistanceM != null && isNaN(w.estDistanceM)) { console.log(`  !! bad distance ${id}`); problems++; }
      if (!w.segments || w.segments.length === 0) { console.log(`  !! no segments ${id}`); problems++; }
      wkHours += (w.estDurationSec || 0) / 3600;
      days.add(w.dayIndex);
    }
    // structural checks for the workouts/week model
    const perDay = new Map<number, number>();
    const hardPerDay = new Map<number, number>();
    const restPref = p.restDayPreference;
    for (const id of wk.workoutIds) {
      const w = plan.workouts[id];
      if (!w) continue;
      perDay.set(w.dayIndex, (perDay.get(w.dayIndex) ?? 0) + 1);
      if ((w.primaryZone ?? 0) >= 4) hardPerDay.set(w.dayIndex, (hardPerDay.get(w.dayIndex) ?? 0) + 1);
    }
    for (const [d, c] of perDay) if (c > 3) { console.log(`  !! ${wk.label}: ${c} sessions on day ${d} (>3)`); problems++; }
    for (const [d, c] of hardPerDay) if (c > 1) { console.log(`  !! ${wk.label}: ${c} hard (Z4+) on day ${d}`); problems++; }
    if (new Set(wk.workoutIds).size !== wk.workoutIds.length) { console.log(`  !! ${wk.label}: duplicate workout ids`); problems++; }
    // rest-day preference honoured whenever the other 6 days can hold the load (≤18)
    if (restPref != null && !wk.isRaceWeek && wk.workoutIds.length <= 18 && perDay.get(restPref)) {
      console.log(`  !! ${wk.label}: session on preferred rest day ${restPref}`); problems++;
    }
    // injury intensity caps: affected disciplines never exceed their zone ceiling
    for (const inj of p.injuries ?? []) {
      const cap = inj.severity === "niggle" ? 3 : 2;
      for (const id of wk.workoutIds) {
        const w = plan.workouts[id];
        if (!w || w.type === "race_prep") continue; // race week openers/race are special
        if (inj.disciplines.includes(w.discipline) && (w.primaryZone ?? 0) > cap) {
          console.log(`  !! ${wk.label}: ${w.discipline} "${w.title}" Z${w.primaryZone} exceeds injury cap Z${cap} (${inj.area})`); problems++;
        }
      }
    }
  }
  // blackout dates: no non-race sessions land inside a blocked-out range
  for (const b of p.blackouts ?? []) {
    for (const w of Object.values(plan.workouts)) {
      if (w.type === "race_prep") continue;
      if (w.date >= b.startISO && w.date <= b.endISO) { console.log(`  !! session ${w.id} on blackout day ${w.date}`); problems++; }
    }
  }
  // equipment: no pool ⇒ swims are dry-land only; no gym ⇒ strength is home/core
  if (p.equipment?.pool === false) {
    for (const w of Object.values(plan.workouts)) {
      if (w.type === "race_prep") continue;
      if (w.discipline === "swim" && !/dryland/i.test(w.title)) { console.log(`  !! no-pool but water swim "${w.title}"`); problems++; }
    }
  }
  if (p.equipment?.gym === false && p.strength?.enabled) {
    for (const w of Object.values(plan.workouts)) {
      if (w.discipline === "strength" && !/home|core/i.test(w.title)) { console.log(`  !! no-gym but gym strength "${w.title}"`); problems++; }
    }
  }
  console.log(`  phases: ${JSON.stringify(phaseCounts)}  totalWorkouts=${totalWk}`);
  // print week 0, a build week, race week detail
  const sample = [plan.weeks[0], plan.weeks[Math.floor(plan.totalWeeks * 0.6)], plan.weeks[plan.totalWeeks - 1]];
  for (const wk of sample) {
    if (!wk) continue;
    const actual = wk.workoutIds.reduce((a, id) => a + (plan.workouts[id].estDurationSec || 0), 0) / 3600;
    console.log(`  [${wk.label}] target=${wk.targetHours}h actual=${actual.toFixed(1)}h  sessions=${wk.workoutIds.length}`);
    for (const id of wk.workoutIds) {
      const w = plan.workouts[id];
      console.log(`     d${w.dayIndex} ${w.discipline.padEnd(8)} ${w.title.padEnd(28)} ${fmtDuration(w.estDurationSec)}${w.estDistanceM ? " · " + (w.estDistanceM / 1000).toFixed(1) + "km" : ""} Z${w.primaryZone}`);
    }
  }
}
console.log(`\n\n${problems === 0 ? "✅ NO PROBLEMS" : "❌ " + problems + " PROBLEMS"}`);
