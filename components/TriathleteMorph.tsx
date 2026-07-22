"use client";

/* =============================================================================
 * TriathleteMorph — the plan-generation loading centrepiece (v2)
 * =============================================================================
 *
 * ONE solid-ink athlete that transforms through the three legs of a triathlon
 * as `progress` (0–100) climbs:
 *
 *      swimmer  ──▶  cyclist  ──▶  runner  ──▶  finish tape
 *
 * This is deliberately NOT a stick figure. The athlete is rendered as a filled
 * silhouette in the spirit of an Olympic pictogram — tapered limbs with volume,
 * a real torso mass, a head — so there are no bare "joints" on show. Motion is
 * driven by a small skeletal rig whose pose comes from hand-authored KEYFRAME
 * TRACKS (contact / down / passing / flight for the run; a full pedal stroke for
 * the bike; catch–pull–recovery for the swim) sampled with a periodic
 * Catmull-Rom spline, the way an animator keys a cycle rather than a naive sine.
 *
 * Pipeline every frame:
 *   1. for each active discipline, sample its tracks at its own cadence,
 *      run forward kinematics → a full set of joint POINTS (a "Skeleton").
 *   2. blend the three skeletons by discipline weight (point-space blend, so
 *      angle wrap-around is never an issue) → the morph.
 *   3. render the blended skeleton as a filled silhouette + the per-leg scene
 *      (water, bike, road, finish) cross-faded on the same weights.
 *
 * Paper aesthetic: ink on white. The single fill colour cross-fades
 * swim-blue → bike-ochre → run-brick, read live from the --swim/--bike/--run
 * design tokens. Far-side limbs are drawn a touch lighter for depth. Honours
 * prefers-reduced-motion (limbs hold, progress still advances).
 * ============================================================================= */

import { useEffect, useMemo, useRef, useState } from "react";

/* =============================================================================
 * TUNING NOTES (read this before changing the motion)
 * =============================================================================
 *
 * COORDINATES. Everything is authored in an SVG viewBox of 0 0 300 200, y-down.
 * The athlete faces +x (moves left → right). Angles are ABSOLUTE screen degrees:
 *   0   = pointing right (+x)
 *   90  = pointing down  (+y)
 *   -90 = pointing up
 * `polar(origin, deg, len)` walks `len` from `origin` along `deg`.
 *
 * RIG SPACE vs WORLD SPACE. Each `build<Discipline>(c)` assembles the figure in
 * RIG space with the pelvis at (0,0). `place()` then scales, (optionally) leans
 * and translates the whole rig to the discipline's world anchor in PLACEMENT.
 * Keeping authoring pelvis-relative is what lets the three poses blend cleanly.
 *
 * WHY POINT-SPACE BLENDING. The morph averages joint POSITIONS, never angles —
 * averaging angles wraps badly (350° and 10° average to 180°, not 0°). Build
 * each active discipline's skeleton, then `blendSkeletons` takes the weighted
 * mean of every joint. Result: limbs glide from stroke → pedal → stride.
 *
 * KEYFRAME TRACKS. A `Track` is [phase, value] pairs, phase in [0,1), first key
 * at 0. `sampleTrack` wraps around the loop with a Catmull-Rom spline so a cycle
 * eases naturally through every key (this is the difference between "keyframed"
 * and "a sine wave"). To make a motion snappier add keys; to calm it, remove
 * them or reduce the value spread.
 *
 * FK vs IK. Arms and the swim/flutter legs are forward-kinematic (author the
 * joint angles directly). The bike legs and the run legs are inverse-kinematic:
 * we author the ANKLE target (crank circle / gait trajectory) and solve the
 * knee. IK is what keeps the cyclist's feet on the pedals and the runner's feet
 * on the ground — the single biggest driver of "this looks real".
 *
 * TO RETUNE THE RUN quickly: RUN.strideX (reach), RUN.lift (swing height),
 * RUN.groundRel + PLACEMENT.run.at.y (hip height / how bent the stance leg is),
 * RUN.spine/neck/head (torso lean). Keep pelvis.y + groundRel = 150 (the ground).
 * ============================================================================= */

/* -----------------------------------------------------------------------------
 * 1. Vector + scalar math
 * -------------------------------------------------------------------------- */

type Vec = { x: number; y: number };

const V = (x: number, y: number): Vec => ({ x, y });
const vadd = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const vsub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const vscale = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
const vlen = (a: Vec): number => Math.hypot(a.x, a.y);
const vlerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const vperp = (a: Vec): Vec => ({ x: -a.y, y: a.x });
const vunit = (a: Vec): Vec => {
  const l = vlen(a) || 1;
  return { x: a.x / l, y: a.y / l };
};

const DEG = Math.PI / 180;
/** Point at `len` from `origin` along screen angle `deg` (0 = +x / right, 90 = down). */
const polar = (origin: Vec, deg: number, len: number): Vec => ({
  x: origin.x + Math.cos(deg * DEG) * len,
  y: origin.y + Math.sin(deg * DEG) * len,
});

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smoothstep = (t: number) => {
  const k = clamp(t, 0, 1);
  return k * k * (3 - 2 * k);
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/* -----------------------------------------------------------------------------
 * 2. Easing library (used for scene fades + a little organic timing warp)
 * -------------------------------------------------------------------------- */

const ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

/* -----------------------------------------------------------------------------
 * 3. Periodic Catmull-Rom keyframe sampler
 *
 * A "track" is a list of [phase, value] keys with phase in [0,1) (must start at
 * 0). Sampling wraps around the loop and uses a Catmull-Rom spline through the
 * neighbouring four keys, so a hand-keyed cycle reads smoothly with natural
 * ease in/out at every key — this is what makes the joints look considered
 * rather than mechanically sinusoidal.
 * -------------------------------------------------------------------------- */

type Key = readonly [number, number];
type Track = readonly Key[];

function catmull(v0: number, v1: number, v2: number, v3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * v1 +
      (-v0 + v2) * t +
      (2 * v0 - 5 * v1 + 4 * v2 - v3) * t2 +
      (-v0 + 3 * v1 - 3 * v2 + v3) * t3)
  );
}

function sampleTrack(track: Track, phase: number): number {
  const n = track.length;
  if (n === 0) return 0;
  if (n === 1) return track[0][1];
  const c = ((phase % 1) + 1) % 1;

  // find segment i such that track[i].phase <= c < track[i+1].phase (with wrap)
  let i = n - 1;
  for (let k = 0; k < n; k++) {
    const cur = track[k][0];
    const nxtRaw = k + 1 < n ? track[k + 1][0] : track[0][0] + 1;
    if (c >= cur && c < nxtRaw) {
      i = k;
      break;
    }
  }

  const p1 = track[i];
  const p2 = track[(i + 1) % n];
  const p0 = track[(i - 1 + n) % n];
  const p3 = track[(i + 2) % n];

  let t0 = p1[0];
  let t1 = p2[0];
  if (t1 <= t0) t1 += 1;
  let cc = c;
  if (cc < t0) cc += 1;
  const t = clamp((cc - t0) / (t1 - t0 || 1), 0, 1);

  return catmull(p0[1], p1[1], p2[1], p3[1], t);
}

/* -----------------------------------------------------------------------------
 * 4. Skeleton — the set of joint POINTS the renderer draws from
 * -------------------------------------------------------------------------- */

type Skeleton = {
  pelvis: Vec;
  chest: Vec;
  neck: Vec;
  head: Vec; // head CENTRE
  headTilt: number; // degrees, for the head ellipse orientation
  // near side (facing the viewer — drawn solid)
  shoulderN: Vec;
  elbowN: Vec;
  wristN: Vec;
  handN: Vec;
  hipN: Vec;
  kneeN: Vec;
  ankleN: Vec;
  toeN: Vec;
  heelN: Vec;
  // far side (drawn lighter, behind)
  shoulderF: Vec;
  elbowF: Vec;
  wristF: Vec;
  handF: Vec;
  hipF: Vec;
  kneeF: Vec;
  ankleF: Vec;
  toeF: Vec;
  heelF: Vec;
};

// bone lengths (rig units — the whole rig is scaled into the scene once)
const L = {
  spine: 32, // pelvis → chest
  neck: 9, // chest → neck base
  headGap: 12, // neck → head centre
  upperArm: 20,
  foreArm: 18,
  hand: 6,
  thigh: 27,
  shank: 25,
  foot: 13,
  heel: 6,
};

// (silhouette half-widths live in RAD, next to the renderer that consumes them)

/* -----------------------------------------------------------------------------
 * 5. Forward kinematics — build a limb chain from absolute angles
 * -------------------------------------------------------------------------- */

/** Solve the middle joint of a 2-bone chain by inverse kinematics (used to lock
 *  the cyclist's feet to the pedal crank). `bend` picks the knee/elbow side. */
function ik(root: Vec, target: Vec, l1: number, l2: number, bend: number): Vec {
  const to = vsub(target, root);
  const dist = clamp(vlen(to), Math.abs(l1 - l2) + 0.001, l1 + l2 - 0.001);
  const base = Math.atan2(to.y, to.x);
  const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const a = base + bend * Math.acos(cosA);
  return { x: root.x + Math.cos(a) * l1, y: root.y + Math.sin(a) * l1 };
}

/* -----------------------------------------------------------------------------
 * 6. Discipline pose definitions
 *
 * Each discipline exposes a `build(c)` that returns a fully-resolved Skeleton in
 * rig space (pelvis-relative), where `c` is the discipline's own cycle phase in
 * [0,1). World placement + morph blending happen afterwards.
 *
 * Angle convention: absolute screen degrees (0 = +x/right, 90 = down), athlete
 * faces +x (moves left → right across the loader). Near-leg tracks are sampled
 * at `c`; the far leg re-samples at `c + 0.5` for the natural contralateral
 * gait. Arms swing opposite the same-side leg.
 * -------------------------------------------------------------------------- */

// ---- RUN -------------------------------------------------------------------
// A real run cycle keyed at contact(0) → mid-stance(.17) → toe-off(.33) →
// early-swing(.5) → mid-swing(.66) → late-swing/reach(.83). Knee flexes only
// posteriorly (heel toward glute) so it never looks broken.

// The run is authored as an FK cycle (real key poses) and then auto-grounded:
// after posing both legs, the whole figure is dropped so the lowest foot rests
// on the ground. That gives true running shapes — high knee drive, a reaching
// front leg, an extended toe-off — while the support foot stays planted and the
// vertical bob falls out for free. cc=0 is foot contact.
const RUN = {
  spine: -83, // slight athletic forward lean
  neck: -85,
  head: -87,
  footFlex: -72, // toe direction relative to the shin
  // thigh: absolute angle (90 = straight down, <90 forward, >90 back)
  thigh: [
    [0.0, 60], // contact — thigh forward, foot lands ahead
    [0.15, 84], // recoil — thigh swings under the hip
    [0.3, 103], // mid-stance → drive back
    [0.45, 117], // toe-off — thigh extended behind
    [0.55, 96], // lift off
    [0.72, 66], // knee driving up and forward
    [0.86, 55], // reach — thigh high in front
  ] as Track,
  // knee: posterior flex magnitude (0 = straight); only ever bends one way
  knee: [
    [0.0, 24], // contact — slight bend, shin ~vertical
    [0.15, 46], // recoil — compress to absorb
    [0.3, 34],
    [0.45, 12], // toe-off — extends to push
    [0.55, 104], // heel snaps up toward the glute
    [0.72, 130], // max fold — high, tight knee
    [0.86, 34], // extends to reach for the next contact
  ] as Track,
  // arms — driving opposite the same-side leg. The elbow OPENS when the arm is
  // back (hand drops toward the hip) and CLOSES when it's forward (hand to the
  // chest) — a real running arm carriage, not a stiff constant-angle point.
  shoulder: [
    [0.0, 116], // near arm back at contact (near leg forward)
    [0.25, 102],
    [0.5, 62], // hand drives up in front
    [0.75, 100],
  ] as Track,
  elbow: [
    [0.0, 66], // arm back — open elbow, forearm angles down to the hip
    [0.25, 90],
    [0.5, 106], // arm forward — tight elbow, hand to the chest
    [0.75, 90],
  ] as Track,
};

const RUN_GROUND_RIG = 50; // rig-space ground line (= 150 − PLACEMENT.run.at.y)

// ---- BIKE ------------------------------------------------------------------
// Aero tuck. Feet are locked to the pedal crank (IK); the tracks only carry the
// torso/arm/ankle character. Crank centre + radius live in build().

const BIKE = {
  pelvisBob: [
    [0.0, 0.0],
    [0.5, 1.4],
  ] as Track,
  lean: 0,
  spine: -24, // torso low over the bars
  neck: -26,
  head: -20,
  // arms reach down-forward to the bars (near/far both, tiny bob)
  shoulder: [
    [0.0, 22],
    [0.5, 24],
  ] as Track,
  elbow: [
    [0.0, 20],
    [0.5, 18],
  ] as Track,
  ankleTweak: [
    // extra ankle articulation across the stroke (added to the auto foot angle)
    [0.0, -14], // top of stroke — toe up
    [0.25, 6], // power phase — drive through
    [0.5, 20], // bottom — toe pointed
    [0.75, 2],
  ] as Track,
  crank: 12,
};

// ---- SWIM ------------------------------------------------------------------
// Prone freestyle. Body roughly horizontal (pelvis→chest points forward +x).
// Near arm does a full catch → pull → recovery windmill; legs flutter.

const SWIM = {
  pelvisBob: [
    [0.0, 0.0],
    [0.5, 1.2],
  ] as Track,
  lean: 0,
  spine: -6, // nearly flat, chest a touch high (head out of water on breath)
  neck: -4,
  head: 2,
  // near arm windmill — absolute shoulder angle sweeps a full turn
  shoulder: [
    [0.0, -70], // recovery, arm up & forward
    [0.2, 10], // hand enters ahead
    [0.4, 90], // catch, pressing down
    [0.6, 150], // pull through under body
    [0.8, 210], // exit at hip, begin recovery
  ] as Track,
  elbow: [
    // high-elbow catch then straighten on push
    [0.0, 40],
    [0.2, 20],
    [0.4, 70], // high-elbow catch
    [0.6, 30],
    [0.8, 20],
  ] as Track,
  // flutter kick — small thigh oscillation about horizontal (180° = pointing -x)
  thigh: [
    [0.0, 184],
    [0.5, 176],
  ] as Track,
  knee: [
    [0.0, 10],
    [0.25, 22],
    [0.5, 8],
    [0.75, 20],
  ] as Track,
  ankle: [
    [0.0, 6],
    [0.5, -6],
  ] as Track,
};

/* -- builders ---------------------------------------------------------------- */

/** Common torso/head/arm assembly shared by the disciplines. `armPhaseN` and
 *  `armPhaseF` let each discipline choose the arm cadence relative to the legs. */
function buildTorso(
  pelvis: Vec,
  spineDeg: number,
  neckDeg: number,
  headDeg: number,
  shoulderTrack: Track,
  elbowTrack: Track,
  armPhaseN: number,
  armPhaseF: number,
  bendN: number,
  bendF: number,
): Pick<
  Skeleton,
  | "chest" | "neck" | "head" | "headTilt"
  | "shoulderN" | "elbowN" | "wristN" | "handN"
  | "shoulderF" | "elbowF" | "wristF" | "handF"
> {
  const chest = polar(pelvis, spineDeg, L.spine);
  const neck = polar(chest, neckDeg, L.neck);
  const head = polar(neck, headDeg, L.headGap);

  const shoulder = vlerp(chest, neck, 0.25); // shoulders sit just below the neck

  const arm = (phase: number, bend: number) => {
    const sDeg = sampleTrack(shoulderTrack, phase);
    const eFlex = sampleTrack(elbowTrack, phase);
    const elbow = polar(shoulder, sDeg, L.upperArm);
    const wrist = polar(elbow, sDeg + bend * eFlex, L.foreArm);
    const hand = polar(wrist, sDeg + bend * eFlex, L.hand);
    return { elbow, wrist, hand };
  };

  const aN = arm(armPhaseN, bendN);
  const aF = arm(armPhaseF, bendF);

  return {
    chest,
    neck,
    head,
    headTilt: headDeg + 90,
    shoulderN: shoulder,
    elbowN: aN.elbow,
    wristN: aN.wrist,
    handN: aN.hand,
    shoulderF: shoulder,
    elbowF: aF.elbow,
    wristF: aF.wrist,
    handF: aF.hand,
  };
}

function buildRun(c: number): Skeleton {
  // 1. pose each leg by forward kinematics from the pelvis origin (0,0)
  const legRaw = (phase: number) => {
    const tDeg = sampleTrack(RUN.thigh, phase);
    const kFlex = sampleTrack(RUN.knee, phase);
    const knee = polar(V(0, 0), tDeg, L.thigh);
    const shankDeg = tDeg + kFlex; // knee only flexes posteriorly
    const ankle = polar(knee, shankDeg, L.shank);
    const footDeg = shankDeg + RUN.footFlex; // toe forward of the ankle
    const toe = polar(ankle, footDeg, L.foot);
    const heel = polar(ankle, footDeg + 180, L.heel);
    return { knee, ankle, toe, heel };
  };
  const rawN = legRaw(c);
  const rawF = legRaw(c + 0.5);

  // 2. auto-ground: drop the whole figure so the lowest foot point sits on the
  //    rig ground line. The support foot plants, the airborne foot stays lifted,
  //    and the vertical bob emerges from the changing pose — no IK, no float.
  const lowest = Math.max(rawN.toe.y, rawN.heel.y, rawF.toe.y, rawF.heel.y);
  const dy = RUN_GROUND_RIG - lowest;
  const off = (p: Vec): Vec => ({ x: p.x, y: p.y + dy });
  const pelvis = V(0, dy);

  const torso = buildTorso(pelvis, RUN.spine, RUN.neck, RUN.head, RUN.shoulder, RUN.elbow, c + 0.5, c, -1, -1);
  return {
    pelvis,
    hipN: pelvis,
    hipF: pelvis,
    kneeN: off(rawN.knee), ankleN: off(rawN.ankle), toeN: off(rawN.toe), heelN: off(rawN.heel),
    kneeF: off(rawF.knee), ankleF: off(rawF.ankle), toeF: off(rawF.toe), heelF: off(rawF.heel),
    ...torso,
  };
}

function buildBike(c: number): Skeleton {
  const pelvis = V(0, sampleTrack(BIKE.pelvisBob, c));
  const crankCentre = V(6, 34); // forward + below the saddle
  const R = BIKE.crank;
  const leg = (phase: number, bend: number) => {
    const ang = phase * 360;
    const ankle = vadd(crankCentre, V(Math.cos(ang * DEG) * R, Math.sin(ang * DEG) * R));
    const knee = ik(pelvis, ankle, L.thigh, L.shank, bend);
    // foot roughly horizontal, with per-stroke ankle articulation
    const footDeg = -6 + sampleTrack(BIKE.ankleTweak, phase);
    const toe = polar(ankle, footDeg, L.foot);
    const heel = polar(ankle, footDeg + 180, L.heel);
    return { knee, ankle, toe, heel };
  };
  const legN = leg(c, -1);
  const legF = leg(c + 0.5, -1);
  const torso = buildTorso(pelvis, BIKE.spine, BIKE.neck, BIKE.head, BIKE.shoulder, BIKE.elbow, c, c + 0.5, 1, 1);
  return {
    pelvis,
    hipN: pelvis,
    hipF: pelvis,
    kneeN: legN.knee, ankleN: legN.ankle, toeN: legN.toe, heelN: legN.heel,
    kneeF: legF.knee, ankleF: legF.ankle, toeF: legF.toe, heelF: legF.heel,
    ...torso,
  };
}

function buildSwim(c: number): Skeleton {
  const pelvis = V(0, sampleTrack(SWIM.pelvisBob, c));
  const leg = (phase: number, bend: number) => {
    const tDeg = sampleTrack(SWIM.thigh, phase);
    const kFlex = sampleTrack(SWIM.knee, phase);
    const aFlex = sampleTrack(SWIM.ankle, phase);
    const knee = polar(pelvis, tDeg, L.thigh);
    const shankDeg = tDeg + bend * kFlex;
    const ankle = polar(knee, shankDeg, L.shank);
    const footDeg = shankDeg + bend * aFlex;
    const toe = polar(ankle, footDeg, L.foot);
    const heel = polar(ankle, footDeg + 180, L.heel);
    return { knee, ankle, toe, heel };
  };
  const legN = leg(c, 1);
  const legF = leg(c + 0.5, 1);
  const torso = buildTorso(pelvis, SWIM.spine, SWIM.neck, SWIM.head, SWIM.shoulder, SWIM.elbow, c, c + 0.5, -1, -1);

  // Breathing: as the near arm exits and recovers (around c≈0.85) the head rolls
  // up to the side to grab a breath, then settles back into the water. A small
  // but hugely characteristic freestyle tell.
  const breath = Math.max(0, Math.sin((c - 0.72) * Math.PI / 0.28)) * (c > 0.72 && c < 1 ? 1 : 0);
  const head = vadd(torso.head, V(-1.5 * breath, -3.2 * breath));
  const headTilt = torso.headTilt - 26 * breath;

  return {
    pelvis,
    hipN: pelvis,
    hipF: pelvis,
    kneeN: legN.knee, ankleN: legN.ankle, toeN: legN.toe, heelN: legN.heel,
    kneeF: legF.knee, ankleF: legF.ankle, toeF: legF.toe, heelF: legF.heel,
    ...torso,
    head,
    headTilt,
  };
}

type Discipline = "swim" | "bike" | "run";
const BUILDERS: Record<Discipline, (c: number) => Skeleton> = {
  swim: buildSwim,
  bike: buildBike,
  run: buildRun,
};

/* -----------------------------------------------------------------------------
 * 7. World placement + morph blend
 * -------------------------------------------------------------------------- */

// where each discipline's pelvis sits in scene space, plus the whole-body lean
const PLACEMENT: Record<Discipline, { at: Vec; lean: number; scale: number }> = {
  swim: { at: V(150, 108), lean: 0, scale: 1 },
  bike: { at: V(140, 92), lean: 0, scale: 1 },
  run: { at: V(140, 100), lean: 0, scale: 1 }, // at.y + RUN_GROUND_RIG(50) = 150 (the ground)
};

/** Rotate a rig-space point about the pelvis by `lean`, scale, then translate to
 *  the discipline's world anchor. */
function place(sk: Skeleton, disc: Discipline): Skeleton {
  const { at, lean, scale } = PLACEMENT[disc];
  const cosL = Math.cos(lean * DEG);
  const sinL = Math.sin(lean * DEG);
  const tf = (p: Vec): Vec => {
    const x = p.x * scale;
    const y = p.y * scale;
    return { x: at.x + (x * cosL - y * sinL), y: at.y + (x * sinL + y * cosL) };
  };
  const out: Record<string, unknown> = {};
  (Object.keys(sk) as (keyof Skeleton)[]).forEach((k) => {
    if (k === "headTilt") out[k] = sk.headTilt + lean;
    else out[k] = tf(sk[k] as Vec);
  });
  return out as unknown as Skeleton;
}

const SKEL_KEYS: (keyof Skeleton)[] = [
  "pelvis", "chest", "neck", "head",
  "shoulderN", "elbowN", "wristN", "handN", "hipN", "kneeN", "ankleN", "toeN", "heelN",
  "shoulderF", "elbowF", "wristF", "handF", "hipF", "kneeF", "ankleF", "toeF", "heelF",
];

function blendSkeletons(items: { sk: Skeleton; w: number }[]): Skeleton {
  const out: Record<string, unknown> = {};
  SKEL_KEYS.forEach((k) => {
    let x = 0;
    let y = 0;
    items.forEach(({ sk, w }) => {
      const p = sk[k] as Vec;
      x += p.x * w;
      y += p.y * w;
    });
    out[k] = { x, y };
  });
  out.headTilt = items.reduce((s, { sk, w }) => s + sk.headTilt * w, 0);
  return out as unknown as Skeleton;
}

/** progress (0-100) → discipline weights, with smooth morph bands. */
function disciplineWeights(progress: number): Record<Discipline, number> {
  const t = clamp(progress / 100, 0, 1);
  let swim = 0;
  let bike = 0;
  let run = 0;
  if (t < 0.3) swim = 1;
  else if (t < 0.42) {
    const k = smoothstep((t - 0.3) / 0.12);
    swim = 1 - k;
    bike = k;
  } else if (t < 0.64) bike = 1;
  else if (t < 0.76) {
    const k = smoothstep((t - 0.64) / 0.12);
    bike = 1 - k;
    run = k;
  } else run = 1;
  return { swim, bike, run };
}

/* -----------------------------------------------------------------------------
 * 8. Colour — blend the discipline tokens
 * -------------------------------------------------------------------------- */

type RGB = [number, number, number];
const FALLBACK: Record<Discipline, RGB> = {
  swim: [28, 122, 162], // --swim
  bike: [176, 111, 16], // --bike
  run: [197, 55, 47], // --run
};

function readTokens(): Record<Discipline, RGB> {
  if (typeof window === "undefined") return FALLBACK;
  const cs = getComputedStyle(document.documentElement);
  const parse = (name: string, fb: RGB): RGB => {
    const v = cs.getPropertyValue(name).trim();
    const m = /^#?([0-9a-f]{6})$/i.exec(v);
    if (!m) return fb;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  return {
    swim: parse("--swim", FALLBACK.swim),
    bike: parse("--bike", FALLBACK.bike),
    run: parse("--run", FALLBACK.run),
  };
}

const rgb = (c: RGB) => `rgb(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])})`;
const mix = (cols: { c: RGB; w: number }[]): RGB =>
  [0, 1, 2].map((ch) => cols.reduce((s, { c, w }) => s + c[ch] * w, 0)) as RGB;
const lighten = (c: RGB, t: number): RGB => [
  lerp(c[0], 255, t),
  lerp(c[1], 255, t),
  lerp(c[2], 255, t),
];

/* -----------------------------------------------------------------------------
 * 9. Silhouette renderer
 *
 * Each bone is a TAPERED capsule: a trapezoid whose two ends have different
 * half-widths, capped by a filled disc at each joint. Because adjoining segments
 * share the same joint radius (thigh's knee-radius == shank's knee-radius) the
 * discs union seamlessly into one smooth, anatomically-tapered silhouette — thick
 * at the hip/shoulder, slim at the ankle/wrist — the way a real pictogram reads,
 * with no bare joints and no outline. Two passes (far then near) give depth.
 * -------------------------------------------------------------------------- */

const P = (p: Vec) => `${round2(p.x)},${round2(p.y)}`;

// half-widths (radii) at each joint — the taper is the drop from one to the next
const RAD = {
  hip: 9.5, knee: 6.4, ankle: 4.4, toe: 2.6, heel: 3.2,
  shoulder: 6.6, elbow: 4.9, wrist: 3.6, hand: 3.4,
  pelvis: 11, chest: 12.5, neckLow: 8, neckTop: 5.4,
  headRx: 8.8, headRy: 10.6,
};

/** A tapered limb segment: filled trapezoid body + a disc at each end so the
 *  joint is round and unions with the neighbouring segment. */
function Capsule({ a, b, ra, rb, color }: { a: Vec; b: Vec; ra: number; rb: number; color: string }) {
  const dv = vsub(b, a);
  const len = vlen(dv) || 0.001;
  const n = { x: -dv.y / len, y: dv.x / len };
  const A1 = vadd(a, vscale(n, ra));
  const A2 = vsub(a, vscale(n, ra));
  const B1 = vadd(b, vscale(n, rb));
  const B2 = vsub(b, vscale(n, rb));
  return (
    <>
      <path d={`M ${P(A1)} L ${P(B1)} L ${P(B2)} L ${P(A2)} Z`} fill={color} />
      <circle cx={round2(a.x)} cy={round2(a.y)} r={round2(ra)} fill={color} />
      <circle cx={round2(b.x)} cy={round2(b.y)} r={round2(rb)} fill={color} />
    </>
  );
}

function Athlete({ sk, color, farColor }: { sk: Skeleton; color: string; farColor: string }) {
  const FAR = 0.86; // far-side radius multiplier (recede)

  const Arm = ({ shoulder, elbow, wrist, hand, c, m = 1 }: { shoulder: Vec; elbow: Vec; wrist: Vec; hand: Vec; c: string; m?: number }) => (
    <g>
      <Capsule a={shoulder} b={elbow} ra={RAD.shoulder * m} rb={RAD.elbow * m} color={c} />
      <Capsule a={elbow} b={wrist} ra={RAD.elbow * m} rb={RAD.wrist * m} color={c} />
      <Capsule a={wrist} b={hand} ra={RAD.wrist * m} rb={RAD.hand * m} color={c} />
    </g>
  );

  const Leg = ({ hip, knee, ankle, toe, heel, c, m = 1 }: { hip: Vec; knee: Vec; ankle: Vec; toe: Vec; heel: Vec; c: string; m?: number }) => (
    <g>
      <Capsule a={hip} b={knee} ra={RAD.hip * m} rb={RAD.knee * m} color={c} />
      <Capsule a={knee} b={ankle} ra={RAD.knee * m} rb={RAD.ankle * m} color={c} />
      {/* foot: heel → toe, anchored at the ankle */}
      <Capsule a={heel} b={toe} ra={RAD.heel * m} rb={RAD.toe * m} color={c} />
    </g>
  );

  return (
    <g>
      {/* far side (behind, lighter + slimmer so it recedes) */}
      <Arm shoulder={sk.shoulderF} elbow={sk.elbowF} wrist={sk.wristF} hand={sk.handF} c={farColor} m={FAR} />
      <Leg hip={sk.hipF} knee={sk.kneeF} ankle={sk.ankleF} toe={sk.toeF} heel={sk.heelF} c={farColor} m={FAR} />

      {/* torso mass — a wide trunk tapering up to the shoulders, then the neck */}
      <Capsule a={sk.pelvis} b={sk.chest} ra={RAD.pelvis} rb={RAD.chest} color={color} />
      <Capsule a={sk.chest} b={sk.neck} ra={RAD.neckLow} rb={RAD.neckTop} color={color} />

      {/* head */}
      <g transform={`rotate(${round2(sk.headTilt)} ${round2(sk.head.x)} ${round2(sk.head.y)})`}>
        <ellipse cx={round2(sk.head.x)} cy={round2(sk.head.y)} rx={RAD.headRx} ry={RAD.headRy} fill={color} />
      </g>

      {/* near side (in front, solid) */}
      <Leg hip={sk.hipN} knee={sk.kneeN} ankle={sk.ankleN} toe={sk.toeN} heel={sk.heelN} c={color} />
      <Arm shoulder={sk.shoulderN} elbow={sk.elbowN} wrist={sk.wristN} hand={sk.handN} c={color} />
    </g>
  );
}

/* -----------------------------------------------------------------------------
 * 10. Scene layers (water / bike / road / finish) — cross-faded on weights
 *
 * Every scene layer takes an `opacity` derived from the discipline weights, so
 * the water dissolves exactly as the bike fades in and the road ticks arrive.
 * Draw order (back → front): baseline, course ticks, contact shadow, transition
 * marker, speed lines, water, bubbles, bike, finish tape, THEN the athlete, then
 * the splash on top of the pulling hand. The athlete is always drawn last of the
 * "live" figure layers so the solid silhouette reads cleanly over the scenery.
 * -------------------------------------------------------------------------- */

const GROUND = 150;

function Water({ opacity, clock, color }: { opacity: number; clock: number; color: string }) {
  if (opacity < 0.01) return null;
  const line = (y: number, amp: number, ph: number, w: number, op: number) => {
    const pts = Array.from({ length: 16 }, (_, i) => {
      const x = i * 20;
      const yy = y + amp * Math.sin(i * 0.9 + clock * 2.4 + ph);
      return `${x} ${round2(yy)}`;
    });
    return <path d={`M0 ${y} L${pts.join(" L")}`} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" opacity={op} />;
  };
  return (
    <g opacity={opacity}>
      {line(122, 2.6, 0, 1.6, 0.55)}
      {line(129, 2.0, 1.4, 1.2, 0.32)}
      {line(136, 1.6, 3.0, 1.0, 0.2)}
    </g>
  );
}

function Splash({ opacity, clock, at, color }: { opacity: number; clock: number; at: Vec; color: string }) {
  if (opacity < 0.01) return null;
  const drops = Array.from({ length: 5 }, (_, i) => {
    const a = (i / 5) * Math.PI - Math.PI * 0.15;
    const t = (clock * 1.6 + i * 0.3) % 1;
    const d = 6 + t * 14;
    const p = { x: at.x + Math.cos(a) * d, y: at.y - Math.sin(a) * d - t * 4 };
    return <circle key={i} cx={round2(p.x)} cy={round2(p.y)} r={round2(1.6 * (1 - t))} fill={color} opacity={(1 - t) * 0.7} />;
  });
  return <g opacity={opacity}>{drops}</g>;
}

/** A trail of little bubbles rising off the swimmer — cheap, but it sells the
 *  "under water" read and gives the swim leg some life beyond the stroke. */
function Bubbles({ opacity, clock, at, color }: { opacity: number; clock: number; at: Vec; color: string }) {
  if (opacity < 0.02) return null;
  const bubbles = Array.from({ length: 7 }, (_, i) => {
    const seed = i * 0.618;
    const t = (clock * 0.5 + seed) % 1;
    const x = at.x - 6 - i * 3 + Math.sin((t + seed) * 6.283) * 2.4;
    const y = 116 - t * 20; // rise toward the surface
    const r = (0.8 + (i % 3) * 0.5) * (1 - t * 0.6);
    return <circle key={i} cx={round2(x)} cy={round2(y)} r={round2(Math.max(0.2, r))} fill="none" stroke={color} strokeWidth={0.8} opacity={(1 - t) * 0.4} />;
  });
  return <g opacity={opacity}>{bubbles}</g>;
}

/** T1 / T2 transition markers — a hairline post + small pennant that drifts past
 *  during a discipline change, the way a real transition zone flags the switch.
 *  Only visible mid-morph so it never clutters a settled leg. */
function Transition({ progress }: { progress: number }) {
  // T1 sits in the swim→bike band (0.30–0.42), T2 in the bike→run band (0.64–0.76)
  const bands: { lo: number; hi: number; label: string }[] = [
    { lo: 30, hi: 42, label: "T1" },
    { lo: 64, hi: 76, label: "T2" },
  ];
  const active = bands.find((b) => progress > b.lo && progress < b.hi);
  if (!active) return null;
  const k = (progress - active.lo) / (active.hi - active.lo); // 0→1 across the band
  const x = lerp(250, 40, ease.inOutQuad(k)); // drifts leftward as we pass it
  const op = Math.sin(k * Math.PI) * 0.5; // fade in then out
  return (
    <g opacity={op}>
      <line x1={round2(x)} y1={GROUND} x2={round2(x)} y2={GROUND - 34} stroke="var(--text-faint)" strokeWidth={1.4} />
      <path d={`M${round2(x)} ${GROUND - 34} L${round2(x + 12)} ${GROUND - 30} L${round2(x)} ${GROUND - 26} Z`} fill="var(--text-faint)" opacity={0.8} />
      <text x={round2(x + 2)} y={GROUND - 6} fontSize={7} fill="var(--text-faint)" fontWeight={600} letterSpacing={0.5}>
        {active.label}
      </text>
    </g>
  );
}

function Bike({ opacity, clock, color }: { opacity: number; clock: number; color: string }) {
  if (opacity < 0.01) return null;
  // scene-space geometry roughly matching the cyclist rig placement
  const rear = V(110, GROUND - 16);
  const front = V(182, GROUND - 16);
  const bb = V(146, GROUND - 16); // bottom bracket (crank centre in scene)
  const seat = V(140, 96);
  const bar = V(178, 96);
  const wheelR = 16;
  const spin = clock * 1.05 * 360;
  const spoke = (wc: Vec, off: number) => {
    const d1 = polar(wc, off + spin, wheelR);
    const d2 = polar(wc, off + spin + 180, wheelR);
    return <line x1={round2(d1.x)} y1={round2(d1.y)} x2={round2(d2.x)} y2={round2(d2.y)} stroke={color} strokeWidth={0.9} opacity={0.45} />;
  };
  return (
    <g opacity={opacity} fill="none" stroke={color} strokeLinecap="round">
      <circle cx={rear.x} cy={rear.y} r={wheelR} strokeWidth={2.4} />
      <circle cx={front.x} cy={front.y} r={wheelR} strokeWidth={2.4} />
      {[0, 45, 90, 135].map((o) => (
        <g key={`r${o}`}>{spoke(rear, o)}</g>
      ))}
      {[0, 45, 90, 135].map((o) => (
        <g key={`f${o}`}>{spoke(front, o)}</g>
      ))}
      <circle cx={rear.x} cy={rear.y} r={2} fill={color} />
      <circle cx={front.x} cy={front.y} r={2} fill={color} />
      {/* frame */}
      <polyline points={`${P(rear)} ${P(bb)} ${P(seat)} ${P(rear)}`} strokeWidth={2.4} />
      <polyline points={`${P(bb)} ${P(seat)}`} strokeWidth={2.4} />
      <polyline points={`${P(seat)} ${P(bar)} ${P(front)}`} strokeWidth={2.4} />
      <polyline points={`${P(bb)} ${P(bar)}`} strokeWidth={2.4} />
      {/* handlebar + saddle caps */}
      <line x1={bar.x} y1={bar.y} x2={bar.x + 7} y2={bar.y - 5} strokeWidth={2.4} />
      <line x1={seat.x - 4} y1={seat.y} x2={seat.x + 4} y2={seat.y - 1} strokeWidth={2.6} />
      {/* drivetrain: chainring at the bottom bracket + a chain loop back to the
          rear cassette, and cranks that turn with the wheels */}
      <circle cx={bb.x} cy={bb.y} r={4.5} strokeWidth={1.4} />
      <circle cx={rear.x} cy={rear.y} r={4} strokeWidth={1.2} />
      <line x1={round2(bb.x)} y1={round2(bb.y - 4.5)} x2={round2(rear.x)} y2={round2(rear.y - 4)} strokeWidth={1} opacity={0.7} />
      <line x1={round2(bb.x)} y1={round2(bb.y + 4.5)} x2={round2(rear.x)} y2={round2(rear.y + 4)} strokeWidth={1} opacity={0.7} />
      {(() => {
        const c1 = polar(bb, spin, 8);
        const c2 = polar(bb, spin + 180, 8);
        return (
          <>
            <line x1={round2(bb.x)} y1={round2(bb.y)} x2={round2(c1.x)} y2={round2(c1.y)} strokeWidth={1.8} />
            <line x1={round2(bb.x)} y1={round2(bb.y)} x2={round2(c2.x)} y2={round2(c2.y)} strokeWidth={1.8} />
          </>
        );
      })()}
      <circle cx={bb.x} cy={bb.y} r={2.4} fill={color} />
    </g>
  );
}

function SpeedLines({ opacity, clock, color }: { opacity: number; clock: number; color: string }) {
  if (opacity < 0.01) return null;
  return (
    <g opacity={opacity}>
      {[0, 1, 2].map((i) => {
        const x = 84 - i * 30 - ((clock * 130) % 30);
        return <line key={i} x1={round2(x)} y1={GROUND - 20 - i * 8} x2={round2(x - 20)} y2={GROUND - 20 - i * 8} stroke={color} strokeWidth={2.2} strokeLinecap="round" opacity={0.32 - i * 0.08} />;
      })}
    </g>
  );
}

/** Soft ground-contact shadow — grounds the athlete so it doesn't float. Wide &
 *  flat under the bike, tighter under the runner; cross-fades between the two. */
function Shadow({ wBike, wRun, athleteX }: { wBike: number; wRun: number; athleteX: number }) {
  const op = wBike + wRun;
  if (op < 0.02) return null;
  const cx = (146 * wBike + athleteX * wRun) / (op || 1);
  const rx = (46 * wBike + 26 * wRun) / (op || 1);
  return <ellipse cx={round2(cx)} cy={GROUND + 2.5} rx={round2(rx)} ry={3.4} fill="var(--text)" opacity={op * 0.09} />;
}

/** Scrolling ground ticks — a quiet metronome of distance sliding past, so the
 *  bike/run legs read as forward travel rather than a treadmill in place. */
function Course({ opacity, clock }: { opacity: number; clock: number }) {
  if (opacity < 0.02) return null;
  const spacing = 46;
  const shift = ((clock * 118) % spacing + spacing) % spacing;
  const ticks = [];
  for (let i = -1; i < 8; i++) {
    const x = i * spacing - shift + 14;
    ticks.push(
      <line key={i} x1={round2(x)} y1={GROUND + 1} x2={round2(x - 9)} y2={GROUND + 1} stroke="var(--line)" strokeWidth={1.6} strokeLinecap="round" />,
    );
  }
  return <g opacity={opacity}>{ticks}</g>;
}

function Finish({ progress }: { progress: number }) {
  if (progress <= 76) return null;
  const k = clamp((progress - 76) / 24, 0, 1);
  const x = lerp(320, 196, ease.outCubic(k));
  const op = clamp((progress - 76) / 12, 0, 1);
  return (
    <g opacity={op}>
      <line x1={round2(x)} y1={GROUND} x2={round2(x)} y2={GROUND - 96} stroke="var(--text)" strokeWidth={2.4} />
      {Array.from({ length: 8 }).map((_, i) => (
        <rect key={i} x={round2(x - 7)} y={GROUND - 96 + i * 10} width={7} height={10} fill={i % 2 ? "var(--text)" : "#fff"} stroke="var(--text)" strokeWidth={0.5} />
      ))}
      <line x1={round2(x)} y1={GROUND - 52} x2={round2(x - 60)} y2={GROUND - 52} stroke="var(--text)" strokeWidth={1.5} opacity={0.5} strokeDasharray="1 4" />
      {/* small small-caps FINISH tag at the top of the post, in the Paper voice */}
      <text
        x={round2(x + 4)}
        y={GROUND - 92}
        fontSize={7}
        fontWeight={700}
        letterSpacing={1.2}
        fill="var(--text)"
      >
        FINISH
      </text>
    </g>
  );
}

/* -----------------------------------------------------------------------------
 * 11. The component
 * -------------------------------------------------------------------------- */

export function TriathleteMorph({
  progress,
  width = 300,
  frozenClock,
}: {
  progress: number;
  width?: number;
  frozenClock?: number;
}) {
  const [clock, setClock] = useState(frozenClock ?? 0);
  const tokens = useRef<Record<Discipline, RGB>>(FALLBACK);

  useEffect(() => {
    tokens.current = readTokens();
  }, []);

  useEffect(() => {
    if (frozenClock != null) {
      setClock(frozenClock);
      return;
    }
    const reduce =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      setClock((now - start) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frozenClock]);

  const w = disciplineWeights(progress);

  // per-discipline cadences (cycles / second)
  const cad: Record<Discipline, number> = { swim: 0.5, bike: 1.0, run: 1.5 };

  // build + place only the active skeletons, then blend
  const active = (Object.keys(w) as Discipline[]).filter((d) => w[d] > 0.001);
  const sk = useMemo(() => {
    const items = active.map((d) => ({ sk: place(BUILDERS[d](clock * cad[d]), d), w: w[d] }));
    return blendSkeletons(items);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clock, progress]);

  // colour
  const colItems = active.map((d) => ({ c: tokens.current[d], w: w[d] }));
  const base = colItems.length ? mix(colItems) : FALLBACK.run;
  const color = rgb(base);
  const farColor = rgb(lighten(base, 0.6));

  const handN = sk.handN;

  return (
    <svg
      viewBox="0 0 300 200"
      width={width}
      height={width * (200 / 300)}
      style={{ display: "block", overflow: "visible" }}
      aria-hidden
    >
      {/* baseline for bike + run */}
      <line x1={12} y1={GROUND} x2={288} y2={GROUND} stroke="var(--line)" strokeWidth={1.5} opacity={w.bike + w.run} />
      <Course opacity={w.bike + w.run} clock={clock} />

      <Shadow wBike={w.bike} wRun={w.run} athleteX={sk.pelvis.x} />
      <Transition progress={progress} />
      <SpeedLines opacity={w.run} clock={clock} color={color} />
      <Water opacity={w.swim} clock={clock} color={color} />
      <Bubbles opacity={w.swim} clock={clock} at={sk.head} color={color} />
      <Bike opacity={w.bike} clock={clock} color={color} />
      <Finish progress={progress} />

      <Athlete sk={sk} color={color} farColor={farColor} />

      <Splash opacity={w.swim} clock={clock} at={handN} color={color} />
    </svg>
  );
}
