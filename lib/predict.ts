import { Level, PaceModel, Profile, Zone } from "./types";
import { derivePaces } from "./paces";
import { categoryOf, estimateRaceSeconds, raceDistances } from "./planEngine";
import { todayISO, weeksBetween } from "./dates";

// ---------------------------------------------------------------------------
// Race-time projection. Turns the athlete's paces into a projected finish time —
// both at today's fitness and after they've completed the plan — so we can show
// the "here's what the work buys you" hook (onboarding) and a living race-time
// estimate that sharpens as calibration dials the paces in (Profile).
//
// Pure: reads a Profile, no I/O. The "with a plan" gain is a conservative,
// evidence-shaped estimate of the fitness a full build delivers — bigger for
// beginners, smaller for the already-fast, and scaled by weeks left to train.
// ---------------------------------------------------------------------------

// Fractional improvement to threshold fitness a full build tends to deliver.
const LEVEL_GAIN: Record<Level, number> = {
  beginner: 0.1,
  intermediate: 0.06,
  advanced: 0.04,
  elite: 0.025,
};
// Gains scale with weeks left, saturating around a full training block.
const GAIN_WEEKS = 16;

export interface RaceProjection {
  currentSec: number; // projected finish at today's fitness
  projectedSec: number; // projected finish after completing the plan
  gainSec: number; // time the plan is worth (current − projected), ≥ 0
  weeksToRace: number;
  gainFrac: number; // fitness improvement modelled (0 when no weeks remain)
}

/** Scale a pace model by a fitness gain (fraction): faster run/swim, higher FTP. */
function sharpen(p: PaceModel, g: number): PaceModel {
  if (g <= 0) return p;
  const runZones = {} as PaceModel["run"]["zones"];
  const swimZones = {} as PaceModel["swim"]["zones"];
  ([1, 2, 3, 4, 5] as Zone[]).forEach((z) => {
    runZones[z] = {
      loSecPerKm: p.run.zones[z].loSecPerKm * (1 - g),
      hiSecPerKm: p.run.zones[z].hiSecPerKm * (1 - g),
    };
    swimZones[z] = {
      loSecPer100: p.swim.zones[z].loSecPer100 * (1 - g),
      hiSecPer100: p.swim.zones[z].hiSecPer100 * (1 - g),
    };
  });
  return {
    ...p,
    run: { ...p.run, thresholdSecPerKm: p.run.thresholdSecPerKm * (1 - g), zones: runZones },
    swim: { ...p.swim, cssSecPer100: p.swim.cssSecPer100 * (1 - g), zones: swimZones },
    bike: { ...p.bike, ftp: p.bike.ftp ? Math.round(p.bike.ftp * (1 + g)) : p.bike.ftp },
  };
}

/**
 * Project a finish time for the athlete's race, now vs. after the plan.
 * `fromISO` defaults to today; pass it so the estimate is deterministic in tests.
 */
export function projectRace(profile: Profile, fromISO: string = todayISO()): RaceProjection {
  const cat = categoryOf(profile);
  const dist = raceDistances(profile);
  const paces = derivePaces(profile); // already includes any calibration
  const weeksToRace = Math.max(0, weeksBetween(fromISO, profile.raceDateISO));

  const currentSec = estimateRaceSeconds(paces, profile.level, cat, dist);
  const gainFrac = LEVEL_GAIN[profile.level] * Math.min(weeksToRace, GAIN_WEEKS) / GAIN_WEEKS;
  const projectedSec = estimateRaceSeconds(sharpen(paces, gainFrac), profile.level, cat, dist);

  return {
    currentSec,
    projectedSec,
    gainSec: Math.max(0, currentSec - projectedSec),
    weeksToRace,
    gainFrac,
  };
}
