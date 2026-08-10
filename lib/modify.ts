// ---------------------------------------------------------------------------
// Modify a session — by distance, and by pace.
//
// Ticket #185. "Adjust length" already existed; this adds the other two things
// an athlete actually wants to change about a session, and makes one of them
// mean something.
//
// THE DECISION THAT SHAPES THIS FILE (Ryan, 2026-08-09)
//
// Editing pace could have been cosmetic — record the number, leave the session
// alone. It isn't. If today's ride is prescribed as Zone 2 endurance and you say
// you're going to ride it at threshold, then the session you are about to do IS
// a threshold session, and the plan should treat it as one: the zone moves, the
// load moves with it, and the rest of the week absorbs it through exactly the
// same machinery that responds when you overshoot a session (#184).
//
// That is the accurate reading, and it is also the dangerous one, which is why
// everything here is rails-gated. Turning three easy weeks into three threshold
// weeks with six taps is precisely the failure mode `railsRegressed` exists to
// stop, and a pace edit gets no more privilege than any other path.
//
// WHY THE BIKE IS DIFFERENT
//
// Run and swim have real pace models (threshold pace, CSS), so a pace maps to a
// zone directly. The bike's zones are %FTP — and `derivePaces` leaves `ftp` null
// for anyone who never entered one, which is most people. There is no bike SPEED
// model anywhere in the codebase, and inventing one to accept a km/h target would
// be fabricating a prescription. So the bike offers a POWER target when FTP is
// known and offers nothing when it isn't, rather than pretending.
//
// Pure — no clock, no I/O.
// ---------------------------------------------------------------------------

import { railsRegressed } from "./rails";
import { ZONES } from "./zones";
import type { Adjustment } from "./prescribe";
import { scaleWorkout } from "./prescribe";
import type { PaceModel, Plan, Segment, Workout, Zone } from "./types";

/** What kind of intensity target this session can be given. */
export type TargetKind = "run-pace" | "swim-pace" | "bike-power";

/** Sessions whose intensity is meaningful to override. Rest has none; strength
 *  isn't zoned; race day has no structure to rewrite (see scaleWorkout). */
export function targetKindFor(w: Workout, paces: PaceModel): TargetKind | null {
  if (w.status !== "planned" || !w.segments?.length) return null;
  if (w.discipline === "run") return "run-pace";
  if (w.discipline === "swim") return "swim-pace";
  // A brick is ridden and run; its primary zone is the bike's, so treat it as one.
  if (w.discipline === "bike" || w.discipline === "brick") {
    return paces.bike.ftp && paces.bike.ftp > 0 ? "bike-power" : null;
  }
  return null;
}

/** Why the pace row is missing, when it is — so the UI can say something useful
 *  instead of silently omitting a control (the #130 lesson: a promise that leads
 *  to a sheet with no such field). */
export function targetUnavailableReason(w: Workout, paces: PaceModel): string | null {
  if (targetKindFor(w, paces)) return null;
  if (w.discipline === "bike" || w.discipline === "brick") {
    return "Add your FTP in Profile to set a power target for rides.";
  }
  return null;
}

/** The middle of a zone's band, in the units of `kind`. This is the value the
 *  plan is effectively asking for at that zone. */
export function targetForZone(paces: PaceModel, kind: TargetKind, z: Zone): number {
  if (kind === "run-pace") {
    const b = paces.run.zones[z];
    return Math.round((b.loSecPerKm + b.hiSecPerKm) / 2);
  }
  if (kind === "swim-pace") {
    const b = paces.swim.zones[z];
    return Math.round((b.loSecPer100 + b.hiSecPer100) / 2);
  }
  const ftp = paces.bike.ftp ?? 0;
  const b = paces.bike.zones[z];
  return Math.round((ftp * (b.loPct + b.hiPct)) / 200);
}

const ZONE_LIST: Zone[] = [1, 2, 3, 4, 5];

/**
 * Which zone a chosen target actually falls in.
 *
 * The zone bands have GAPS — run Z2 ends at 5:53/km and Z3 starts at 5:47/km —
 * so a pace can legitimately sit between two of them. Rather than reject those
 * (the athlete typed a real number; refusing it is a worse answer than rounding
 * it), the nearest band wins. Ties go to the EASIER zone: when a pace sits
 * exactly between two, calling it the harder one would silently add load.
 */
export function zoneForTarget(paces: PaceModel, kind: TargetKind, value: number): Zone {
  let best: Zone = 1;
  let bestDist = Infinity;
  // Walk easiest → hardest and require a STRICT improvement by more than TIE_EPS
  // to move up, so a target sitting midway between two bands keeps the easier one.
  //
  // The tolerance is not decoration. The zone bands are derived by multiplying a
  // threshold pace by fractions, so the two gap edges land on values whose
  // midpoint is equidistant in exact arithmetic and differs by ~1e-13 in floating
  // point. Without it, a pace precisely between Z2 and Z3 resolved to Z3 — the app
  // silently upgrading the athlete's session to a harder one on a rounding error.
  const TIE_EPS = 1e-6;
  for (const z of ZONE_LIST) {
    const lo = bandLo(paces, kind, z);
    const hi = bandHi(paces, kind, z);
    const dist = value < lo ? lo - value : value > hi ? value - hi : 0;
    if (dist < bestDist - TIE_EPS) {
      bestDist = dist;
      best = z;
    }
    if (dist === 0) break;
  }
  return best;
}

function bandLo(paces: PaceModel, kind: TargetKind, z: Zone): number {
  if (kind === "run-pace") return paces.run.zones[z].loSecPerKm;
  if (kind === "swim-pace") return paces.swim.zones[z].loSecPer100;
  const ftp = paces.bike.ftp ?? 0;
  return (ftp * paces.bike.zones[z].loPct) / 100;
}
function bandHi(paces: PaceModel, kind: TargetKind, z: Zone): number {
  if (kind === "run-pace") return paces.run.zones[z].hiSecPerKm;
  if (kind === "swim-pace") return paces.swim.zones[z].hiSecPer100;
  const ftp = paces.bike.ftp ?? 0;
  return (ftp * paces.bike.zones[z].hiPct) / 100;
}

/** A ladder of targets to offer, one per zone, so the control is a choice
 *  between real prescriptions rather than a free-text box that can be typed
 *  into nonsense. Ordered easiest → hardest in each unit's natural direction. */
export function targetChoices(paces: PaceModel, kind: TargetKind): Array<{ zone: Zone; value: number }> {
  const out = ZONE_LIST.map((z) => ({ zone: z, value: targetForZone(paces, kind, z) }));
  // pace: bigger number = easier; power: bigger number = harder
  return kind === "bike-power" ? out : out;
}

// ---------------------------------------------------------------------------
// Rewriting the session
// ---------------------------------------------------------------------------

/**
 * Move the WORKING segments from one zone to another, leaving the scaffolding.
 *
 * Segments matching the old primary zone are the work; warm-ups, cool-downs and
 * the easy halves of intervals sit at other zones and must not move, or a
 * "harder threshold session" would also turn its recoveries into threshold and
 * stop being an interval session at all.
 *
 * Descriptions are REGENERATED rather than string-patched. The existing text
 * embeds the old prescription ("92 min @ Endurance (Z2) steady", "10 min @
 * threshold"), and leaving it beside a changed zone reproduces exactly the bug
 * the codebase has been bitten by twice: a header that contradicts the steps
 * under it. Regeneration can't drift.
 */
function reZone(segments: Segment[], from: Zone, to: Zone, label: string): Segment[] {
  return segments.map((s) => {
    const next: Segment = { ...s };
    if (next.children) next.children = reZone(next.children, from, to, label);
    if (s.zone !== from) return next;
    next.zone = to;
    // An explicit %FTP band belongs to the OLD zone and would now contradict the
    // new one, so it goes; the zone alone carries the prescription from here.
    delete next.ftpPct;
    const sec = s.durationSec;
    next.description = sec
      ? `${Math.round(sec / 60) >= 1 ? `${Math.round(sec / 60)} min` : `${sec}s`} @ ${label}`
      : `${s.description.split(" @ ")[0]} @ ${label}`;
    return next;
  });
}

/** How a chosen target reads to a human. */
export function targetLabel(kind: TargetKind, value: number): string {
  if (kind === "bike-power") return `${Math.round(value)} W`;
  const m = Math.floor(value / 60);
  const s = Math.round(value % 60);
  return kind === "swim-pace"
    ? `${m}:${String(s).padStart(2, "0")}/100m`
    : `${m}:${String(s).padStart(2, "0")}/km`;
}

/**
 * Set the intensity this session will actually be done at.
 *
 * Returns null when nothing would change — a target inside the band the session
 * is already prescribed at is not an edit, and offering a button that does
 * nothing is the #108 bug. Returns null when the rails refuse, so the
 * conversational and tap paths get the same answer as every other adaptation.
 */
export function repaceSession(
  plan: Plan,
  workoutId: string,
  value: number,
): Adjustment | null {
  const w = plan.workouts[workoutId];
  if (!w) return null;
  const kind = targetKindFor(w, plan.paces);
  if (!kind) return null;

  const zone = zoneForTarget(plan.paces, kind, value);
  if (zone === w.primaryZone) return null;

  const label = targetLabel(kind, value);
  const segments = reZone(w.segments, w.primaryZone, zone, label);
  if (JSON.stringify(segments) === JSON.stringify(w.segments)) return null;

  // Preserve the original prescription the first time it is overwritten, exactly
  // as scaleWorkout does, so "put it back" stays reachable and later edits are
  // computed from the design rather than from the last edit.
  const prescribed = w.prescribed ?? {
    estDurationSec: w.estDurationSec,
    estDistanceM: w.estDistanceM,
    segments: w.segments,
    // the zone MUST travel with the baseline: this is the one edit that changes
    // intensity, so without it the plan cannot tell that quality was lost
    primaryZone: w.primaryZone,
  };
  const next: Workout = {
    ...w,
    segments,
    primaryZone: zone,
    prescribed,
    pacedAt: { kind, value, zone },
  };
  const nextPlan: Plan = { ...plan, workouts: { ...plan.workouts, [workoutId]: next } };
  if (railsRegressed(plan, nextPlan).length) return null;

  const harder = zone > w.primaryZone;
  const summary = harder
    ? `At ${label} this is a ${ZONES[zone].name.toLowerCase()} session, not ${ZONES[w.primaryZone].name.toLowerCase()} — the rest of the week will take that into account.`
    : `At ${label} this becomes a ${ZONES[zone].name.toLowerCase()} session. Easier than prescribed, and the plan knows.`;
  return { plan: nextPlan, workout: next, summary };
}

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

/** Sessions whose distance is a meaningful thing to set. A session with no
 *  distance estimate has nothing to scale from. */
export function canSetDistance(w: Workout): boolean {
  const base = w.prescribed?.estDistanceM ?? w.estDistanceM ?? 0;
  return w.status === "planned" && base > 0 && !!w.segments?.length;
}

/** The distances offered, derived from what the plan asked for. Same shape as
 *  `adjustChoices` and for the same reason: real athletes think "I want to get
 *  ten k in", not "I want 115% of prescribed". */
export function distanceChoices(w: Workout): number[] {
  const base = w.prescribed?.estDistanceM ?? w.estDistanceM ?? 0;
  if (base <= 0) return [];
  const step = base >= 10000 ? 1000 : base >= 3000 ? 500 : 100;
  const round = (m: number) => Math.max(step, Math.round(m / step) * step);
  const out = [0.5, 0.7, 0.85, 1, 1.25].map((f) => round(base * f));
  return [...new Set(out)].sort((a, b) => a - b);
}

/**
 * Resize a session by DISTANCE rather than time.
 *
 * Deliberately routed through `scaleWorkout` rather than editing the distance
 * directly: distance and duration have to move together or the session's header
 * and its structure disagree — 10 km sitting above forty minutes of intervals
 * that add up to 8 km. The factor is computed from distance and everything else
 * follows from the one primitive that already knows how to rescale honestly.
 */
export function resizeByDistance(plan: Plan, workoutId: string, targetM: number): Adjustment | null {
  const w = plan.workouts[workoutId];
  if (!w || targetM <= 0) return null;
  const base = w.prescribed?.estDistanceM ?? w.estDistanceM ?? 0;
  if (base <= 0) return null;

  const scaled = scaleWorkout(w, targetM / base, { allowLonger: true });
  if (!scaled) return null;

  const nextPlan: Plan = { ...plan, workouts: { ...plan.workouts, [workoutId]: scaled } };
  if (railsRegressed(plan, nextPlan).length) return null;

  const km = (scaled.estDistanceM ?? 0) / 1000;
  const summary = `${scaled.title} is now ${km >= 10 ? km.toFixed(0) : km.toFixed(1)} km — ${Math.round(
    scaled.estDurationSec / 60,
  )} min at the same effort.`;
  return { plan: nextPlan, workout: scaled, summary };
}
