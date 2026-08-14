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
import { recordDecision } from "./decisions";
import * as W from "./workouts";
import type { BuildCtx } from "./workouts";
import { customSlotFor, parseCustomSplit } from "./workouts";
import { slotLabel, slotOf } from "./routines";
import { dayIndexOf } from "./dates";
import { ZONES } from "./zones";
import type { Adjustment } from "./prescribe";
import { ATHLETE_MAX_STRETCH, adjustChoices, adjustSession, scaleWorkout } from "./prescribe";
import type { PaceModel, Plan, Profile, Segment, StrengthSlot, Workout, Zone } from "./types";

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
  // Ledgered like every other athlete choice — the intensity you set for a session
  // is not the engine's to reconsider on the next rebuild.
  const withLedger = recordDecision(plan, w, { kind: "repace", pacedAt: { kind, value, zone } });
  const nextPlan: Plan = { ...withLedger, workouts: { ...plan.workouts, [workoutId]: next } };
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
 *  ten k in", not "I want 115% of prescribed".
 *
 *  This is the LADDER, not the menu — it says nothing about whether the engine
 *  would accept each rung. Use `distanceOptions` to render a row. */
export function distanceChoices(w: Workout): number[] {
  const base = w.prescribed?.estDistanceM ?? w.estDistanceM ?? 0;
  if (base <= 0) return [];
  const round = (m: number) => Math.max(distanceStep(w), Math.round(m / distanceStep(w)) * distanceStep(w));
  // Reaches 2×, matching `adjustChoices`. At 1.25 the top rung of a 4 km run was
  // 5 km, so "make this my long run" was not expressible in the row at all — the
  // ladder was a wall even when the underlying scale allowed more.
  const out = [0.5, 0.7, 0.85, 1, 1.5, 2].map((f) => round(base * f));
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Rounding granularity of the distance ladder — also the tolerance for "you are
 *  already at this one", which has to be HALF a rung or the rung you're standing on
 *  looks unselected. */
/**
 * How far from a rung still counts as standing on it.
 *
 * ONE constant, used by the row that decides which chip is CURRENT and by the guard
 * that decides whether tapping it is a no-op. It was written in two places and they
 * disagreed at exactly the boundary: `options()` treats a rung as current when the gap
 * is `<= tolerance`, while the guard tested `<`, so a session 150s from its rung
 * rendered the chip as selected AND let the tap through to be refused. Nine sessions
 * across the profile matrix — every one an elite `Aerobic Endurance Swim` sitting
 * exactly 2:30 off its rung.
 *
 * A boundary encoded twice is a boundary that will be wrong somewhere; this is the
 * second bug in this file from that same shape.
 */
export const LENGTH_TOLERANCE_SEC = 150;

function distanceStep(w: Workout): number {
  const base = w.prescribed?.estDistanceM ?? w.estDistanceM ?? 0;
  return base >= 10000 ? 1000 : base >= 3000 ? 500 : 100;
}

/**
 * Is this session already at that value?
 *
 * The Modify rows always render a chip for where the session currently stands — that
 * is what makes the row able to show your position and offer a way back to it. But
 * the chip was a live button, so TAPPING THE ONE YOU ARE ALREADY ON called the action,
 * the action correctly reported that nothing would change, and the UI turned that into
 * "That session can't be resized to that distance." Reported by Ryan against 1.0.61,
 * and the sentence is both false and alarming: the session absolutely can be resized,
 * he had simply asked for the length it already was.
 *
 * Measured across the profile matrix: 0 failures on chips offered as selectable, and
 * 4,842 on the current one. So it fired on essentially every session, for anyone who
 * tapped the highlighted chip — which is the natural thing to do when you are checking
 * what a control does.
 *
 * The tolerance matches the one `options()` uses to decide which chip IS current, so
 * the two can never disagree about it. A rung NEAR the current value (8.8 km showing
 * 9 km as current) is a real change and still goes through.
 */
export function isAtDistance(w: Workout, metres: number): boolean {
  return Math.abs((w.estDistanceM ?? 0) - metres) <= distanceStep(w) / 2;
}

/** The length-side twin of `isAtDistance`, sharing `LENGTH_TOLERANCE_SEC` with the
 *  row that decides which chip is current. */
export function isAtLength(w: Workout, sec: number): boolean {
  return Math.abs(w.estDurationSec - sec) <= LENGTH_TOLERANCE_SEC;
}

// ---------------------------------------------------------------------------
// What the Modify row may actually OFFER
//
// `adjustSession` has promised since #108 that it "returns null when nothing would
// change, so the UI never offers a button that does nothing" — but nothing ever
// asked it. The ladders above are built from arithmetic on the prescribed value and
// handed straight to the screen, so a rung the engine will refuse (no honest change
// at that ratio, or the rails won't have it) renders as an ordinary chip that does
// NOTHING when tapped. Measured across real plans: 15–21% of distance chips and
// 20–27% of length chips were dead, and on a 6-a-week Olympic plan 63 of 64
// sessions showed at least one. Ryan: "it's not letting me set to distances in my…
// to modify workout."
//
// So the menu is the ladder filtered through the engine that has to honour it. Two
// rules beyond that:
//   - the rung you are standing on is always kept, and marked, even though resizing
//     to it would be a no-op — that is the "you are here", not a dead button;
//   - if no rung is within half a step of where you are, your actual value becomes
//     its own rung, so the row can always show where you are and always offer a way
//     back to it.
// ---------------------------------------------------------------------------

/** One chip in a Modify row. */
export interface ModifyChoice {
  /** seconds for a length, metres for a distance */
  value: number;
  /** this is what the session is right now — render it selected, not tappable-dead */
  current: boolean;
}

function options(
  raw: number[],
  now: number,
  tolerance: number,
  accepts: (value: number) => boolean,
): ModifyChoice[] {
  // The nearest rung to where we are, if we're standing close enough to call it ours.
  let currentValue: number | null = null;
  let best = Infinity;
  for (const v of raw) {
    const d = Math.abs(v - now);
    if (d < best) { best = d; currentValue = v; }
  }
  if (currentValue === null || best > tolerance) currentValue = now > 0 ? now : null;

  const kept = raw.filter((v) => v === currentValue || accepts(v));
  if (currentValue !== null && !kept.includes(currentValue)) kept.push(currentValue);
  return kept
    .sort((a, b) => a - b)
    .map((value) => ({ value, current: value === currentValue }));
}

/** The length chips this session may actually be given, newest engine rules applied. */
export function lengthOptions(plan: Plan, workoutId: string): ModifyChoice[] {
  const w = plan.workouts[workoutId];
  if (!w) return [];
  return options(
    adjustChoices(w),
    w.estDurationSec,
    LENGTH_TOLERANCE_SEC, // half of the ladder's 5-minute rounding
    (sec) => !!adjustSession(plan, workoutId, sec),
  );
}

/** The distance chips this session may actually be given.
 *
 *  `label` collapses rungs that would READ the same. `fmtDistance` prints whole
 *  kilometres on purpose (#187, "why 5.7"), while the ladder steps in 500s, so a
 *  short session offered "3 km · 4 km · 4 km · 5 km" — two identical-looking buttons
 *  that did different things. Pass the same formatter the row renders with and the
 *  duplicate goes, the athlete's current value winning the tie. */
export function distanceOptions(
  plan: Plan,
  workoutId: string,
  label?: (m: number) => string,
): ModifyChoice[] {
  const w = plan.workouts[workoutId];
  if (!w || !canSetDistance(w)) return [];
  const all = options(
    distanceChoices(w),
    w.estDistanceM ?? 0,
    distanceStep(w) / 2,
    (m) => !!resizeByDistance(plan, workoutId, m),
  );
  if (!label) return all;
  const byLabel = new Map<string, ModifyChoice>();
  for (const c of all) {
    const key = label(c.value);
    const held = byLabel.get(key);
    if (!held || (c.current && !held.current)) byLabel.set(key, c);
  }
  return [...byLabel.values()].sort((a, b) => a.value - b.value);
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
  const fmt = (m: number) => (m / 1000 >= 10 ? (m / 1000).toFixed(0) : (m / 1000).toFixed(1));
  // Same rule as `adjustSession`, and detected the same way: on the requested factor,
  // because scaffolding that does not scale means the result rarely equals the ask.
  const shortOfAsk = targetM / base > ATHLETE_MAX_STRETCH;
  const summary = shortOfAsk
    ? `${scaled.title} is now ${fmt(scaled.estDistanceM ?? 0)} km — that's as far as one session can stretch in a single step. Ask again from here to go further.`
    : `${scaled.title} is now ${km >= 10 ? km.toFixed(0) : km.toFixed(1)} km — ${Math.round(
        scaled.estDurationSec / 60,
      )} min at the same effort.`;
  return { plan: nextPlan, workout: scaled, summary };
}

// ---------------------------------------------------------------------------
// Changing which day of the split a gym session is
// ---------------------------------------------------------------------------

/** The splits an athlete can move a gym session to, plus their own named days.
 *
 *  `home` is deliberately included: "I'm not getting to the gym today" is the most
 *  common reason to change a strength day, and it is the one option the engine can
 *  already build without equipment. */
export function slotChoices(profile: Profile | null | undefined): StrengthSlot[] {
  const base: StrengthSlot[] = ["push", "pull", "legs", "upper", "lower", "full", "home"];
  const own = parseCustomSplit(profile?.strength?.customSplit).map(customSlotFor);
  // The athlete's own names go FIRST — if they've told us their week is "Chest /
  // Back / Legs", those are the words they think in, and push/pull/legs is our
  // vocabulary rather than theirs.
  return [...own, ...base.filter((s) => !own.includes(s))];
}

/**
 * Move a gym session to a different day of the split (#, Ryan 2026-08-12: "allow me to
 * modify the day or my split for the workout so I can change it from push to pull").
 *
 * Rebuilds the session from the chosen slot's own builder rather than relabelling it: a
 * Pull day is a different set of exercises from a Push day, and swapping only the title
 * would leave an athlete doing bench press under a heading that says rows. The DURATION
 * carries across, because that is the athlete's constraint, not the split's.
 *
 * Deliberately NOT rails-gated. Strength carries no impact load in `mechanical.ts` and no
 * zone above 2, so push→pull cannot breach a ramp or an intensity band — there is nothing
 * for the rails to have an opinion about. It also does not go through `respond`: changing
 * which muscles you train today is not a change in load, and announcing a week-wide
 * adjustment for it would be noise.
 *
 * Returns null when the slot is already the one it is, so the chip can't be a dead button.
 */
export function reslotStrength(
  plan: Plan,
  workoutId: string,
  slot: StrengthSlot,
): Adjustment | null {
  const w = plan.workouts[workoutId];
  if (!w || w.discipline !== "strength" || w.status !== "planned") return null;
  if (slotOf(w) === slot) return null;

  const ctx: BuildCtx = { paces: plan.paces, level: plan.profile.level };
  const min = Math.max(15, Math.round((w.estDurationSec || 35 * 60) / 60));
  const custom = slot.startsWith("custom:");
  const draft = custom
    ? W.strengthCustom(ctx, min, plan.profile.strength?.customSplit, slotLabel(slot))
    : slot === "push" ? W.strengthPush(ctx, min)
    : slot === "pull" ? W.strengthPull(ctx, min)
    : slot === "legs" ? W.strengthLegs(ctx, min)
    : slot === "upper" ? W.strengthUpper(ctx, min)
    : slot === "lower" ? W.strengthLower(ctx, min)
    : slot === "home" ? W.strengthHome(ctx, min)
    : W.strength(ctx, min);

  const next: Workout = {
    ...w,
    title: draft.title,
    purpose: draft.purpose,
    segments: draft.segments,
    estDurationSec: draft.estDurationSec,
    primaryZone: draft.primaryZone,
    // The slot is what `slotOf` reads, and what a saved routine is keyed on — so setting
    // it is also what makes the athlete's own Pull routine show up on this session.
    strengthSlot: slot,
    // A resize baseline captured for the OLD split describes exercises that are no longer
    // here; keeping it would have the next ease scale this session from a stranger.
    prescribed: undefined,
    strengthLog: undefined,
  };

  return {
    plan: { ...plan, workouts: { ...plan.workouts, [workoutId]: next } },
    workout: next,
    summary: `${fmtDayName(w.date)} is a ${slotLabel(slot)} day now — ${Math.round(next.estDurationSec / 60)} min.`,
  };
}

/** "Thursday" from an ISO date, for a one-line confirmation. */
function fmtDayName(iso: string): string {
  const DOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  return DOW[dayIndexOf(iso)] ?? "That session";
}
