import { Discipline, PaceModel, Segment, Workout, Zone } from "./types";

// ---------------------------------------------------------------------------
// Flatten a workout's (possibly nested / repeated) segments into a linear list
// of timed steps — the shared basis for the in-app audio player and the .FIT
// export. Repeats are expanded; every step gets a best-effort duration so a
// live timer can drive it. Pure.
// ---------------------------------------------------------------------------

export interface FlatStep {
  discipline: Discipline;
  zone?: Zone;
  kind: Segment["kind"];
  description: string;
  cue?: string;
  durationSec: number; // best-effort; floored so the timer always advances
  distanceM?: number;
  isRest: boolean;
  rep?: { index: number; total: number }; // "rep 2 of 6", when inside a repeat
}

const midRun = (p: PaceModel, z: Zone) => (p.run.zones[z].loSecPerKm + p.run.zones[z].hiSecPerKm) / 2;
const midSwim = (p: PaceModel, z: Zone) => (p.swim.zones[z].loSecPer100 + p.swim.zones[z].hiSecPer100) / 2;

/** Best-effort seconds for a step: explicit duration, else estimated from its
 *  distance and zone pace, else 0 (the player floors this). */
function estDuration(seg: Segment, disc: Discipline, paces: PaceModel): number {
  if (seg.durationSec) return seg.durationSec;
  const z = (seg.zone ?? 2) as Zone;
  if (seg.distanceM) {
    if (disc === "run") return Math.round((seg.distanceM / 1000) * midRun(paces, z));
    if (disc === "swim") return Math.round((seg.distanceM / 100) * midSwim(paces, z));
    if (disc === "bike") return Math.round((seg.distanceM / 1000 / (24 + z * 4)) * 3600); // ~zone kmh
  }
  return 0;
}

export function flattenWorkout(w: Workout, paces: PaceModel): FlatStep[] {
  const out: FlatStep[] = [];
  const walk = (segs: Segment[], rep?: { index: number; total: number }) => {
    for (const s of segs) {
      const reps = s.repeat ?? 1;
      if (s.children && s.children.length) {
        for (let r = 0; r < reps; r++) walk(s.children, reps > 1 ? { index: r + 1, total: reps } : rep);
      } else {
        const disc = (s.discipline ?? w.discipline) as Discipline;
        out.push({
          discipline: disc,
          zone: s.zone,
          kind: s.kind,
          description: s.description,
          cue: s.cue,
          durationSec: estDuration(s, disc, paces),
          distanceM: s.distanceM,
          isRest: s.kind === "rest",
          rep,
        });
      }
    }
  };
  walk(w.segments);
  return out;
}
