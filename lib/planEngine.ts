import {
  Discipline,
  Level,
  Phase,
  Plan,
  Profile,
  Week,
  Workout,
  Zone,
} from "./types";
import { derivePaces } from "./paces";
import { BuildCtx, Draft } from "./workouts";
import * as W from "./workouts";
import {
  addDays,
  dayIndexOf,
  mondayOf,
  todayISO,
  weeksBetween,
} from "./dates";

// ---------------------------------------------------------------------------
// Deterministic periodization engine.  Runs entirely in code (no API cost).
// Encodes: plan length by distance×level, Base/Build/Peak/Taper split,
// 3:1 (or 2:1) load:deload cycles, 80/20 intensity, long-session caps, taper.
// ---------------------------------------------------------------------------

type Cat = "olympic" | "half" | "full";

export const RACE_DISTANCES: Record<Cat, { swim: number; bike: number; run: number; name: string }> = {
  olympic: { swim: 1500, bike: 40000, run: 10000, name: "Olympic" },
  half: { swim: 1900, bike: 90000, run: 21100, name: "Ironman 70.3" },
  full: { swim: 3800, bike: 180000, run: 42200, name: "Ironman" },
};

const PLAN_LEN: Record<Cat, { min: number; max: number }> = {
  olympic: { min: 8, max: 16 },
  half: { min: 12, max: 24 },
  full: { min: 16, max: 30 },
};

const PEAK_HOURS: Record<Cat, Record<Level, number>> = {
  olympic: { beginner: 7, intermediate: 9, advanced: 11, elite: 13 },
  half: { beginner: 9, intermediate: 11, advanced: 14, elite: 17 },
  full: { beginner: 12, intermediate: 15, advanced: 18, elite: 22 },
};

const TAPER_WEEKS: Record<Cat, number> = { olympic: 1, half: 2, full: 3 };

// long-session caps (minutes) — you don't train the full race distance
const LONG_RUN_CAP: Record<Cat, number> = { olympic: 90, half: 120, full: 180 };
const LONG_RIDE_CAP: Record<Cat, number> = { olympic: 150, half: 240, full: 330 };

export function categoryOf(p: Profile): Cat {
  if (p.raceType === "olympic") return "olympic";
  if (p.raceType === "half") return "half";
  if (p.raceType === "full") return "full";
  if (p.raceType === "fitness") return "olympic"; // no race → moderate, all-round volumes
  // classify a custom race by its run leg
  const run = p.custom?.runM ?? 10000;
  if (run <= 12000) return "olympic";
  if (run <= 25000) return "half";
  return "full";
}

/** True when there's no target race to periodise toward — either the athlete chose
 *  "just get fitter", or they picked a distance but never set a date. The plan then
 *  runs as a rolling base→build fitness block instead of counting down to race day. */
export function isFitnessGoal(p: Profile): boolean {
  return p.raceType === "fitness" || !p.raceDateISO;
}

// A rolling general-fitness block: no peak, no taper, no race week. Long enough to
// carry real base→build structure, and it regenerates forward whenever the plan is
// rebuilt, so training just keeps progressing until the athlete adds a race.
const FITNESS_BLOCK_WEEKS = 12;

const RACE_BIKE_KMH: Record<Level, number> = { beginner: 26, intermediate: 30, advanced: 33, elite: 36 };
// Typical flat-course FTP the level speeds above implicitly assume — used to
// scale race speed when the athlete gives their own FTP.
const TYPICAL_FTP: Record<Level, number> = { beginner: 150, intermediate: 200, advanced: 260, elite: 320 };

/** Rough race-day finish estimate from the athlete's derived paces. */
export function estimateRaceSeconds(
  paces: import("./types").PaceModel,
  level: Level,
  cat: Cat,
  dist: { swim: number; bike: number; run: number },
): number {
  // swim ~ tempo pace (near CSS)
  const swimZ = paces.swim.zones[3];
  const swimPace = (swimZ.loSecPer100 + swimZ.hiSecPer100) / 2; // sec/100m
  const swimSec = (dist.swim / 100) * swimPace;
  // bike ~ level speed adjusted for race intensity by distance
  const bikeFactor = cat === "full" ? 0.9 : cat === "half" ? 1.0 : 1.08;
  let bikeKmh = RACE_BIKE_KMH[level] * bikeFactor;
  // If the athlete gave an FTP, scale speed by power: on the flat, aero drag
  // dominates so P ∝ v³ → v ∝ FTP^(1/3). Higher FTP than the level norm = faster.
  if (paces.bike.ftp && paces.bike.ftp > 0) {
    bikeKmh *= Math.cbrt(paces.bike.ftp / TYPICAL_FTP[level]);
  }
  const bikeSec = (dist.bike / 1000 / bikeKmh) * 3600;
  // run ~ Z2 (full), Z3 (half), Z4-ish (olympic)
  const runZone = cat === "full" ? 2 : cat === "half" ? 3 : 4;
  const rz = paces.run.zones[runZone];
  const runPace = cat === "full" ? rz.hiSecPerKm : (rz.loSecPerKm + rz.hiSecPerKm) / 2;
  const runSec = (dist.run / 1000) * runPace;
  const transitions = cat === "full" ? 600 : cat === "half" ? 420 : 300;
  return Math.round(swimSec + bikeSec + runSec + transitions);
}

export function raceDistances(p: Profile): { swim: number; bike: number; run: number; name: string } {
  if (p.raceType === "custom" && p.custom) {
    return { swim: p.custom.swimM, bike: p.custom.bikeM, run: p.custom.runM, name: p.custom.name || "Custom Race" };
  }
  const base = RACE_DISTANCES[categoryOf(p)];
  // A real event from the catalog surfaces its own name (e.g. "IRONMAN 70.3
  // Mont-Tremblant") on race day; distances stay canonical for the category.
  return { ...base, name: p.raceName?.trim() || base.name };
}

/** The canonical distance-category label (e.g. "Ironman 70.3"), ignoring any
 *  real-event name — for surfaces that show the event name separately so the
 *  category and the event don't read as a duplicate. */
export function raceCategoryName(p: Profile): string {
  if (p.raceType === "custom" && p.custom) return p.custom.name || "Custom Race";
  return RACE_DISTANCES[categoryOf(p)].name;
}

// ---- weekly load curve --------------------------------------------------

function baseFraction(phase: Phase, idxInPhase: number, phaseLen: number, taperPos: number, taperLen: number): number {
  if (phase === "base") {
    if (phaseLen <= 1) return 0.75;
    return 0.6 + (0.85 - 0.6) * (idxInPhase / (phaseLen - 1));
  }
  if (phase === "build") {
    if (phaseLen <= 1) return 0.95;
    return 0.85 + (1.0 - 0.85) * (idxInPhase / (phaseLen - 1));
  }
  if (phase === "peak") return 1.0;
  // taper: descend toward the race
  const ladder = [0.7, 0.55, 0.42];
  // taperPos: 0-based from start of taper; last taper week is race week
  const isRaceWeek = taperPos === taperLen - 1;
  if (isRaceWeek) return 0.32;
  // pick from ladder aligning the end
  const remainingBeforeRace = taperLen - 1 - taperPos; // weeks between this and race
  const li = Math.min(ladder.length - 1, remainingBeforeRace);
  return ladder[Math.max(0, li)];
}

// ---- the scheduler ------------------------------------------------------

interface Slot {
  day: number; // 0=Mon..6=Sun
  discipline: Discipline;
  hard: boolean;
  scalable: boolean;
  weight: number;
  minMin: number;
  maxMin: number;
  build: (min: number) => Draft;
}

// The athlete picks a TOTAL number of workouts per week. 1 = a single key
// session; the high end stacks multiple sessions on a day ("doubles"/"triples").
export const MIN_WORKOUTS = 1;
export const MAX_WORKOUTS = 21;

export function clampWorkouts(n: number | undefined): number {
  const v = Math.round(Number(n) || 6);
  return Math.max(MIN_WORKOUTS, Math.min(MAX_WORKOUTS, v));
}

// ---- per-sport session targets ------------------------------------------
// The athlete can set explicit swim/bike/run counts; otherwise we distribute
// their total across the sports with a sensible tri ratio and their limiter.

type Sport = "swim" | "bike" | "run";
type SportCounts = { swim: number; bike: number; run: number; strength: number };

function clampSport(n: number): number {
  return Math.max(0, Math.min(10, Math.round(Number(n) || 0)));
}

function strengthDaysOf(p: Profile): number {
  return p.strength?.enabled ? Math.max(0, Math.min(4, Math.round(p.strength.daysPerWeek || 0))) : 0;
}

// Distribute a total across swim/bike/run (bike-leaning), biased to the limiter.
function splitTotal(total: number, focus?: Discipline): { swim: number; bike: number; run: number } {
  const w: Record<Sport, number> = { swim: 0.28, bike: 0.4, run: 0.32 };
  if (focus === "swim" || focus === "bike" || focus === "run") w[focus] += 0.12;
  const sum = w.swim + w.bike + w.run;
  const raw: Record<Sport, number> = {
    swim: (w.swim / sum) * total,
    bike: (w.bike / sum) * total,
    run: (w.run / sum) * total,
  };
  const out: Record<Sport, number> = { swim: Math.floor(raw.swim), bike: Math.floor(raw.bike), run: Math.floor(raw.run) };
  let left = total - (out.swim + out.bike + out.run);
  const byRemainder = (["bike", "run", "swim"] as Sport[]).sort((a, b) => raw[b] - out[b] - (raw[a] - out[a]));
  for (const k of byRemainder) {
    if (left <= 0) break;
    out[k]++;
    left--;
  }
  // make sure all three sports show up when there's room
  if (total >= 3) {
    for (const k of ["swim", "bike", "run"] as Sport[]) {
      if (out[k] === 0) {
        const big = (["bike", "run", "swim"] as Sport[]).sort((a, b) => out[b] - out[a])[0];
        if (out[big] > 1) {
          out[big]--;
          out[k]++;
        }
      }
    }
  }
  return out;
}

// Effective per-sport counts for a full, normal week (before phase scaling).
function baseSportCounts(p: Profile): SportCounts {
  const strength = strengthDaysOf(p);
  if (p.perSport) {
    return {
      swim: clampSport(p.perSport.swim),
      bike: clampSport(p.perSport.bike),
      run: clampSport(p.perSport.run),
      strength,
    };
  }
  const total = Math.max(1, clampWorkouts(p.workoutsPerWeek) - strength);
  return { ...splitTotal(total, p.focusDiscipline), strength };
}

function effectiveWorkouts(p: Profile): number {
  const c = baseSportCounts(p);
  return Math.min(MAX_WORKOUTS, c.swim + c.bike + c.run + c.strength);
}

/** The swim/bike/run split the engine would use for this profile. Used to seed the
 *  settings editor when the athlete has no explicit per-sport counts yet, so opening
 *  and saving a workoutsPerWeek-only profile doesn't silently rewrite it to 2/2/2. */
export function defaultSportSplit(p: Profile): { swim: number; bike: number; run: number } {
  const c = baseSportCounts(p);
  return { swim: c.swim, bike: c.bike, run: c.run };
}

// ---- injuries → per-sport intensity/volume modifiers --------------------

type InjuryMod = { capZone: Zone; volMult: number; avoid: boolean };

function injuryMods(p: Profile): Record<Sport, InjuryMod> {
  const fresh = (): InjuryMod => ({ capZone: 5, volMult: 1, avoid: false });
  const mods: Record<Sport, InjuryMod> = { swim: fresh(), bike: fresh(), run: fresh() };
  for (const inj of p.injuries ?? []) {
    const cap: Zone = inj.severity === "niggle" ? 3 : 2;
    const vol = inj.severity === "niggle" ? 0.85 : inj.severity === "moderate" ? 0.6 : 0.4;
    const avoid = inj.severity === "severe";
    for (const d of inj.disciplines) {
      if (d !== "swim" && d !== "bike" && d !== "run") continue;
      const m = mods[d];
      m.capZone = Math.min(m.capZone, cap) as Zone;
      m.volMult = Math.min(m.volMult, vol);
      m.avoid = m.avoid || avoid;
    }
  }
  return mods;
}

function capTotal(c: SportCounts, max: number): SportCounts {
  const out = { ...c };
  let guard = 0;
  while (out.swim + out.bike + out.run + out.strength > max && guard++ < 40) {
    const biggest = (["run", "swim", "bike"] as Sport[]).filter((k) => out[k] > 0).sort((a, b) => out[b] - out[a])[0];
    if (!biggest) break;
    out[biggest]--;
  }
  return out;
}

// Per-sport counts for a specific week: injuries reduce/substitute volume,
// recovery weeks ease off, taper trims and drops most strength.
function weekSportCounts(
  p: Profile,
  phase: Phase,
  isRecovery: boolean,
  mods: Record<Sport, InjuryMod>,
): SportCounts {
  const base = baseSportCounts(p);
  const adj: Record<Sport, number> = { swim: base.swim, bike: base.bike, run: base.run };
  let removed = 0;
  for (const d of ["swim", "bike", "run"] as Sport[]) {
    const m = mods[d];
    let n = Math.round(adj[d] * m.volMult);
    if (m.avoid) n = Math.min(n, 1); // keep one gentle session to hold feel
    n = Math.max(0, n);
    removed += adj[d] - n;
    adj[d] = n;
  }
  // shift the freed sessions onto the safest healthy sports (low-impact first)
  if (removed > 0) {
    const healthy = (["swim", "bike", "run"] as Sport[]).filter((d) => !mods[d].avoid && mods[d].volMult >= 0.85);
    for (const d of healthy) {
      while (removed > 0 && adj[d] < 8) {
        adj[d]++;
        removed--;
      }
      if (removed <= 0) break;
    }
  }

  // equipment: no pool ⇒ keep at most one dry-land swim, push the rest to bike/run
  if (p.equipment?.pool === false && adj.swim > 1) {
    let move = adj.swim - 1;
    adj.swim = 1;
    for (const d of ["bike", "run"] as Sport[]) {
      while (move > 0 && adj[d] < 8) {
        adj[d]++;
        move--;
      }
      if (move <= 0) break;
    }
  }

  let c: SportCounts = { ...adj, strength: base.strength };
  if (isRecovery) {
    c = {
      swim: Math.max(0, Math.round(c.swim * 0.7)),
      bike: Math.max(c.bike > 0 ? 1 : 0, Math.round(c.bike * 0.7)),
      run: Math.max(0, Math.round(c.run * 0.7)),
      strength: Math.min(c.strength, 1),
    };
  }
  if (phase === "taper") {
    c.strength = Math.min(c.strength, 1);
    c = capTotal(c, 8);
  }
  // Never emit more sessions than the scheduler can place (7 days × 3/day).
  // Otherwise assignDays runs out of slots and stacks a 4th session onto Monday.
  return capTotal(c, MAX_WORKOUTS);
}

function trainingDays(p: Profile): Set<number> {
  // The days that carry a session in a "normal" (≤7) week — used by race week
  // to decide where to place light openers.
  const N = Math.min(effectiveWorkouts(p), 7);
  let pri = [5, 6, 1, 3, 2, 4, 0]; // Sat, Sun, Tue, Thu, Wed, Fri, Mon
  if (p.restDayPreference != null) pri = pri.filter((d) => d !== p.restDayPreference);
  return new Set(pri.slice(0, N));
}

// A session before it has been assigned to a day.
type Role = Omit<Slot, "day"> & { prefDay: number };

function pickWeekSlots(
  ctx: BuildCtx,
  p: Profile,
  cat: Cat,
  phase: Phase,
  weekIndex: number,
  isRecovery: boolean,
): Slot[] {
  const recover = isRecovery;
  const even = weekIndex % 2 === 0;
  const runCap = LONG_RUN_CAP[cat];
  const rideCap = LONG_RIDE_CAP[cat];
  const runOff = phase === "peak" ? (cat === "olympic" ? 20 : 30) : cat === "olympic" ? 12 : 18;

  // How many of each sport this week — the athlete's per-sport choice, with
  // injuries reducing/substituting volume and light weeks eased off.
  const mods = injuryMods(p);
  const counts = weekSportCounts(p, phase, isRecovery, mods);

  // ---- BIKE ---------------------------------------------------------------
  // The long anchor becomes a brick in build/peak — unless a run injury makes
  // running off the bike unwise, in which case it stays a long endurance ride.
  const brickOk =
    (phase === "build" || phase === "peak") && mods.run.capZone >= 3 && !mods.run.avoid && !mods.bike.avoid;
  const bikeRacePace = mods.bike.capZone >= 3;
  const longAnchor: Role = brickOk
    ? {
        discipline: "brick", hard: !recover, scalable: true, weight: 3.0, minMin: 45, maxMin: rideCap + runOff, prefDay: 5,
        build: (min) => W.brick(ctx, Math.max(30, min - runOff), runOff, bikeRacePace && phase === "peak"),
      }
    : {
        discipline: "bike", hard: false, scalable: true, weight: 3.0, minMin: 45, maxMin: rideCap, prefDay: 5,
        build: (min) => W.bikeLong(ctx, min, phase !== "base" && !recover && bikeRacePace),
      };
  // when a sport is off-limits (severe injury), keep only gentle, short sessions
  const bikeList: Role[] = mods.bike.avoid
    ? [easyBike(5, 1.0, 55), easyBike(2, 0.9, 50), easyBike(1, 0.8, 45), easyBike(0, 0.7, 40)]
    : [longAnchor, bikeQualityRole(), easyBike(2, 1.2), easyBike(1, 1.0, 60), easyBike(0, 0.8, 55), easyBike(4, 0.7, 50)];

  // ---- RUN ----------------------------------------------------------------
  const longRun: Role = {
    discipline: "run", hard: false, scalable: true, weight: 2.2, minMin: 30, maxMin: runCap, prefDay: 6,
    build: (min) => W.runLong(ctx, min, phase === "peak" && !recover && mods.run.capZone >= 3),
  };
  const runList: Role[] = mods.run.avoid
    ? [easyRun(0, 0.9, 40), easyRun(3, 0.8, 35), easyRun(6, 0.7, 30), easyRun(1, 0.6, 30)]
    : [longRun, runQualityRole(), easyRun(0, 1.0), easyRun(3, 0.9, 50), easyRun(6, 0.8, 45), easyRun(1, 0.7, 40)];

  // ---- SWIM ---------------------------------------------------------------
  const noPool = p.equipment?.pool === false;
  const swimList: Role[] = noPool
    ? [swim(2, () => W.swimDryland(ctx), 1.0), swim(4, () => W.swimDryland(ctx), 0.9)]
    : mods.swim.avoid
    ? [easySwim(2, 0.9), easySwim(4, 0.8), easySwim(5, 0.7), easySwim(0, 0.6)]
    : [swim(2, keySwimBuild, 1.0), swim(4, swim2Build, 1.0), easySwim(4, 0.9), easySwim(2, 0.8), easySwim(5, 0.7), easySwim(0, 0.6)];

  // ---- assemble: take each sport's chosen count, then strength -------------
  const chosen: Role[] = [
    ...swimList.slice(0, counts.swim),
    ...bikeList.slice(0, counts.bike),
    ...runList.slice(0, counts.run),
    ...buildStrengthRoles(counts.strength),
  ];

  // limiter: give the focus sport a bit more of the weekly time budget
  if (p.focusDiscipline === "swim" || p.focusDiscipline === "bike" || p.focusDiscipline === "run") {
    for (const r of chosen) if (r.discipline === p.focusDiscipline) r.weight *= 1.18;
  }

  return assignDays(chosen, p.restDayPreference);

  // ---- easy / aerobic volume fillers --------------------------------------
  function easyRun(prefDay: number, w = 1.0, maxMin = 60): Role {
    return {
      discipline: "run", hard: false, scalable: true, weight: w, minMin: 20, maxMin, prefDay,
      build: (min) => (recover || phase === "taper" ? W.runRecovery(ctx, Math.min(35, min)) : W.runEasy(ctx, min)),
    };
  }
  function easyBike(prefDay: number, w = 1.1, maxMin = 70): Role {
    return {
      discipline: "bike", hard: false, scalable: true, weight: w, minMin: 30, maxMin, prefDay,
      build: (min) => (recover || phase === "taper" ? W.bikeRecovery(ctx, Math.min(45, min)) : W.bikeEndurance(ctx, min)),
    };
  }
  function easySwim(prefDay: number, w = 0.8): Role {
    return swim(prefDay, () => (recover || phase === "taper" ? W.swimRecovery(ctx, 900) : W.swimTechnique(ctx)), w);
  }

  // ---- injury-aware key sessions ------------------------------------------
  function keySwimBuild(): Draft {
    const cap = mods.swim.capZone;
    if (phase === "base" || recover || cap < 3) return W.swimTechnique(ctx);
    if (phase === "peak") return W.swimOpenWater(ctx);
    if (phase === "taper") return W.swimRecovery(ctx, 1000);
    if (cap < 4) return W.swimEndurance(ctx, 1400);
    return W.swimThreshold(ctx);
  }
  function swim2Build(): Draft {
    const cap = mods.swim.capZone;
    if (cap >= 4 && (phase === "peak" || phase === "taper")) return W.swimThreshold(ctx);
    return W.swimEndurance(ctx, 1200);
  }
  function bikeQualityRole(): Role {
    const cap = mods.bike.capZone;
    if (phase === "base" || recover || cap <= 2)
      return quality(3, "bike", false, (min) => W.bikeEndurance(ctx, min), 1.4, 40, 90, true);
    if (phase === "taper") return quality(3, "bike", true, () => W.bikeSweetSpot(ctx, 55), 1.3, 40, 60);
    if (cap === 3) return quality(3, "bike", true, () => W.bikeSweetSpot(ctx), 1.5, 55, 85);
    return quality(3, "bike", true, even ? () => W.bikeThreshold(ctx) : () => W.bikeSweetSpot(ctx), 1.5, 55, 85);
  }
  function runQualityRole(): Role {
    const cap = mods.run.capZone;
    if (phase === "base" || recover || cap <= 2)
      return quality(1, "run", false, (min) => W.runEasy(ctx, min), 1.2, 25, 70, true);
    if (phase === "taper")
      return cap >= 4
        ? quality(1, "run", true, () => W.runThreshold(ctx, 45), 1.1, 30, 50)
        : quality(1, "run", true, () => W.runTempo(ctx, 45), 1.0, 30, 50);
    if (cap === 3) return quality(1, "run", true, () => W.runTempo(ctx), 1.2, 40, 60);
    return quality(1, "run", true, even ? () => W.runThreshold(ctx) : () => W.runVO2(ctx), 1.3, 45, 65);
  }

  // ---- strength (split-aware) ---------------------------------------------
  function buildStrengthRoles(count: number): Role[] {
    const split = p.strength?.split ?? "full";
    const customSplit = p.strength?.customSplit; // athlete's own plan, when split === "custom"
    const home = p.equipment?.gym === false; // no gym ⇒ bodyweight home circuit
    const prefDays = [0, 4, 2, 3]; // Mon, Fri, Wed, Thu
    const min = recover ? 25 : 35;
    const roles: Role[] = [];
    for (let i = 0; i < count; i++) {
      const idx = i;
      roles.push({
        prefDay: prefDays[i % prefDays.length],
        discipline: "strength", hard: false, scalable: false, weight: 0.7, minMin: min, maxMin: min,
        build: () => W.strengthFor(ctx, split, idx, recover, home, customSplit),
      });
    }
    return roles;
  }

  function quality(
    day: number,
    disc: Discipline,
    hard: boolean,
    build: (min: number) => Draft,
    weight: number,
    minMin: number,
    maxMin: number,
    scalable = false,
  ): Role {
    return { prefDay: day, discipline: disc, hard, scalable, weight, minMin, maxMin, build };
  }
  function swim(prefDay: number, build: (min: number) => Draft, weight: number): Role {
    return { prefDay, discipline: "swim", hard: false, scalable: false, weight, minMin: 30, maxMin: 60, build };
  }
}

// Remove sessions that fall on the athlete's blackout dates (vacation, travel).
function applyBlackouts(p: Profile, weeks: Week[], workouts: Record<string, Workout>): void {
  const ranges = (p.blackouts ?? []).filter((r) => r.startISO && r.endISO && r.startISO <= r.endISO);
  if (!ranges.length) return;
  const inRange = (iso: string) => ranges.some((r) => iso >= r.startISO && iso <= r.endISO);
  for (const [id, w] of Object.entries(workouts)) {
    if (w.type === "race_prep") continue; // never drop the race or its openers
    if (inRange(w.date)) delete workouts[id];
  }
  for (const wk of weeks) wk.workoutIds = wk.workoutIds.filter((id) => workouts[id]);
}

// Spread the chosen sessions across the 7 days: fill empty days first, then
// stack (up to 3/day), never two hard sessions on one day, keep sports apart,
// stay near each session's preferred day, and honour a rest day when count allows.
function assignDays(roles: Role[], restDay?: number): Slot[] {
  const day: { hard: boolean; disc: Discipline }[][] = Array.from({ length: 7 }, () => []);
  const out: Slot[] = [];
  for (const r of roles) {
    let best = 0;
    let bestScore = -Infinity;
    for (let d = 0; d < 7; d++) {
      const s = score(d, r);
      if (s > bestScore) { bestScore = s; best = d; }
    }
    day[best].push({ hard: r.hard, disc: r.discipline });
    out.push({
      day: best,
      discipline: r.discipline,
      hard: r.hard,
      scalable: r.scalable,
      weight: r.weight,
      minMin: r.minMin,
      maxMin: r.maxMin,
      build: r.build,
    });
  }
  return out;

  function score(d: number, r: Role): number {
    const cur = day[d];
    if (cur.length >= 3) return -1e6; // a day holds at most three sessions
    let s = -cur.length * 25; // spread across days before doubling up
    if (restDay != null && d === restDay) s -= 1000; // keep the rest day clear unless every other day is full
    if (r.hard && cur.some((x) => x.hard)) s -= 400; // never two hard sessions a day
    if (cur.some((x) => x.disc === r.discipline)) s -= 30; // avoid same-sport doubles
    const dist = Math.min(Math.abs(d - r.prefDay), 7 - Math.abs(d - r.prefDay));
    s -= dist * 6; // stay near the preferred day (week wraps)
    if (d === r.prefDay) s += cur.length === 0 ? 100 : 20;
    return s;
  }
}

// ---- assemble the whole plan --------------------------------------------

export function generatePlan(profile: Profile): Plan {
  // No race on the calendar → a rolling fitness block instead of a countdown.
  if (isFitnessGoal(profile)) return generateFitnessPlan(profile);

  const cat = categoryOf(profile);
  const paces = derivePaces(profile);
  const ctx: BuildCtx = { paces, level: profile.level };

  // plan length from race date
  const start0 = mondayOf(todayISO());
  const raceMonday = mondayOf(profile.raceDateISO);
  const weeksUntil = weeksBetween(start0, raceMonday) + 1; // include race week
  const { min, max } = PLAN_LEN[cat];

  let totalWeeks: number;
  let compressed = false;
  let delayedStart = false;
  if (weeksUntil < min) {
    totalWeeks = Math.max(4, weeksUntil);
    compressed = true;
  } else if (weeksUntil > max) {
    totalWeeks = max;
    delayedStart = true;
  } else {
    totalWeeks = weeksUntil;
  }

  // start Monday chosen so the last week contains race day
  const startMonday = addDays(raceMonday, -(totalWeeks - 1) * 7);

  // phase split
  const taperWeeks = Math.min(TAPER_WEEKS[cat], Math.max(1, Math.floor(totalWeeks * 0.18)));
  const remaining = totalWeeks - taperWeeks;
  let baseWeeks = Math.max(1, Math.round(remaining * 0.45));
  let peakWeeks = remaining >= 6 ? Math.min(2, Math.max(1, Math.round(remaining * 0.12))) : remaining >= 4 ? 1 : 0;
  let buildWeeks = remaining - baseWeeks - peakWeeks;
  if (buildWeeks < 1) {
    buildWeeks = Math.max(1, remaining - baseWeeks);
    peakWeeks = Math.max(0, remaining - baseWeeks - buildWeeks);
  }
  if (baseWeeks + buildWeeks + peakWeeks !== remaining) {
    baseWeeks = remaining - buildWeeks - peakWeeks;
  }

  const baseEnd = baseWeeks;
  const buildEnd = baseWeeks + buildWeeks;
  const peakEnd = baseWeeks + buildWeeks + peakWeeks;

  const cycleLen = profile.level === "beginner" ? 3 : 4; // 2:1 vs 3:1

  const peakHours = Math.min(
    PEAK_HOURS[cat][profile.level],
    profile.weeklyHoursCap && profile.weeklyHoursCap > 0 ? profile.weeklyHoursCap : Infinity,
  );

  const weeks: Week[] = [];
  const workouts: Record<string, Workout> = {};

  for (let i = 0; i < totalWeeks; i++) {
    const phase: Phase = i < baseEnd ? "base" : i < buildEnd ? "build" : i < peakEnd ? "peak" : "taper";
    const isRaceWeek = i === totalWeeks - 1;
    // recovery weeks only within base/build
    const isRecovery = (phase === "base" || phase === "build") && (i + 1) % cycleLen === 0 && i > 0;

    // phase-local index + label
    let idxInPhase = i;
    let phaseLen = baseWeeks;
    if (phase === "build") { idxInPhase = i - baseEnd; phaseLen = buildWeeks; }
    else if (phase === "peak") { idxInPhase = i - buildEnd; phaseLen = peakWeeks; }
    else if (phase === "taper") { idxInPhase = i - peakEnd; phaseLen = taperWeeks; }

    const label = isRaceWeek
      ? "Race Week"
      : phase === "base"
      ? `Base ${idxInPhase + 1}${isRecovery ? " · Recovery" : ""}`
      : phase === "build"
      ? `Build ${idxInPhase + 1}${isRecovery ? " · Recovery" : ""}`
      : phase === "peak"
      ? `Peak ${idxInPhase + 1}`
      : `Taper ${idxInPhase + 1}`;

    const frac = baseFraction(phase, idxInPhase, phaseLen, phase === "taper" ? idxInPhase : 0, taperWeeks);
    let targetHours = peakHours * frac * (isRecovery ? 0.62 : 1);
    targetHours = Math.round(targetHours * 2) / 2;

    const weekStart = addDays(startMonday, i * 7);
    const week: Week = {
      index: i,
      phase,
      startDate: weekStart,
      label,
      isRecovery,
      isRaceWeek,
      targetHours,
      focus: focusFor(phase, isRecovery, isRaceWeek),
      workoutIds: [],
    };

    // build the week's workouts
    if (isRaceWeek) {
      buildRaceWeek(ctx, profile, cat, week, workouts);
    } else {
      buildNormalWeek(ctx, profile, cat, phase, i, isRecovery, targetHours, week, workouts);
    }

    weeks.push(week);
  }

  // strip out sessions the athlete told us they can't train (vacation, travel)
  applyBlackouts(profile, weeks, workouts);

  const notice = compressed
    ? "Your race is sooner than the ideal build — this plan is compressed. Prioritise the key sessions and stay healthy."
    : delayedStart
    ? "Your race is far out, so structured training kicks off closer to race day. Until then, keep a steady aerobic base."
    : undefined;

  return {
    id: `plan-${Date.now()}`,
    profile,
    startDateISO: startMonday,
    raceDateISO: profile.raceDateISO,
    totalWeeks,
    weeks,
    workouts,
    paces,
    generatedAtISO: new Date().toISOString(),
    compressed,
    delayedStart,
    notice,
  };
}

/** Build a rolling general-fitness plan for an athlete with no target race: a base
 *  block then a build block, recovery weeks on the athlete's load cycle, and NO
 *  peak/taper/race week. Reuses the same per-week builder as a race plan, so all the
 *  personalisation (per-sport counts, injuries, equipment, strength, blackouts,
 *  long-session day) still applies. */
function generateFitnessPlan(profile: Profile): Plan {
  const cat = categoryOf(profile); // "olympic" volumes by default; honours a chosen distance
  const paces = derivePaces(profile);
  const ctx: BuildCtx = { paces, level: profile.level };

  const startMonday = mondayOf(todayISO());
  const totalWeeks = FITNESS_BLOCK_WEEKS;
  const cycleLen = profile.level === "beginner" ? 3 : 4; // 2:1 vs 3:1 load:deload

  // A sustainable ceiling — a touch below race peak, since there's no taper to
  // recover into and this block just keeps rolling.
  const peakHours = Math.min(
    PEAK_HOURS[cat][profile.level] * 0.9,
    profile.weeklyHoursCap && profile.weeklyHoursCap > 0 ? profile.weeklyHoursCap : Infinity,
  );

  // first half base (aerobic engine), second half build (add some intensity)
  const baseWeeks = Math.ceil(totalWeeks / 2);
  const buildWeeks = totalWeeks - baseWeeks;

  const weeks: Week[] = [];
  const workouts: Record<string, Workout> = {};

  for (let i = 0; i < totalWeeks; i++) {
    const phase: Phase = i < baseWeeks ? "base" : "build";
    const isRecovery = (i + 1) % cycleLen === 0 && i > 0;
    const idxInPhase = phase === "base" ? i : i - baseWeeks;
    const phaseLen = phase === "base" ? baseWeeks : buildWeeks;
    const label = `${phase === "base" ? "Base" : "Build"} ${idxInPhase + 1}${isRecovery ? " · Recovery" : ""}`;

    const frac = baseFraction(phase, idxInPhase, phaseLen, 0, 0);
    let targetHours = peakHours * frac * (isRecovery ? 0.62 : 1);
    targetHours = Math.round(targetHours * 2) / 2;

    const weekStart = addDays(startMonday, i * 7);
    const week: Week = {
      index: i,
      phase,
      startDate: weekStart,
      label,
      isRecovery,
      isRaceWeek: false,
      targetHours,
      focus: focusFor(phase, isRecovery, false),
      workoutIds: [],
    };
    buildNormalWeek(ctx, profile, cat, phase, i, isRecovery, targetHours, week, workouts);
    weeks.push(week);
  }

  applyBlackouts(profile, weeks, workouts);

  return {
    id: `plan-${Date.now()}`,
    profile,
    startDateISO: startMonday,
    raceDateISO: "", // no target race
    totalWeeks,
    weeks,
    workouts,
    paces,
    generatedAtISO: new Date().toISOString(),
    compressed: false,
    delayedStart: false,
    notice:
      "Fitness mode — a rolling block to build all-round triathlon fitness. No race on the calendar; add one any time and we'll periodise toward it.",
  };
}

function focusFor(phase: Phase, rec: boolean, race: boolean): string {
  if (race) return "Rest, sharpen, and race. Trust the work you've banked.";
  if (rec) return "Recovery week — volume drops so your body absorbs the training.";
  if (phase === "base") return "Build the aerobic engine with easy volume and technique.";
  if (phase === "build") return "Add race-specific intensity — threshold, VO2, and bricks.";
  if (phase === "peak") return "Sharpen at race pace with big race-simulation sessions.";
  return "Taper — cut volume, keep it sharp, and freshen up.";
}

function buildNormalWeek(
  ctx: BuildCtx,
  profile: Profile,
  cat: Cat,
  phase: Phase,
  weekIndex: number,
  isRecovery: boolean,
  targetHours: number,
  week: Week,
  out: Record<string, Workout>,
) {
  const slots = pickWeekSlots(ctx, profile, cat, phase, weekIndex, isRecovery);

  // build fixed (non-scalable) first to know their duration budget
  const built = new Map<Slot, Draft>();
  let fixedSec = 0;
  for (const s of slots) {
    if (!s.scalable) {
      const d = s.build(0);
      built.set(s, d);
      fixedSec += d.estDurationSec;
    }
  }

  const scalables = slots.filter((s) => s.scalable);
  const targetSec = targetHours * 3600;
  const remainingSec = Math.max(0, targetSec - fixedSec);
  const wsum = scalables.reduce((a, s) => a + s.weight, 0) || 1;
  for (const s of scalables) {
    const share = (s.weight / wsum) * remainingSec;
    let min = Math.round(share / 60);
    min = Math.max(s.minMin, Math.min(s.maxMin, min));
    built.set(s, s.build(min));
  }

  // emit workouts. A day can hold up to three sessions, so ids are disambiguated.
  const idSeq: Record<string, number> = {};
  for (const s of slots) {
    const draft = built.get(s)!;
    const day = s.day;
    const idBase = `w-${weekIndex}-${day}-${s.discipline}`;
    const seq = (idSeq[idBase] = (idSeq[idBase] ?? 0) + 1);
    const id = seq > 1 ? `${idBase}-${seq}` : idBase;
    const date = addDays(week.startDate, day);
    const wk: Workout = {
      id,
      date,
      weekIndex,
      dayIndex: day,
      discipline: draft.discipline,
      type: draft.type,
      title: draft.title,
      purpose: draft.purpose,
      segments: draft.segments,
      estDurationSec: draft.estDurationSec,
      estDistanceM: draft.estDistanceM,
      primaryZone: draft.primaryZone,
      status: "planned",
    };
    out[id] = wk;
    week.workoutIds.push(id);
  }
  // sort by day, then longest session first within a day (the "main" one on top)
  week.workoutIds.sort(
    (a, b) => out[a].dayIndex - out[b].dayIndex || out[b].estDurationSec - out[a].estDurationSec,
  );
}

function buildRaceWeek(
  ctx: BuildCtx,
  profile: Profile,
  cat: Cat,
  week: Week,
  out: Record<string, Workout>,
) {
  const raceDayIndex = dayIndexOf(profile.raceDateISO);
  // light openers on the days before, rest the day before
  const openers: { day: number; build: () => Draft }[] = [];
  const D = trainingDays(profile);
  // a couple of short openers
  if (D.has(1)) openers.push({ day: 1, build: () => W.runThreshold(ctx, 35) });
  if (D.has(3)) openers.push({ day: 3, build: () => W.bikeSweetSpot(ctx, 45) });
  if (D.has(2)) openers.push({ day: 2, build: () => W.swimRecovery(ctx, 800) });

  for (const o of openers) {
    if (o.day >= raceDayIndex) continue; // no sessions on/after race day
    if (o.day === raceDayIndex - 1) continue; // rest day before race
    const draft = o.build();
    const id = `w-race-${o.day}-${draft.discipline}`;
    const wk: Workout = {
      id,
      date: addDays(week.startDate, o.day),
      weekIndex: week.index,
      dayIndex: o.day,
      discipline: draft.discipline,
      type: "race_prep",
      title: `Opener · ${draft.title}`,
      purpose: "Short and sharp — a few efforts to keep the body primed without adding fatigue.",
      segments: draft.segments,
      estDurationSec: Math.min(draft.estDurationSec, 40 * 60),
      estDistanceM: draft.estDistanceM,
      primaryZone: draft.primaryZone,
      status: "planned",
    };
    out[id] = wk;
    week.workoutIds.push(id);
  }

  // THE RACE
  const dist = raceDistances(profile);
  const raceId = "w-race-day";
  const raceWk: Workout = {
    id: raceId,
    date: profile.raceDateISO,
    weekIndex: week.index,
    dayIndex: raceDayIndex,
    discipline: "brick",
    type: "race_prep",
    title: `🏁 RACE DAY — ${dist.name}`,
    purpose: "This is what it was all for. Execute your pacing, fuel early and often, and enjoy every stroke, pedal, and stride.",
    primaryZone: 3,
    estDurationSec: estimateRaceSeconds(ctx.paces, profile.level, cat, dist),
    segments: [
      {
        kind: "main",
        discipline: "swim",
        zone: 3,
        distanceM: dist.swim,
        description: `Swim ${(dist.swim / 1000).toFixed(1)} km — settle into rhythm, sight often`,
        cue: "Start controlled. Find feet to draft. Don't bury yourself in the first 200m.",
      },
      {
        kind: "main",
        discipline: "bike",
        zone: cat === "full" ? 2 : 3,
        distanceM: dist.bike,
        description: `Bike ${(dist.bike / 1000).toFixed(0)} km @ ${cat === "full" ? "70–75%" : cat === "half" ? "80–85%" : "88–95%"} FTP`,
        cue: "Ride your own numbers. Fuel 60–90g carbs/hour. Save the legs for the run.",
      },
      {
        kind: "main",
        discipline: "run",
        zone: cat === "full" ? 2 : 3,
        distanceM: dist.run,
        description: `Run ${(dist.run / 1000).toFixed(1)} km — settle, then build`,
        cue: "First mile easy off the bike. Break it into segments. Finish strong.",
      },
    ],
    status: "planned",
  };
  out[raceId] = raceWk;
  week.workoutIds.push(raceId);
  week.workoutIds.sort((a, b) => out[a].dayIndex - out[b].dayIndex);
}
