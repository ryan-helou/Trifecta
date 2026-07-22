import { generatePlan, isFitnessGoal } from "../lib/planEngine";
import { Profile } from "../lib/types";
import { fmtDuration } from "../lib/format";
import { addDays } from "../lib/dates";
import { derivePaces } from "../lib/paces";
import { projectRace } from "../lib/predict";
import { calibratePaces } from "../lib/calibrate";
import { assessAdaptation, applyAdaptation } from "../lib/adapt";
import { logReadiness, readinessScore, READY_LOW } from "../lib/readiness";
import { flattenWorkout } from "../lib/workoutSteps";
import { buildWorkoutFit } from "../lib/fit";
import { publicCard, raceKeyOf } from "../lib/social";

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
  // ---- fitness mode (no race) — routes through the rolling-block generator ----
  { name: "Fitness explicit 6/wk", p: mk({ raceType: "fitness", raceDateISO: "", workoutsPerWeek: 6 }) },
  { name: "Fitness beginner 4/wk", p: mk({ raceType: "fitness", raceDateISO: "", level: "beginner", workoutsPerWeek: 4 }) },
  { name: "Fitness + injury (severe run)", p: mk({ raceType: "fitness", raceDateISO: "", perSport: { swim: 2, bike: 3, run: 3 }, injuries: [{ id: "if1", area: "achilles", disciplines: ["run"], severity: "severe" }] }) },
  { name: "Distance picked, no date → fitness", p: mk({ raceType: "half", raceDateISO: "", perSport: { swim: 2, bike: 3, run: 3 } }) },
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
// ===========================================================================
// TIER 1 — the adaptive loop (projection · calibration · adaptation · readiness)
// ===========================================================================
function check(cond: boolean, msg: string) {
  if (!cond) { console.log(`  !! FAIL: ${msg}`); problems++; }
  else console.log(`  ✓ ${msg}`);
}
const HARD = ["threshold", "vo2", "tempo", "brick"];

console.log("\n\n########## TIER 1: adaptive loop ##########");

// ---- race-time projection ----
console.log("\n=== projection ===");
{
  const p = mk({ raceType: "half", level: "beginner", raceDateISO: raceInWeeks(20), runPR: { distanceM: 21097, timeSec: 7200, label: "HM" }, ftp: 180 });
  const proj = projectRace(p);
  check(proj.currentSec > 0 && proj.projectedSec > 0, "both projected times are positive");
  check(proj.projectedSec <= proj.currentSec, "projected (with plan) ≤ current fitness");
  check(proj.gainSec >= 0, "gain ≥ 0");
  const near = projectRace({ ...p, raceDateISO: raceInWeeks(3) });
  check(near.gainFrac < proj.gainFrac, "fewer weeks to race → smaller modelled gain");
  console.log(`     current=${fmtDuration(proj.currentSec)} projected=${fmtDuration(proj.projectedSec)} gain=${fmtDuration(proj.gainSec)}`);
}

// ---- fitness mode: no race → a rolling base→build block, no peak/taper/race week ----
console.log("\n=== fitness mode (no race) ===");
{
  const p = mk({ raceType: "fitness", raceDateISO: "", perSport: { swim: 2, bike: 3, run: 3 } });
  check(isFitnessGoal(p), "raceType 'fitness' is a fitness goal");
  const plan = generatePlan(p);
  check(plan.raceDateISO === "", "fitness plan carries no race date");
  check(plan.totalWeeks === 12, `fitness block is 12 weeks (got ${plan.totalWeeks})`);
  const phases = new Set(plan.weeks.map((w) => w.phase));
  check(!phases.has("peak") && !phases.has("taper"), "no peak/taper phases in a fitness block");
  check(plan.weeks.every((w) => !w.isRaceWeek), "no race week in a fitness block");
  check(phases.has("base") && phases.has("build"), "fitness block has both base and build phases");
  check(!Object.values(plan.workouts).some((w) => w.type === "race_prep"), "no race_prep sessions in a fitness block");
  check(plan.weeks.every((w) => w.workoutIds.length > 0), "every fitness week has sessions");
  const proj = projectRace(p);
  check(proj.projectedSec === 0 && proj.gainSec === 0, "projectRace returns zeros for a fitness goal");
  // a distance picked but no date also routes to fitness
  const p2 = mk({ raceType: "half", raceDateISO: "" });
  check(isFitnessGoal(p2), "distance picked but no date → fitness goal");
  check(generatePlan(p2).raceDateISO === "" && generatePlan(p2).totalWeeks === 12, "no-date half becomes a rolling fitness block");
  // social card degrades gracefully (no daysOut, Fitness category)
  const card = publicCard("fit", { profile: plan.profile, plan }, addDays(plan.startDateISO, 3));
  check(card.race?.daysOut == null && card.race?.category === "Fitness", "fitness social card has no race countdown");
}

// ---- long-session day: long ride anchors on the chosen day, long run the day after ----
console.log("\n=== long-session day ===");
{
  const build = (longDay?: number) => {
    const plan = generatePlan(mk({ raceType: "half", raceDateISO: raceInWeeks(18), perSport: { swim: 2, bike: 3, run: 3 }, ...(longDay != null ? { longSessionDay: longDay } : {}) }));
    const wk = plan.weeks.find((w) => w.phase === "build" && !w.isRecovery) ?? plan.weeks[Math.floor(plan.totalWeeks * 0.6)];
    const ws = wk.workoutIds.map((id) => plan.workouts[id]);
    const bike = ws.filter((w) => w.discipline === "bike" || w.discipline === "brick").sort((a, b) => b.estDurationSec - a.estDurationSec)[0];
    const run = ws.filter((w) => w.discipline === "run").sort((a, b) => b.estDurationSec - a.estDurationSec)[0];
    return { bikeDay: bike?.dayIndex, runDay: run?.dayIndex };
  };
  const def = build(); // default Saturday (5)
  check(def.bikeDay === 5, `default long ride lands on Saturday (got d${def.bikeDay})`);
  check(def.runDay === 6, `default long run lands on Sunday (got d${def.runDay})`);
  const wed = build(2); // Wednesday
  check(wed.bikeDay === 2, `long ride follows longSessionDay=Wed (got d${wed.bikeDay})`);
  check(wed.runDay === 3, `long run lands the day after, Thu (got d${wed.runDay})`);
}

// ---- calibration: consistently-too-hard eases the run targets ----
console.log("\n=== calibration ===");
{
  const p = mk({ raceType: "half", raceDateISO: raceInWeeks(20), perSport: { swim: 2, bike: 2, run: 3 }, runPR: { distanceM: 10000, timeSec: 2700, label: "10k" } });
  const plan = generatePlan(p);
  const today = addDays(plan.startDateISO, 21);
  let n = 0;
  for (const w of Object.values(plan.workouts)) {
    if (w.date < today && w.discipline === "run") { w.status = "done"; w.rpe = 10; w.feel = "rough"; n++; }
  }
  check(n >= 3, `set up ${n} hot run sessions`);
  const res = calibratePaces(plan, today);
  check(!!res && res.changed, "calibration produced a change");
  check((res?.calibration.run ?? 0) < 0, "run eased (adj < 0) when sessions ran hot");
  const basePace = derivePaces(p).run.thresholdSecPerKm;
  const calPace = derivePaces({ ...p, calibration: res!.calibration }).run.thresholdSecPerKm;
  check(calPace > basePace, "eased run threshold pace is slower (higher sec/km)");
}
// ---- calibration: strong & easy sharpens ----
{
  const p = mk({ raceType: "half", raceDateISO: raceInWeeks(20), perSport: { swim: 2, bike: 2, run: 3 }, runPR: { distanceM: 10000, timeSec: 2700, label: "10k" } });
  const plan = generatePlan(p);
  const today = addDays(plan.startDateISO, 21);
  for (const w of Object.values(plan.workouts)) {
    if (w.date < today && w.discipline === "run") { w.status = "done"; w.rpe = 2; w.feel = "great"; }
  }
  const res = calibratePaces(plan, today);
  check((res?.calibration.run ?? 0) > 0, "run sharpened (adj > 0) when sessions felt easy");
}
// ---- calibration: not enough data → null ----
{
  const plan = generatePlan(mk({ raceType: "olympic", raceDateISO: raceInWeeks(14) }));
  check(calibratePaces(plan, addDays(plan.startDateISO, 3)) === null, "no recent data → null");
}

// ---- adaptation: missing lots → ease next week ----
console.log("\n=== adaptation ===");
{
  const p = mk({ raceType: "half", raceDateISO: raceInWeeks(20), perSport: { swim: 2, bike: 3, run: 3 } });
  const plan = generatePlan(p);
  const today = addDays(plan.startDateISO, 21); // week 3; weeks 1–2 left unlogged = missed
  const sug = assessAdaptation(plan, today);
  check(!!sug && sug.kind === "ease", "missed sessions → ease suggestion");
  if (sug) {
    const applied = applyAdaptation(plan, sug);
    check((applied.easedWeeks ?? []).includes(sug.weekIndex), "eased week is recorded");
    const wk = applied.weeks.find((w) => w.index === sug.weekIndex)!;
    const stillHard = wk.workoutIds.filter((id) => HARD.includes(applied.workouts[id].type));
    check(stillHard.length === 0, "no hard sessions remain in the eased week");
  }
}
// ---- adaptation: on-track → null ----
{
  const p = mk({ raceType: "half", raceDateISO: raceInWeeks(20), perSport: { swim: 2, bike: 3, run: 3 } });
  const plan = generatePlan(p);
  const today = addDays(plan.startDateISO, 21);
  for (const w of Object.values(plan.workouts)) if (w.date < today && w.discipline !== "rest") { w.status = "done"; w.feel = "ok"; }
  check(assessAdaptation(plan, today) === null, "all done & feeling ok → no suggestion");
}

// ---- readiness ----
console.log("\n=== readiness ===");
{
  check(readinessScore({ sleep: 1, legs: 1, energy: 1 }) < READY_LOW, "all-poor scores low");
  check(readinessScore({ sleep: 3, legs: 3, energy: 3 }) >= 75, "all-fresh scores high");
  const p = mk({ raceType: "olympic", raceDateISO: raceInWeeks(14), perSport: { swim: 2, bike: 2, run: 3 } });
  const plan = generatePlan(p);
  const hard = Object.values(plan.workouts).find((w) => HARD.includes(w.type) && w.status === "planned");
  check(!!hard, "found a hard session to test against");
  if (hard) {
    const eased = logReadiness(plan, hard.date, { sleep: 1, legs: 1, energy: 1 });
    const entry = eased.readiness![hard.date];
    check(entry.score < READY_LOW && entry.eased === true, "low readiness eases the day");
    check(!HARD.includes(eased.workouts[hard.id].type) || eased.workouts[hard.id].note === "Eased off", "today's hard session was softened");
    const plan2 = generatePlan(p);
    const highRes = logReadiness(plan2, hard.date, { sleep: 3, legs: 3, energy: 3 });
    check(!highRes.readiness![hard.date].eased, "high readiness does not ease");
    check(highRes.workouts[hard.id].type === plan2.workouts[hard.id].type, "high readiness leaves the session unchanged");
  }
}

// ===========================================================================
// TIER 2 — watch export (.FIT) · guided-session flatten · social cards
// ===========================================================================
console.log("\n\n########## TIER 2: watch export + social ##########");

// independent CRC-16 (FIT) to validate the encoder's checksums
const CRC_T = [0x0000,0xcc01,0xd801,0x1400,0xf001,0x3c00,0x2800,0xe401,0xa001,0x6c00,0x7800,0xb401,0x5000,0x9c01,0x8801,0x4400];
function fitCrc(buf: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    let t = CRC_T[crc & 0xf]; crc = (crc >> 4) & 0x0fff; crc = crc ^ t ^ CRC_T[b & 0xf];
    t = CRC_T[crc & 0xf]; crc = (crc >> 4) & 0x0fff; crc = crc ^ t ^ CRC_T[(b >> 4) & 0xf];
  }
  return crc & 0xffff;
}

console.log("\n=== flatten + FIT export ===");
{
  const plan = generatePlan(mk({ raceType: "olympic", raceDateISO: raceInWeeks(14), perSport: { swim: 2, bike: 2, run: 3 }, ftp: 220 }));
  const w = Object.values(plan.workouts).find((x) => x.discipline === "run" && x.segments.length > 1)
    ?? Object.values(plan.workouts).find((x) => x.discipline === "run")!;
  const steps = flattenWorkout(w, plan.paces);
  check(steps.length > 0, `flatten produced ${steps.length} steps`);
  check(steps.every((s) => s.durationSec >= 0), "every step has a non-negative duration");

  const fit = buildWorkoutFit(w, plan.paces);
  check(fit[0] === 14, "FIT header size = 14");
  check(String.fromCharCode(fit[8], fit[9], fit[10], fit[11]) === ".FIT", "FIT magic bytes = .FIT");
  const dataSize = fit[4] | (fit[5] << 8) | (fit[6] << 16) | (fit[7] << 24);
  check(dataSize === fit.length - 16, "FIT data-size field = file − header(14) − CRC(2)");
  check((fit[12] | (fit[13] << 8)) === fitCrc(fit.subarray(0, 12)), "FIT header CRC valid");
  const stored = fit[fit.length - 2] | (fit[fit.length - 1] << 8);
  check(stored === fitCrc(fit.subarray(0, fit.length - 2)), "FIT file CRC valid");
}

console.log("\n=== social cards ===");
{
  const plan = generatePlan(mk({ raceType: "half", raceDateISO: raceInWeeks(18), raceName: "IRONMAN 70.3 Test" }));
  const today = addDays(plan.startDateISO, 6);
  Object.values(plan.workouts).filter((w) => w.discipline !== "rest").slice(0, 2).forEach((w) => { w.status = "done"; });
  const card = publicCard("tester", { profile: plan.profile, plan }, today);
  check(card.username === "tester", "card carries username");
  check(!!card.race && card.race.name.includes("70.3"), "card carries race name");
  check(card.weekDone >= 2, `card counts completed sessions this week (${card.weekDone})`);
  const k1 = raceKeyOf(plan.profile);
  const k2 = raceKeyOf({ ...plan.profile, raceDateISO: addDays(plan.profile.raceDateISO, 1) });
  check(!!k1 && k1 !== k2, "raceKey distinguishes different races");
}

console.log(`\n\n${problems === 0 ? "✅ NO PROBLEMS" : "❌ " + problems + " PROBLEMS"}`);
