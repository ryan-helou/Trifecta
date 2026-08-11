import {
  Discipline,
  Level,
  Phase,
  Plan,
  Profile,
  Terrain,
  Week,
  Workout,
  Zone,
} from "./types";
import { applyTerrainToWeek, pacingNote, TERRAIN_TIME_FACTOR, terrainOf } from "./terrain";
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

// The shortest defensible build per distance — a race sooner than this compresses the
// plan (we keep the key sessions and shorten the ramp).
const PLAN_MIN: Record<Cat, number> = { olympic: 8, half: 12, full: 16 };

// The plan ALWAYS begins the week the athlete signs up — no delayed start. It spans the
// whole runway to race day, so however far out the race is, that lead time flows into the
// aerobic base (see the phase split below), which is exactly where long-course time belongs.
// Someone who books an event a year-plus out and downloads the app wants to start building
// *today*, not sit idle until a "real" plan kicks in. The only clamp is a guard against
// clearly-mistaken input (a date 2+ years out — a typo, not a race being trained for): past
// MAX_PLAN_WEEKS the structured plan starts closer to the race (the sole `delayedStart` case).
const MAX_PLAN_WEEKS = 104; // ~2 years — a guardrail for bad dates, not real race lead times

// The build/"specific-prep" phase is a *bounded* block (~6–12 wk in Friel/traditional
// periodization; even shorter, rotated, under block periodization). It carries near-peak
// load, so it must NOT grow with lead time — the aerobic base does that instead. These
// cap the build so surplus weeks extend base, not build.
const BUILD_MAX: Record<Cat, number> = { olympic: 8, half: 10, full: 12 };

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

/** Rough race-day finish estimate from the athlete's derived paces.
 *
 *  `terrain` adjusts the bike and run splits for the course's elevation
 *  (ticket #85). Omitted ⇒ flat, so every existing caller keeps its exact
 *  numbers; callers that know the athlete's race pass `terrainOf(profile)`. */
export function estimateRaceSeconds(
  paces: import("./types").PaceModel,
  level: Level,
  cat: Cat,
  dist: { swim: number; bike: number; run: number },
  terrain: Terrain = "flat",
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
  // The course. Both splits above are flat-course numbers; climbing costs net
  // time on the bike and the run, and nothing at all in the water.
  const course = TERRAIN_TIME_FACTOR[terrain];
  return Math.round(swimSec + bikeSec * course.bike + runSec * course.run + transitions);
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
  // taper: strictly descends toward race day — the earliest taper week carries the most
  // load, the race week the least. Indexed by *weeks-to-race* so any taper length (1–3)
  // stays monotone (invariant #9; the old ladder ran 0.42→0.55→0.32 on a 3-week taper,
  // a non-monotone dip — doc 04 §4.2). Half/Olympic tapers (2/1 wk) are unchanged.
  const weeksToRace = taperLen - 1 - taperPos; // 0 = race week
  if (weeksToRace <= 0) return 0.32; // race week — the lightest
  const ladder = [0.55, 0.7]; // 1 week out, then ≥2 weeks out (clamped)
  return ladder[Math.min(ladder.length - 1, weeksToRace - 1)];
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
  // Default only on non-finite input (undefined/NaN). A real 0 must flow through and
  // clamp to MIN_WORKOUTS — `Number(0) || 6` wrongly treated 0 as "unset" and returned 6.
  const num = Number(n);
  const v = Math.round(Number.isFinite(num) ? num : 6);
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
// Shortest session worth prescribing, used to turn an hours cap into a session budget.
// A 3 h cap spread over 8 sessions is 22 min each — the honest answer is fewer, longer
// sessions, so the cap shapes the WEEK rather than truncating whatever didn't fit.
const MIN_MEANINGFUL_MIN = 40;

/** How many sessions an explicit weeklyHoursCap can actually carry. */
function sessionBudget(p: Profile): number {
  const cap = p.weeklyHoursCap;
  if (!cap || cap <= 0) return MAX_WORKOUTS;
  return Math.max(MIN_WORKOUTS, Math.floor((cap * 60) / MIN_MEANINGFUL_MIN));
}

function baseSportCounts(p: Profile): SportCounts {
  const budget = sessionBudget(p);
  const strength = Math.min(strengthDaysOf(p), Math.max(0, budget - 3));
  if (p.perSport) {
    const per = {
      swim: clampSport(p.perSport.swim),
      bike: clampSport(p.perSport.bike),
      run: clampSport(p.perSport.run),
    };
    const asked = per.swim + per.bike + per.run;
    const room = Math.max(3, budget - strength);
    if (asked <= room) return { ...per, strength };
    // Over the hours budget — scale the athlete's own split down, keeping at
    // least one session of each sport so the week stays a triathlon week.
    const k = room / asked;
    const scaled = {
      swim: Math.max(1, Math.floor(per.swim * k)),
      bike: Math.max(1, Math.floor(per.bike * k)),
      run: Math.max(1, Math.floor(per.run * k)),
    };
    return { ...scaled, strength };
  }
  const total = Math.max(1, Math.min(clampWorkouts(p.workoutsPerWeek), budget) - strength);
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

export function injuryMods(p: Profile): Record<Sport, InjuryMod> {
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
  // Shift the freed sessions onto the safest healthy sports (low-impact first).
  // "Healthy" means NO injury at all (volMult 1) — a niggle already sits at 0.85,
  // so a >= 0.85 test let a complaining sport absorb the freed load and a shin
  // niggle ended up DOUBLING that athlete's runs. Never add load to a sport the
  // athlete has told us hurts; if nothing is fully healthy the volume is simply
  // dropped, which is the correct answer for an injured athlete.
  if (removed > 0) {
    const healthy = (["swim", "bike", "run"] as Sport[]).filter((d) => !mods[d].avoid && mods[d].volMult >= 1);
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
      // Strength is NOT cut in a deload (#194, Ryan's call). A recovery week
      // exists to drop ENDURANCE volume — the swim/bike/run ×0.7 above is the
      // deload. Gym frequency is a commitment the athlete made about their week,
      // and quietly turning "3 times" into 1 read as the app ignoring them.
      // Doc 01 §4 #4 backs this up: in-season strength is a maintenance dose, and
      // maintenance is exactly what you keep through a lighter week.
      strength: c.strength,
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
  // Race week keeps the same day clear as every other week. The rest day is a floor,
  // so this filters unconditionally and the week tops out at six training days —
  // guarding it only when N < 7 let a 7-session athlete train straight through the
  // rest day in race week, which is where a day off matters most.
  const rest = restDayFor(p);
  pri = pri.filter((d) => d !== rest);
  return new Set(pri.slice(0, Math.min(N, 6)));
}

// A session before it has been assigned to a day.
type Role = Omit<Slot, "day"> & { prefDay: number };

/** Run-off-bike minutes at the START of the build, and at the peak. The floor is
 *  the transition skill (doc 01 §1.8 — bought in 10–20 min); the ceiling is
 *  durability, scaled to the race's run leg: ~60% of an Olympic 10 km, ~30% of a
 *  70.3 half, ~25% of an Ironman marathon. */
const RUN_OFF_MIN: Record<Cat, { start: number; peak: number }> = {
  olympic: { start: 12, peak: 30 },
  half: { start: 20, peak: 55 },
  full: { start: 22, peak: 80 },
};

export function brickRunOffMin(cat: Cat, phase: Phase, idxInPhase: number, phaseLen: number): number {
  const { start, peak } = RUN_OFF_MIN[cat];
  if (phase === "peak") return peak;
  if (phase !== "build") return start;
  // Position WITHIN the build, which the caller already computes for baseFraction.
  // Deriving it from weekIndex instead would sawtooth: the ramp would reset every
  // few weeks and the athlete's brick run would shrink mid-block.
  const span = Math.max(1, phaseLen - 1);
  const t = Math.min(1, Math.max(0, idxInPhase) / span);
  // The build climbs to ~80% of the ceiling so the peak weeks still add something.
  return Math.round(start + (peak * 0.8 - start) * t);
}

function pickWeekSlots(
  ctx: BuildCtx,
  p: Profile,
  cat: Cat,
  phase: Phase,
  weekIndex: number,
  isRecovery: boolean,
  idxInPhase: number,
  phaseLen: number,
): Slot[] {
  const recover = isRecovery;
  const even = weekIndex % 2 === 0;
  const runCap = LONG_RUN_CAP[cat];
  const rideCap = LONG_RIDE_CAP[cat];
  // Minutes of running straight off the bike inside a brick (#190).
  //
  // Doc 01 §5 gap #10 named this exactly: "brick run is capped short — fine for
  // skill; thin for IM run-off-bike durability". Measured before changing it,
  // every Ironman brick ran 24 min off the bike in build and 36 in peak — for a
  // race whose run leg is a marathon — and it was FLAT across the whole build,
  // with no progression at all.
  //
  // Two things bricks do, and they need different doses (doc 01 §1.8): the
  // transition SKILL is bought in 10–20 min, and short course needs little more
  // than that. DURABILITY — running well on pre-fatigued legs — is the long-course
  // limiter, and it only comes from progressively longer run-off-bike blocks
  // (§4 #8: "for IM, program at least some long run-off-bike durability work").
  //
  // So the ceiling scales with the race's run leg rather than being one number for
  // everything, and it PROGRESSES: the build ramps toward it, the peak reaches it.
  // Still a fraction of race distance — a 90 min brick run is ~25% of an Ironman
  // marathon, which is durability work, not a rehearsal of the whole leg.
  const runOff = brickRunOffMin(cat, phase, idxInPhase, phaseLen);

  // Quality arrives in base only once the athlete has a couple of aerobic weeks
  // underneath them. Week one of a brand-new plan is the single worst moment to
  // introduce intensity — it's how beginners get hurt and how a plan earns the
  // "too spicy" reputation the whole category is fighting (competitor doc §5 #1).
  const BASE_QUALITY_FROM_WEEK = 2;
  const baseQualityOk = idxInPhase >= BASE_QUALITY_FROM_WEEK;

  // How many of each sport this week — the athlete's per-sport choice, with
  // injuries reducing/substituting volume and light weeks eased off.
  const mods = injuryMods(p);
  const counts = weekSportCounts(p, phase, isRecovery, mods);

  // The day the athlete has most time for long sessions (default Saturday). The
  // long ride/brick anchors here; the long run lands the day after.
  const longDay = ((((p.longSessionDay ?? 5) % 7) + 7) % 7);
  const longRunDay = (longDay + 1) % 7;

  // ---- BIKE ---------------------------------------------------------------
  // The long anchor becomes a brick in build/peak — unless a run injury makes
  // running off the bike unwise, in which case it stays a long endurance ride.
  const brickOk =
    (phase === "build" || phase === "peak") && mods.run.capZone >= 3 && !mods.run.avoid && !mods.bike.avoid;
  const bikeRacePace = mods.bike.capZone >= 3;
  const longAnchor: Role = brickOk
    ? {
        discipline: "brick", hard: !recover, scalable: true, weight: 3.0, minMin: 45, maxMin: rideCap + runOff, prefDay: longDay,
        build: (min) => W.brick(ctx, Math.max(30, min - runOff), runOff, bikeRacePace && phase === "peak"),
      }
    : {
        discipline: "bike", hard: false, scalable: true, weight: 3.0, minMin: 45, maxMin: rideCap, prefDay: longDay,
        build: (min) => W.bikeLong(ctx, min, phase !== "base" && !recover && bikeRacePace),
      };
  // when a sport is off-limits (severe injury), keep only gentle, short sessions
  const bikeList: Role[] = mods.bike.avoid
    ? [easyBike(5, 1.0, 55), easyBike(2, 0.9, 50), easyBike(1, 0.8, 45), easyBike(0, 0.7, 40)]
    : [longAnchor, bikeQualityRole(), easyBike(2, 1.2), easyBike(1, 1.0, 60), easyBike(0, 0.8, 55), easyBike(4, 0.7, 50)];

  // ---- RUN ----------------------------------------------------------------
  const longRun: Role = {
    discipline: "run", hard: false, scalable: true, weight: 2.2, minMin: 30, maxMin: runCap, prefDay: longRunDay,
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
    : [swim(2, keySwimBuild, 1.0, true), swim(4, swim2Build, 1.0, true), easySwim(4, 0.9), easySwim(2, 0.8), easySwim(5, 0.7), easySwim(0, 0.6)];

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

  return assignDays(chosen, restDayFor(p));

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
    return swim(
      prefDay,
      (min) => (recover || phase === "taper" ? W.swimRecovery(ctx, 900) : W.swimTechnique(ctx, min)),
      w,
      true,
    );
  }

  // ---- injury-aware key sessions ------------------------------------------
  // A threshold/CSS set and an open-water swim are STRUCTURED — their shape is the
  // session, and stretching them to fill a budget would change what they train.
  // Technique and endurance carry the volume, so those are the two that move (#202).
  function keySwimBuild(min: number): Draft {
    const cap = mods.swim.capZone;
    if (phase === "base" || recover || cap < 3) return W.swimTechnique(ctx, min);
    if (phase === "peak") return W.swimOpenWater(ctx);
    if (phase === "taper") return W.swimRecovery(ctx, 1000);
    if (cap < 4) return W.swimEndurance(ctx, W.swimMainMetersFor(ctx, min));
    return W.swimThreshold(ctx);
  }
  function swim2Build(min: number): Draft {
    const cap = mods.swim.capZone;
    if (cap >= 4 && (phase === "peak" || phase === "taper")) return W.swimThreshold(ctx);
    return W.swimEndurance(ctx, W.swimMainMetersFor(ctx, min));
  }
  function bikeQualityRole(): Role {
    const cap = mods.bike.capZone;
    // BASE IS NO LONGER 100% AEROBIC (#195, Ryan's call). Measured before this,
    // base ran Z2:100% — not one tempo, threshold or interval session, which is
    // stricter than our own guidance: doc 01 §4 #3 says base is "aerobic +
    // technique + a little tempo". Sweet spot is the right base-phase quality —
    // sub-threshold, high aerobic return, low injury cost — and it is what makes
    // a base block feel like training rather than eight identical rides.
    //
    // Deliberately NOT threshold or VO2: those belong to build (§4 #3), and
    // "too spicy too early" is the exact failure that gets endurance apps blamed
    // for injuries (competitor doc §5 #1).
    if (phase === "base" && !recover && cap >= 3 && baseQualityOk) {
      // Sweet spot is zoned Z4 here (88–94% FTP straddles our Z3/Z4 boundary).
      // On a low-volume beginner plan that one session is a big share of the
      // block: olympic/beginner/5 measured 26.9% Z4+ against the 25% rail — the
      // "too spicy too early" failure, caught by railsRegressed rather than by a
      // user. Beginners get the same idea one zone down, which is what doc 01 §4
      // #3 actually asks base for anyway.
      const beginnerish = p.level === "beginner" || effectiveWorkouts(p) <= 5;
      // Sweet spot every OTHER base week, and kept short. At 60 min weekly it put
      // base weeks at 16.8% Z4+ — more than doc 01 §4 #3's "a little tempo", and
      // enough that base stopped being base. Alternating keeps real power work in
      // the block while leaving most base weeks aerobic.
      if (beginnerish || !even) return quality(3, "bike", true, () => W.bikeTempo(ctx, 55), 1.2, 40, 65);
      return quality(3, "bike", true, () => W.bikeSweetSpot(ctx, 45), 1.3, 40, 55);
    }
    if (phase === "base" || recover || cap <= 2)
      return quality(3, "bike", false, (min) => W.bikeEndurance(ctx, min), 1.4, 40, 90, true);
    // A zone-3 cap means a niggle. Sweet spot is 88–94% FTP (zoned Z4), so it is
    // ABOVE this cap — routing here used to hand a hurting athlete near-threshold
    // work from the very guard meant to prevent it. bikeTempo is the real Z3 answer,
    // and the cap has to be checked before the taper branch or taper leaks it back in.
    if (cap === 3) return quality(3, "bike", true, () => W.bikeTempo(ctx, phase === "taper" ? 50 : 70), 1.3, 40, 75);
    if (phase === "taper") return quality(3, "bike", true, () => W.bikeSweetSpot(ctx, 55), 1.3, 40, 60);
    return quality(3, "bike", true, even ? () => W.bikeThreshold(ctx) : () => W.bikeSweetSpot(ctx), 1.5, 55, 85);
  }
  function runQualityRole(): Role {
    const cap = mods.run.capZone;
    // Tempo, not threshold — see the note in bikeQualityRole. A Z3 run is the
    // most that belongs in base, and it's what doc 01 §4 #3 actually asks for.
    if (phase === "base" && !recover && cap >= 3 && baseQualityOk)
      return quality(1, "run", true, () => W.runTempo(ctx, 40), 1.2, 30, 55);
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
      // The rotation CARRIES ACROSS WEEKS. It used to be `const idx = i`, which
      // reset every Monday, so the split only ever reached its first `count`
      // days: a push-pull-legs athlete training twice a week did Push and Pull
      // and NEVER trained legs — for the whole plan — and at one gym day a week
      // did nothing but Push. Measured before this fix:
      //   1 day/wk → push          2 day/wk → push, pull        3 day/wk → all three
      // Continuing the count across weeks means every day of the split comes
      // round regardless of how often the athlete gets to the gym.
      const idx = weekIndex * count + i;
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
  function swim(prefDay: number, build: (min: number) => Draft, weight: number, scalable = false): Role {
    // Hardness has to reflect what the builder actually produces. Swim roles used to
    // be unconditionally `hard: false`, so a CSS threshold set (Z4) or a speed set
    // (Z5) was invisible to the scheduler's hard-day rules — which is exactly why
    // "CSS Threshold Set" dominated the measured back-to-back-hard pairs. Builders
    // are pure, so evaluating one here to read its zone is safe and cheap.
    const hard = build(60).primaryZone >= 4;
    return { prefDay, discipline: "swim", hard, scalable, weight, minMin: 25, maxMin: 60, build };
  }
}

// Remove sessions that fall on the athlete's blackout dates (vacation, travel).
/**
 * Clear the day before race day.
 *
 * `buildRaceWeek` already skips an opener on `raceDayIndex - 1`, but that only looks
 * *inside* race week. When race day is a Monday, the day before belongs to the previous
 * week — and nothing stopped it, so an athlete racing Monday was handed a long endurance
 * run the day before their race. Race day can land on any weekday, so this has to be a
 * whole-plan pass, not a within-week one.
 */
function clearDayBeforeRace(raceDateISO: string, weeks: Week[], workouts: Record<string, Workout>): void {
  if (!raceDateISO) return;
  const eve = addDays(raceDateISO, -1);
  for (const [id, w] of Object.entries(workouts)) {
    if (w.date !== eve) continue;
    if (w.type === "race_prep") continue; // a deliberate short opener stays
    delete workouts[id];
  }
  for (const wk of weeks) wk.workoutIds = wk.workoutIds.filter((id) => workouts[id]);
}

/** Is this a session the 48-hour rule cares about? Hard work that loads the
 *  musculoskeletal system — a Z4+ run/ride, or any brick. */
function isHardLoading(w: Workout): boolean {
  if (w.type === "race_prep" || w.discipline === "rest") return false;
  return loads(w.discipline) && (w.primaryZone >= 4 || w.type === "brick");
}

/**
 * Fix hard-day adjacency ACROSS the week boundary.
 *
 * `assignDays` reasons about one week at a time and wraps Sunday round to that same
 * week's Monday, which is the right proxy while consecutive weeks look alike. It breaks
 * exactly where weeks differ — a phase change or a deload — because week N's Sunday and
 * week N+1's Monday are chosen independently and neither knows about the other.
 *
 * Repairing that needs the same exact search `repairHardSpacing` does inside a week, but
 * with the neighbouring weeks pinned as boundary conditions. Single-session moves are not
 * enough: freeing Monday can require the Saturday brick to shift first, which no
 * one-at-a-time hill-climb will discover. Weeks are re-solved in order and the sweep runs
 * twice, so a change rippling backwards gets a second look.
 */
function spaceHardDaysAcrossWeeks(weeks: Week[], workouts: Record<string, Workout>, restDow: number): void {
  const onDate = () => {
    const m = new Map<string, Workout[]>();
    for (const w of Object.values(workouts)) {
      if (w.discipline === "rest") continue;
      if (!m.has(w.date)) m.set(w.date, []);
      m.get(w.date)!.push(w);
    }
    return m;
  };

  for (let pass = 0; pass < 2; pass++) {
    let changed = false;
    for (const wk of weeks) {
      if (wk.isRaceWeek) continue; // race week is deliberately shaped; leave it alone
      const byDate = onDate();
      const dayList = Array.from({ length: 7 }, (_, d) => byDate.get(addDays(wk.startDate, d)) ?? []);

      const movable: Workout[] = [];
      for (const list of dayList) for (const w of list) if (isHardLoading(w)) movable.push(w);
      if (!movable.length || movable.length > 5) continue;

      // what stays put: session counts, and which days already carry hard work that
      // isn't weight-bearing (a Z4 CSS swim still forbids a second hard session that day)
      const fixedCount = Array.from({ length: 7 }, () => 0);
      const fixedHard = Array.from({ length: 7 }, () => false);
      for (let d = 0; d < 7; d++) {
        for (const w of dayList[d]) {
          if (movable.includes(w)) continue;
          fixedCount[d]++;
          // as above: only weight-bearing hard work reserves the day
          if (isHardLoading(w)) fixedHard[d] = true;
        }
      }

      // the boundary: what the neighbouring weeks put on the days either side
      const prevHard = (byDate.get(addDays(wk.startDate, -1)) ?? []).some(isHardLoading);
      const nextHard = (byDate.get(addDays(wk.startDate, 7)) ?? []).some(isHardLoading);

      const startDays = movable.map((w) => w.dayIndex);
      let bestDays: number[] | null = null;
      let bestKey: [number, number] = [Infinity, Infinity];
      const pick: number[] = [];

      const evaluate = () => {
        const count = fixedCount.slice();
        const hard = fixedHard.slice();
        const hardLoad = Array.from({ length: 7 }, () => false);
        for (const d of pick) {
          count[d]++;
          if (hard[d]) return; // never two hard sessions on one day
          hard[d] = true;
          hardLoad[d] = true;
        }
        if (count.some((n) => n > MAX_PER_DAY)) return;
        let conflicts = 0;
        for (let d = 0; d < 6; d++) if (hardLoad[d] && hardLoad[d + 1]) conflicts++;
        if (prevHard && hardLoad[0]) conflicts++;
        if (nextHard && hardLoad[6]) conflicts++;
        let disp = 0;
        for (let k = 0; k < pick.length; k++) disp += Math.abs(pick[k] - startDays[k]);
        if (conflicts < bestKey[0] || (conflicts === bestKey[0] && disp < bestKey[1])) {
          bestKey = [conflicts, disp];
          bestDays = pick.slice();
        }
      };

      const rec = (k: number) => {
        if (k === movable.length) { evaluate(); return; }
        for (let d = 0; d < 7; d++) {
          if (d === restDow) continue;
          if (fixedHard[d]) continue;
          pick.push(d);
          rec(k + 1);
          pick.pop();
        }
      };
      rec(0);

      if (!bestDays) continue;
      movable.forEach((w, k) => {
        const to = bestDays![k];
        if (w.dayIndex === to) return;
        w.dayIndex = to;
        w.date = addDays(wk.startDate, to);
        changed = true;
      });
    }
    if (!changed) break;
  }
}

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

/** The most sessions a single day can hold. 7 × 3 = 21 = MAX_WORKOUTS. */
const MAX_PER_DAY = 3;

/** Does this discipline load the musculoskeletal system the way running and riding
 *  do? Swimming doesn't — which is why it's exempt from cross-day hard spacing. */
function loads(d: Discipline): boolean {
  return d === "run" || d === "bike" || d === "brick";
}
/** Above this, a week physically cannot fit inside six days, so the rest-day floor
 *  yields rather than producing an infeasible schedule. 6 days × 3 = 18. */
const REST_DAY_FEASIBLE_MAX = 18;

/**
 * The day this athlete gets completely off.
 *
 * A full day off is a **floor, not a preference**. `restDayPreference` decides
 * *which* day; it does not decide *whether*. Before this, the guard sat behind a
 * `!= null` check, so an athlete who skipped the optional onboarding chip got no
 * protected day at all — measured at 8 sessions/week that produced 14 off days in a
 * 147-day plan and a 30-day unbroken training streak.
 *
 * Derived from the **profile only**, never from a given week's roles, so it is the
 * same day for the whole plan. A rest day that drifts week to week isn't a rest day
 * an athlete can build a life around — and it silently reintroduces long streaks,
 * because resting Monday one week and Friday the next leaves nine days on in between.
 *
 * Default: two days after the long session — the classic day off following a big
 * weekend (long day Sat → rest Monday).
 */
export function restDayFor(p: Profile): number {
  const pref = p.restDayPreference;
  if (pref != null && Number.isInteger(pref) && pref >= 0 && pref < 7) return pref;
  return (((p.longSessionDay ?? 5) + 2) % 7 + 7) % 7;
}

/**
 * Second pass: fix hard-day adjacency the greedy placement couldn't.
 *
 * The scoring pass is single-shot with no backtracking, so it can paint itself into a
 * corner — place the brick on Sunday and the hard ride on Thursday and *every*
 * remaining day is adjacent to one of them, even though {Wed, Fri, Sun} would have
 * worked. Escaping needs two sessions to move at once, which no hill-climb on single
 * moves will find.
 *
 * There are at most a handful of hard weight-bearing sessions and seven days, so this
 * just enumerates the placements exactly and takes the best one: fewest adjacent hard
 * days first, then least displacement from everyone's preferred day. Cheap, exhaustive
 * within its bound, and it leaves every other session exactly where the greedy put it.
 */
function repairHardSpacing(out: Slot[], restDay: number | undefined): void {
  const movable = out.map((s, i) => ({ s, i })).filter(({ s }) => s.hard && loads(s.discipline));
  if (movable.length < 2 || movable.length > 6) return; // nothing to do / too big to enumerate

  const isMovable = new Set(movable.map((m) => m.i));
  // everything else stays put — count what it already occupies, and where the
  // non-loading hard work (a CSS swim) sits, so the same-day rule still holds.
  const fixedLoad = Array.from({ length: 7 }, () => 0);
  const fixedHard = Array.from({ length: 7 }, () => false);
  out.forEach((s, i) => {
    if (isMovable.has(i)) return;
    fixedLoad[s.day]++;
    // Only weight-bearing hard work reserves a day. A hard CSS swim sharing a day with a
    // hard ride is an ordinary AM/PM double; blocking it would strand the repair and force
    // a 48-hour violation instead, which is the far worse trade.
    if (s.hard && loads(s.discipline)) fixedHard[s.day] = true;
  });

  const prefOf = movable.map(({ s }) => s.day); // greedy's answer doubles as the preference to stay near
  const circ = (a: number, b: number) => Math.min(Math.abs(a - b), 7 - Math.abs(a - b));

  let bestDays: number[] | null = null;
  let bestKey: [number, number] = [Infinity, Infinity];
  const pick: number[] = [];

  const evaluate = () => {
    const load = fixedLoad.slice();
    const hard = fixedHard.slice();
    const hardLoad = Array.from({ length: 7 }, () => false);
    for (const d of pick) {
      load[d]++;
      if (hard[d]) return; // two hard sessions on one day — never
      hard[d] = true;
      hardLoad[d] = true;
    }
    if (load.some((n) => n > MAX_PER_DAY)) return;
    let conflicts = 0;
    for (let d = 0; d < 7; d++) if (hardLoad[d] && hardLoad[(d + 1) % 7]) conflicts++;
    let disp = 0;
    for (let k = 0; k < pick.length; k++) disp += circ(pick[k], prefOf[k]);
    const key: [number, number] = [conflicts, disp];
    if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
      bestKey = key;
      bestDays = pick.slice();
    }
  };

  const rec = (k: number) => {
    if (k === movable.length) { evaluate(); return; }
    for (let d = 0; d < 7; d++) {
      if (restDay != null && d === restDay) continue;
      if (fixedHard[d]) continue; // a hard session already lives here
      pick.push(d);
      rec(k + 1);
      pick.pop();
    }
  };
  rec(0);

  if (bestDays) movable.forEach((m, k) => { out[m.i].day = bestDays![k]; });
}

// Spread the chosen sessions across the 7 days: fill empty days first, then
// stack (up to 3/day), never two hard sessions on one day OR on consecutive days,
// keep sports apart, stay near each session's preferred day, and always keep one
// day completely clear.
function assignDays(roles: Role[], restDayOfWeek: number): Slot[] {
  const day: { hard: boolean; disc: Discipline }[][] = Array.from({ length: 7 }, () => []);
  const out: Slot[] = [];
  // Only a week that genuinely cannot fit inside six days gives the day back.
  const restDay = roles.length > REST_DAY_FEASIBLE_MAX ? undefined : restDayOfWeek;
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
  // greedy is single-shot; give the hard days an exact second look
  repairHardSpacing(out, restDay);
  return out;

  function score(d: number, r: Role): number {
    const cur = day[d];
    if (cur.length >= MAX_PER_DAY) return -1e6; // a day holds at most three sessions

    // The rest day is a hard block, not a heavy penalty — it only yields once every
    // other day is genuinely full, which is the one case where a 7th day is the
    // honest answer rather than a scheduling failure.
    if (restDay != null && d === restDay) {
      const roomElsewhere = day.some((c, i) => i !== restDay && c.length < MAX_PER_DAY);
      if (roomElsewhere) return -1e6;
    }

    let s = -cur.length * 25; // spread across days before doubling up
    if (r.hard && cur.some((x) => x.hard)) s -= 400; // never two hard sessions a day

    // ...and hard WEIGHT-BEARING work not on consecutive days either. The week wraps
    // because the pattern repeats weekly, so Sunday's neighbour really is next Monday.
    //
    // Swimming is deliberately exempt from the cross-day rule (though not the same-day
    // one): it's non-weight-bearing and far less systemically taxing, so hard run
    // Tuesday / hard swim Wednesday / hard ride Thursday is a well-spaced week, not
    // three hard days in a row. Constraining it would force real conflicts for no
    // physiological gain — the run and the ride are what need 48 h between them.
    //
    // Weighted above the same-day term's junior partner but below it, so stacking on
    // one day stays worse than adjacency, and well above the prefDay pull (+100) so
    // spacing wins that argument rather than losing it.
    if (r.hard && loads(r.discipline)) {
      const prev = day[(d + 6) % 7];
      const next = day[(d + 1) % 7];
      const hardNeighbour = (c: typeof cur) => c.some((x) => x.hard && loads(x.disc));
      if (hardNeighbour(prev)) s -= 250;
      if (hardNeighbour(next)) s -= 250;
    }

    if (cur.some((x) => x.disc === r.discipline)) s -= 30; // avoid same-sport doubles
    const dist = Math.min(Math.abs(d - r.prefDay), 7 - Math.abs(d - r.prefDay));
    s -= dist * 6; // stay near the preferred day (week wraps)
    if (d === r.prefDay) s += cur.length === 0 ? 100 : 20;
    return s;
  }
}

// ---- assemble the whole plan --------------------------------------------

export function generatePlan(profile: Profile, anchorISO?: string): Plan {
  // No race on the calendar → a rolling fitness block instead of a countdown.
  if (isFitnessGoal(profile)) return generateFitnessPlan(profile, anchorISO);

  const cat = categoryOf(profile);
  const paces = derivePaces(profile);
  const ctx: BuildCtx = { paces, level: profile.level };

  // plan length from race date. Day 0 is the athlete's chosen start date — onboarding lets
  // them pick one (default: today), so the plan can begin now or on a later date they choose.
  // We never start in the past: anything today-or-earlier (and rebuilds, which pass nothing)
  // anchors to today. Race day stays fixed, so a later start just means fewer weeks to train.
  const start0 = mondayOf(anchorISO && anchorISO > todayISO() ? anchorISO : todayISO());
  const raceMonday = mondayOf(profile.raceDateISO);
  const weeksUntil = weeksBetween(start0, raceMonday) + 1; // include race week
  const min = PLAN_MIN[cat];

  let totalWeeks: number;
  let compressed = false;
  let delayedStart = false;
  if (weeksUntil < min) {
    totalWeeks = Math.max(4, weeksUntil);
    compressed = true;
  } else if (weeksUntil > MAX_PLAN_WEEKS) {
    // pathologically far out (>1 year): cap the structured plan; it begins closer to race.
    totalWeeks = MAX_PLAN_WEEKS;
    delayedStart = true;
  } else {
    // the common case: span the whole runway, starting the week they signed up.
    totalWeeks = weeksUntil;
  }

  // start Monday chosen so the last week contains race day
  let startMonday = addDays(raceMonday, -(totalWeeks - 1) * 7);
  // Never begin in the past. A race sooner than the category minimum inflates totalWeeks
  // (Math.max(4, …)) above, which would back-date startMonday before the athlete's actual
  // start — clamp to start0 and recompute the span from the real runway so the plan starts
  // now and the race still lands in the last week.
  if (startMonday < start0) {
    startMonday = start0;
    totalWeeks = weeksBetween(startMonday, raceMonday) + 1;
  }

  // phase split. Build is a *bounded* specific-prep block; base — the aerobic development
  // that determines long-course performance — is the residual, so extra lead time lengthens
  // the BASE, never the build. This upholds "moving the race later never shortens the base
  // phase" (doc 04 §4.4) and avoids stacking many weeks of near-peak build load (an
  // overtraining trap). base ramps gently (0.6→0.85 of peak, `baseFraction`) with 3:1/2:1
  // recovery cycles, so a long base is a slow aerobic build, not monotonic overload.
  const taperWeeks = Math.min(TAPER_WEEKS[cat], Math.max(1, Math.floor(totalWeeks * 0.18)));
  // The phases MUST sum to totalWeeks, or the week loop below never reaches the taper
  // branch and the race week inherits whatever phase ran off the end. That's what used
  // to happen on a short runway: a race ≤13 days out got NO taper phase, and race week
  // was labelled "Build" carrying the highest targetHours in the plan — i.e. we told
  // someone racing in 13 days that this was their biggest week.
  const remaining = Math.max(0, totalWeeks - taperWeeks);
  let peakWeeks = remaining >= 6 ? Math.min(2, Math.max(1, Math.round(remaining * 0.12))) : remaining >= 4 ? 1 : 0;
  let buildWeeks = remaining > 0 ? Math.min(BUILD_MAX[cat], Math.max(1, Math.round(remaining * 0.35))) : 0;
  let baseWeeks = remaining - buildWeeks - peakWeeks;
  if (remaining > 0 && baseWeeks < 1) {
    // ultra-compressed plans: guarantee ≥1 base week, then trim build/peak to fit.
    // Build and peak may go to ZERO here — a 2-week runway is base + taper, nothing else.
    baseWeeks = 1;
    buildWeeks = Math.max(0, remaining - baseWeeks - peakWeeks);
    peakWeeks = Math.max(0, remaining - baseWeeks - buildWeeks);
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

    // Plain "Week N", not "Base 2" / "Build 1" (#114). The phase still drives the
    // physiology and is still SHOWN where it earns its place — it just isn't the
    // athlete's name for the week any more. The old scheme also restarted numbering
    // inside each phase, so the same week read "Week 9" on Plan and "Build 1" on
    // Today. Race week keeps its name because that one means something to everyone.
    const label = isRaceWeek
      ? "Race Week"
      : phase === "base"
      ? `Week ${i + 1}${isRecovery ? " · Recovery" : ""}`
      : phase === "build"
      ? `Week ${i + 1}${isRecovery ? " · Recovery" : ""}`
      : phase === "peak"
      ? `Week ${i + 1}`
      : `Week ${i + 1}`;

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
      buildNormalWeek(ctx, profile, cat, phase, i, isRecovery, targetHours, week, workouts, idxInPhase, phaseLen);
    }

    weeks.push(week);
  }

  // the week-by-week scheduler can't see across its own boundary
  spaceHardDaysAcrossWeeks(weeks, workouts, restDayFor(profile));
  // race eve is a rest day, whichever week it happens to fall in
  clearDayBeforeRace(profile.raceDateISO, weeks, workouts);
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
function generateFitnessPlan(profile: Profile, anchorISO?: string): Plan {
  const cat = categoryOf(profile); // "olympic" volumes by default; honours a chosen distance
  const paces = derivePaces(profile);
  const ctx: BuildCtx = { paces, level: profile.level };

  // day 0 = the athlete's chosen start date (default today); never the past. See generatePlan.
  const startMonday = mondayOf(anchorISO && anchorISO > todayISO() ? anchorISO : todayISO());
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
    const label = `Week ${i + 1}${isRecovery ? " · Recovery" : ""}`; // plain, not "Base 2" (#114)

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
    buildNormalWeek(ctx, profile, cat, phase, i, isRecovery, targetHours, week, workouts, idxInPhase, phaseLen);
    weeks.push(week);
  }

  spaceHardDaysAcrossWeeks(weeks, workouts, restDayFor(profile));
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
  idxInPhase: number,
  phaseLen: number,
) {
  const slots = pickWeekSlots(ctx, profile, cat, phase, weekIndex, isRecovery, idxInPhase, phaseLen);

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

  // Hard-enforce an explicit weeklyHoursCap. targetHours already respects the cap,
  // but nothing held the *emitted* sessions to it: fixed sessions are built at their
  // intrinsic durations regardless of budget, and the minMin floor re-inflates the
  // scalables — so a 3 h cap with 8 sessions was handing back a 6 h week. The athlete
  // asked for a ceiling; honour it, shortening first and only then dropping work.
  let active = slots;
  const capSec =
    profile.weeklyHoursCap && profile.weeklyHoursCap > 0 ? profile.weeklyHoursCap * 3600 : null;
  if (capSec != null) {
    const FLOOR_SEC = 20 * 60; // below this a session stops being worth doing
    const totalSec = () => active.reduce((a, s) => a + (built.get(s)?.estDurationSec ?? 0), 0);

    // 1) shrink the scalable sessions proportionally toward the floor
    if (totalSec() > capSec) {
      const scal = active.filter((s) => s.scalable);
      const scalSec = scal.reduce((a, s) => a + built.get(s)!.estDurationSec, 0);
      const budget = Math.max(0, capSec - (totalSec() - scalSec));
      if (scalSec > budget && scalSec > 0) {
        const k = budget / scalSec;
        for (const s of scal) {
          const next = Math.max(FLOOR_SEC, Math.round(built.get(s)!.estDurationSec * k));
          built.set(s, s.build(Math.round(next / 60)));
        }
      }
    }
    // 2) still over — the fixed work alone blows the budget, so the only honest
    //    answer is fewer sessions. Slots come out of pickWeekSlots in priority
    //    order, so the tail is the least important work of the week.
    while (totalSec() > capSec && active.length > 1) active = active.slice(0, -1);
  }

  // emit workouts. A day can hold up to three sessions, so ids are disambiguated.
  const idSeq: Record<string, number> = {};
  for (const s of active) {
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
      // Which gym day of the split this is, so a saved routine can find it
      // (lib/routines.ts). Dropping it here is invisible — `slotOf` falls back
      // to parsing the title — which is exactly why it's worth carrying.
      ...(draft.strengthSlot ? { strengthSlot: draft.strengthSlot } : {}),
      status: "planned",
    };
    out[id] = wk;
    week.workoutIds.push(id);
  }
  // sort by day, then longest session first within a day (the "main" one on top)
  week.workoutIds.sort(
    (a, b) => out[a].dayIndex - out[b].dayIndex || out[b].estDurationSec - out[a].estDurationSec,
  );

  // Make the week specific to the course being raced (#85). Runs AFTER the sort
  // so the choice of which sessions become hill work is deterministic, and after
  // the cap so it can never resurrect a session the hours ceiling dropped. It
  // rewrites prescriptions only — zone, type and duration are preserved — so
  // every budget computed above still holds.
  applyTerrainToWeek(week.workoutIds, out, terrainOf(profile), phase, isRecovery);
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
  // Race week is the highest-stakes week of the plan, so it honours the same
  // injury caps and equipment limits every other week does — it used to ignore
  // both, handing a Z4 threshold run to an athlete whose plan had spent the
  // whole build avoiding running, and a pool session to someone with no pool.
  const mods = injuryMods(profile);
  const openerFor = (d: Sport, sharp: () => Draft, gentle: () => Draft) => {
    const m = mods[d];
    if (m.avoid) return null; // the sport we've protected all plan — not now either
    return m.capZone >= 4 ? sharp : gentle;
  };

  // a couple of short openers
  if (D.has(1)) {
    const b = openerFor("run", () => W.runThreshold(ctx, 35), () => W.runEasy(ctx, 30));
    if (b) openers.push({ day: 1, build: b });
  }
  if (D.has(3)) {
    const b = openerFor("bike", () => W.bikeSweetSpot(ctx, 45), () => W.bikeEndurance(ctx, 40));
    if (b) openers.push({ day: 3, build: b });
  }
  if (D.has(2) && profile.equipment?.pool !== false) {
    const b = openerFor("swim", () => W.swimRecovery(ctx, 800), () => W.swimRecovery(ctx, 800));
    if (b) openers.push({ day: 2, build: b });
  }

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
      // Which gym day of the split this is, so a saved routine can find it
      // (lib/routines.ts). Dropping it here is invisible — `slotOf` falls back
      // to parsing the title — which is exactly why it's worth carrying.
      ...(draft.strengthSlot ? { strengthSlot: draft.strengthSlot } : {}),
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
    // The course gets the last word on race day. Riding a climb to your flat power
    // target is the single most common way a good race falls apart in T2, so the
    // pacing note leads rather than being buried in a segment cue. Flat courses
    // get no note — inventing advice there teaches athletes to skip this line on
    // the courses where it matters (#85).
    purpose: [
      "This is what it was all for. Execute your pacing, fuel early and often, and enjoy every stroke, pedal, and stride.",
      pacingNote(terrainOf(profile)),
    ]
      .filter(Boolean)
      .join(" "),
    primaryZone: 3,
    terrainFocus: terrainOf(profile),
    estDurationSec: estimateRaceSeconds(ctx.paces, profile.level, cat, dist, terrainOf(profile)),
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
        // Race-bike intensity rises sharply as the distance falls. Olympic sits at
        // 88–95% FTP, which escapes Z3's 76–90% — so it carries an explicit band and
        // the Z4 label that actually matches the effort, rather than showing the
        // athlete a target that contradicts the instruction next to it.
        zone: cat === "full" ? 2 : cat === "half" ? 3 : 4,
        ftpPct: cat === "full" ? [70, 75] : cat === "half" ? [80, 85] : [88, 95],
        distanceM: dist.bike,
        // Describe the effort, not the percentage. The %FTP band still travels on
        // `ftpPct` above, so targetView() shows watts to anyone with a meter — and
        // heart rate or RPE to everyone else. Baking "@ 80–85% FTP" into the words
        // made the most important session of the block unreadable to exactly the
        // athlete onboarding had just told to leave FTP blank.
        description: `Bike ${(dist.bike / 1000).toFixed(0)} km — ${
          cat === "full" ? "steady all day; never feels hard" : cat === "half" ? "strong but controlled" : "hard and committed"
        }`,
        cue: "Ride your own effort, not the wheel beside you. Fuel 60–90g carbs/hour. Save the legs for the run.",
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
