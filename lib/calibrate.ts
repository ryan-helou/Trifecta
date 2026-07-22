import { Discipline, PaceCalibration, Plan, Workout, Zone } from "./types";
import { CAL_MAX } from "./paces";
import { ZONES } from "./zones";
import { addDays } from "./dates";
import { creditedDiscipline } from "./adapt";

// ---------------------------------------------------------------------------
// Pace calibration — the honest fix for "the plan runs too spicy."
//
// Reads the last few weeks of completed sessions and, per discipline, asks:
// were the targets harder or easier than they should have been? The signal is
//   • perceived — RPE and "feel" vs. the zone the session prescribed, and
//   • objective — average HR vs. the zone's HR band (device-synced, when maxHR
//     is known).
// If sessions consistently ran hotter than prescribed, the targets get eased;
// if they were consistently comfortable, they sharpen. Output is a signed
// per-discipline adjustment (see PaceCalibration) that derivePaces applies — so
// one number flows through generation, rebuild, and display. Pure: no I/O.
// ---------------------------------------------------------------------------

const WINDOW_DAYS = 28; // look back four weeks
const MIN_SIGNALS = 3; // need a few sessions before we trust a discipline's signal
const DEADBAND = 1.0; // ignore drift smaller than ~1 RPE off target
const MAX_STEP = 0.04; // never move a target more than 4% per calibration
const CAL_DISCIPLINES: Discipline[] = ["run", "bike", "swim"];

const isDone = (w: Workout) => w.status === "done" || w.status === "swapped";
const zoneRpeMid = (z: Zone) => (ZONES[z].rpe[0] + ZONES[z].rpe[1]) / 2;
const zoneHrMid = (z: Zone) => (ZONES[z].hrPct[0] + ZONES[z].hrPct[1]) / 2;
const FEEL_DELTA = { rough: 2, ok: 0, great: -1.5 } as const;

/** One session's "strain delta" in RPE-equivalent units: how much harder (+) or
 *  easier (−) it actually was than the zone it prescribed. null if no signal. */
function strainDelta(w: Workout, maxHR: number | null): number | null {
  const parts: number[] = [];
  if (typeof w.rpe === "number") parts.push(w.rpe - zoneRpeMid(w.primaryZone));
  if (w.feel) parts.push(FEEL_DELTA[w.feel]);
  if (maxHR && w.actuals?.avgHr) {
    const actualPct = (w.actuals.avgHr / maxHR) * 100;
    // ~4% of HRmax ≈ one RPE point
    parts.push((actualPct - zoneHrMid(w.primaryZone)) / 4);
  }
  if (!parts.length) return null;
  return parts.reduce((a, b) => a + b, 0) / parts.length;
}

export interface DisciplineCalibration {
  discipline: Discipline;
  before: number;
  after: number;
  avgStrain: number;
  samples: number;
}

export interface CalibrationResult {
  calibration: PaceCalibration;
  changed: boolean;
  perDiscipline: DisciplineCalibration[];
  notes: string[];
}

const clampCal = (v: number) => Math.max(-CAL_MAX, Math.min(CAL_MAX, v));

/**
 * Compute an updated pace calibration from recent sessions. Returns null when
 * nothing moved (not enough data, or every discipline is on target). `todayISO`
 * anchors the look-back window (pass it for deterministic tests).
 */
export function calibratePaces(plan: Plan, todayISO: string): CalibrationResult | null {
  const maxHR = plan.paces.hr.maxHR;
  const since = addDays(todayISO, -WINDOW_DAYS);
  const prev = plan.profile.calibration ?? { run: 0, swim: 0, bike: 0, updatedISO: "" };

  // bucket recent completed sessions' strain by the sport they count toward
  const strainBy: Record<Discipline, number[]> = { run: [], bike: [], swim: [], brick: [], strength: [], rest: [] };
  for (const w of Object.values(plan.workouts)) {
    if (!isDone(w) || w.date < since || w.date > todayISO) continue;
    const disc = creditedDiscipline(w);
    if (!CAL_DISCIPLINES.includes(disc)) continue; // bricks/strength don't calibrate a pace anchor
    const d = strainDelta(w, maxHR);
    if (d != null) strainBy[disc].push(d);
  }

  const perDiscipline: DisciplineCalibration[] = [];
  const notes: string[] = [];
  const next: PaceCalibration = { ...prev, updatedISO: todayISO };
  let changed = false;

  for (const disc of CAL_DISCIPLINES) {
    const samples = strainBy[disc];
    const before = prev[disc as "run" | "swim" | "bike"] ?? 0;
    if (samples.length < MIN_SIGNALS) {
      perDiscipline.push({ discipline: disc, before, after: before, avgStrain: 0, samples: samples.length });
      continue;
    }
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    let after = before;
    if (Math.abs(avg) >= DEADBAND) {
      // harder-than-prescribed (avg > 0) → ease the target (adjustment down);
      // easier-than-prescribed → sharpen (adjustment up). Move by a capped step.
      const nudge = Math.max(-MAX_STEP, Math.min(MAX_STEP, -avg * 0.02));
      after = clampCal(before + nudge);
    }
    perDiscipline.push({ discipline: disc, before, after, avgStrain: avg, samples: samples.length });
    if (Math.abs(after - before) > 1e-4) {
      changed = true;
      next[disc as "run" | "swim" | "bike"] = after;
      const pct = Math.round((after - before) * 100);
      notes.push(
        avg > 0
          ? `${cap(disc)} targets ran hot — eased ~${Math.abs(pct)}%.`
          : `You're ${disc === "swim" ? "swimming" : disc === "bike" ? "riding" : "running"} strong — sharpened ~${Math.abs(pct)}%.`,
      );
    }
  }

  if (!changed) return null;
  return { calibration: next, changed, perDiscipline, notes };
}

/** Whether enough time has passed to auto-recalibrate (weekly cadence). */
export function calibrationDue(plan: Plan, todayISO: string): boolean {
  const cal = plan.profile.calibration;
  if (!cal?.updatedISO) return true;
  return todayISO >= addDays(cal.updatedISO, 7);
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
