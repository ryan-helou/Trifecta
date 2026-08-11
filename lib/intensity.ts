// ---------------------------------------------------------------------------
// The training-intensity distribution (TID) — one table, read by everything.
//
// WHY THIS MODULE EXISTS
// The engine used to have no TID *target* at all. Intensity was emergent: quality
// sessions were fixed-length and non-scalable, so every extra hour of weekly volume
// became pure easy volume and diluted the hard share. Measured on the real engine, an
// elite Ironman build came out **95.8% easy / 3.9% threshold / 0.3% hard** — and it got
// *easier* the fitter the athlete was, which is backwards. Doc 04 §4.1 #12 already
// flagged the distribution as "currently emergent, unchecked".
//
// WHAT THE FIELD ACTUALLY DOES
//   • Polarized is usually quoted 80/15/5 or 75–80 / 5 / 15–20.
//   • A measured 70.3 cohort split POL 84.5/4.2/11.3 vs PYR 77.9/18.8/3.3 — and it was
//     *zone-2 (threshold) time* that correlated with the better half-Ironman.
//   • Long-course guidance is polarized early → pyramidal near the race; Plews' own
//     specific-phase week measures 64/25/11.
//   • The reason is specificity: Ironman athletes race 74–96% of the bike and run in
//     zone 2, so the distribution has to migrate toward the race, not away from it.
//
// THE THREE ZONES HERE ARE THE PHYSIOLOGICAL ONES, not the app's five:
//   easy      = below LT1            → app Z1–Z2
//   threshold = between LT1 and LT2  → app Z3–Z4
//   hard      = above LT2            → app Z5
//
// SCALED BY LEVEL, DELIBERATELY. "Match the pros" is the goal, but a first-timer must
// not be handed Blummenfelt's distribution — that is what `level` is for, and doc 01
// §4 #2 warns that "too spicy" is the single biggest way to lose (and injure) a user.
// So `elite` gets the full pyramidal shape and `beginner` stays close to the classic
// 80/20. Everything in between interpolates by table, not by formula, so each row can
// be reasoned about on its own.
//
// Pure — no clock, no I/O.
// ---------------------------------------------------------------------------

import { Cat, Level, Phase } from "./types";

export interface IntensityTarget {
  /** share of endurance TIME below LT1 (app Z1–Z2) */
  easy: number;
  /** share between LT1 and LT2 (app Z3–Z4) */
  threshold: number;
  /** share above LT2 (app Z5) */
  hard: number;
}

/** threshold + hard — the slice of the week the engine budgets for quality BEFORE it
 *  hands the remainder to easy volume. This ordering is the whole fix. */
export function qualityShare(t: IntensityTarget): number {
  return t.threshold + t.hard;
}

const T = (easy: number, threshold: number, hard: number): IntensityTarget => ({ easy, threshold, hard });

// The base table: level × phase. Polarized-ish in base, pyramidal by peak.
// Read a row left to right and you are watching a season migrate toward its race.
const TABLE: Record<Level, Record<"base" | "build" | "peak", IntensityTarget>> = {
  beginner:     { base: T(0.88, 0.10, 0.02), build: T(0.85, 0.12, 0.03), peak: T(0.82, 0.14, 0.04) },
  intermediate: { base: T(0.85, 0.12, 0.03), build: T(0.80, 0.16, 0.04), peak: T(0.75, 0.19, 0.06) },
  advanced:     { base: T(0.82, 0.14, 0.04), build: T(0.76, 0.19, 0.05), peak: T(0.70, 0.22, 0.08) },
  elite:        { base: T(0.80, 0.15, 0.05), build: T(0.72, 0.22, 0.06), peak: T(0.65, 0.25, 0.10) },
};

const LEVEL_ORDER: Level[] = ["beginner", "intermediate", "advanced", "elite"];

/** One level gentler, floored at beginner. Used for masters (doc 01 §4 #12: recovery is
 *  the constraint — more easy volume, fewer hard days). */
function easier(level: Level): Level {
  return LEVEL_ORDER[Math.max(0, LEVEL_ORDER.indexOf(level) - 1)];
}

/**
 * Shift the mix by race distance (doc 01 §4 #3 — shape quality by the RACE, not one dogma).
 *
 * A full Ironman is raced at tempo-to-sweet-spot for eight-plus hours, so its quality
 * belongs at threshold, not above it: VO2 work buys a ceiling the athlete will never
 * visit on race day. Olympic-distance racing genuinely is run above threshold, so it
 * earns the opposite trade. The TOTAL quality share is preserved either way — this only
 * decides where inside the quality budget the time lands.
 */
function byDistance(t: IntensityTarget, cat: Cat): IntensityTarget {
  if (cat === "full") {
    const moved = t.hard * 0.4; // long course: push VO2 down into threshold
    return { easy: t.easy, threshold: t.threshold + moved, hard: t.hard - moved };
  }
  if (cat === "olympic") {
    const moved = t.threshold * 0.3; // short course: buy the top end back
    return { easy: t.easy, threshold: t.threshold - moved, hard: t.hard + moved };
  }
  return t;
}

export interface IntensityOpts {
  /** ≥50 — forces the gentler row (doc 01 §4 #5, #12) */
  masters?: boolean;
}

/**
 * The intensity mix this week should aim for.
 *
 * `taper` deliberately returns the PEAK mix: doc 01 §4 #6 is explicit that a taper cuts
 * volume and HOLDS intensity. Because the budget below is a *share* of a collapsing
 * volume, holding the share is exactly what "keep the sharpness, lose the fatigue" means
 * in numbers. (The rails exempt the taper from the per-week ceiling for the same reason.)
 *
 * `isRecovery` returns an easy-dominant mix. A deload that carries a threshold session is
 * not a deload, and `test/engine.test.ts` asserts recovery weeks stay aerobic.
 */
export function intensityTarget(
  cat: Cat,
  level: Level,
  phase: Phase,
  isRecovery = false,
  opts: IntensityOpts = {},
): IntensityTarget {
  if (isRecovery) return T(0.95, 0.05, 0);
  const row = TABLE[opts.masters ? easier(level) : level];
  let key: "base" | "build" | "peak" = phase === "base" ? "base" : phase === "build" ? "build" : "peak";
  // Long course inverts the usual shape of a peak. For a 10K or an Olympic triathlon the
  // most race-specific session is also the sharpest, so peak is the hardest phase. For an
  // Ironman the most race-specific session is a five-hour ride at 70–75% FTP — race
  // simulation IS aerobic work. Asking a full-distance peak to be more intense than its
  // build would mean adding intensity the athlete will never use on race day, at the exact
  // moment they can least afford the fatigue. So full distance peaks on its build mix.
  if (cat === "full" && key === "peak") key = "build";
  return byDistance(row[key], cat);
}

/** Is this athlete a masters athlete on today's date? Doc 01 §4 #5 forces a 2:1 load
 *  cycle and §4 #12 lowers peak density from 50 onward. Birth YEAR (not age) is what the
 *  profile stores, so this is deliberately coarse — a year either way changes nothing. */
export const MASTERS_AGE = 50;

export function ageFromBirthYear(birthYear: number | undefined, todayISO: string): number | null {
  if (!birthYear || !Number.isFinite(birthYear)) return null;
  const year = Number(todayISO.slice(0, 4));
  const age = year - birthYear;
  return age >= 10 && age <= 110 ? age : null; // anything else is a typo, not an athlete
}

export function isMasters(birthYear: number | undefined, todayISO: string): boolean {
  const age = ageFromBirthYear(birthYear, todayISO);
  return age != null && age >= MASTERS_AGE;
}
