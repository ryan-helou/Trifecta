"use client";

/**
 * TriathleteMorph — the plan-generation loading centrepiece.
 *
 * One articulated line-figure that MORPHS through the three legs of a triathlon
 * as `progress` (0–100) climbs: a swimmer rises out of the water, folds onto a
 * bike, then stands up and runs into a finish tape. There are no sprite frames —
 * every pose is defined by a handful of joint TARGETS (hands, feet, hip,
 * shoulder, head) and the elbows/knees are solved with 2-bone IK, so blending
 * two poses is just a weighted average of their targets. Limbs also cycle on
 * their own clock (windmill / pedal / stride) independent of progress, so the
 * athlete is always alive even while the bar barely moves.
 *
 * Paper aesthetic: ink on white, hairline scene, the single stroke colour
 * cross-fades swim-blue → bike-ochre → run-brick (the discipline tokens).
 */

import { useEffect, useRef, useState } from "react";

type P = { x: number; y: number };
const dir = (deg: number): P => {
  const r = (deg * Math.PI) / 180;
  return { x: Math.cos(r), y: Math.sin(r) };
};
const add = (a: P, b: P): P => ({ x: a.x + b.x, y: a.y + b.y });
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 2-bone IK: given a root and a target within reach, return the middle joint.
 *  `bend` (+1/-1) chooses which side the joint bows to. */
function ik(root: P, target: P, l1: number, l2: number, bend: number): P {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const d = clamp(Math.hypot(dx, dy), Math.abs(l1 - l2) + 0.01, l1 + l2 - 0.01);
  const base = Math.atan2(dy, dx);
  const cosA = clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1);
  const a = base + bend * Math.acos(cosA);
  return { x: root.x + Math.cos(a) * l1, y: root.y + Math.sin(a) * l1 };
}

// segment lengths — shared across every pose so IK stays consistent through a morph
const UP_ARM = 17, FORE_ARM = 17;
const THIGH = 22, SHANK = 20, FOOT = 10;
const GROUND = 137;

type Pose = {
  hip: P; shoulder: P; head: P; headR: number;
  wristN: P; wristF: P;      // arm end-effectors (near / far)
  ankleN: P; ankleF: P;      // leg end-effectors
  toeN: number; toeF: number; // foot direction (deg)
  elbowBend: number; kneeBend: number;
};

const TAU = Math.PI * 2;

/** SWIM — prone, freestyle windmill just under the surface. */
function swimPose(c: number): Pose {
  const hip = { x: 150, y: 104 };
  const shoulder = { x: 116, y: 101 };
  const reach = 29;
  return {
    hip, shoulder,
    head: { x: 101, y: 99 }, headR: 8,
    wristN: add(shoulder, { x: reach * Math.cos(TAU * c), y: reach * Math.sin(TAU * c) }),
    wristF: add(shoulder, { x: reach * Math.cos(TAU * c + Math.PI), y: reach * Math.sin(TAU * c + Math.PI) }),
    ankleN: { x: hip.x + 40, y: hip.y + 7 * Math.sin(TAU * c * 2) },
    ankleF: { x: hip.x + 40, y: hip.y - 7 * Math.sin(TAU * c * 2) },
    toeN: 4, toeF: 4,
    elbowBend: -1, kneeBend: 1,
  };
}

/** BIKE — crouched over the bars, feet circling the crank. */
function bikePose(c: number): Pose {
  const hip = { x: 120, y: 96 };
  const shoulder = { x: 147, y: 82 };
  const bb = { x: 129, y: 117 };      // bottom bracket
  const crank = 11;
  const bar = { x: 173, y: 99 };      // handlebar
  return {
    hip, shoulder,
    head: { x: 160, y: 75 }, headR: 9,
    wristN: add(bar, { x: 0, y: 1 * Math.sin(TAU * c) }),
    wristF: { ...bar },
    ankleN: add(bb, { x: crank * Math.cos(TAU * c), y: crank * Math.sin(TAU * c) }),
    ankleF: add(bb, { x: crank * Math.cos(TAU * c + Math.PI), y: crank * Math.sin(TAU * c + Math.PI) }),
    toeN: 18, toeF: 18,
    elbowBend: 1, kneeBend: 1,
  };
}

/** RUN — upright, driving into a stride. */
function runPose(c: number): Pose {
  const bob = -2.5 * (0.5 - 0.5 * Math.cos(TAU * c * 2));
  const hip = { x: 125, y: 96 + bob };
  const shoulder = { x: 133, y: 62 + bob };   // driving forward lean
  const ang = TAU * c;
  const foot = (a: number): P => ({
    x: hip.x + 21 * Math.sin(a),
    y: GROUND - 24 * Math.max(0, Math.sin(a)),
  });
  const armAng = ang + Math.PI;
  const wrist = (a: number): P => ({
    x: shoulder.x + 5 + 14 * Math.sin(a),
    y: shoulder.y + 17 + 6 * Math.sin(a),
  });
  return {
    hip, shoulder,
    head: { x: 137, y: 49 + bob }, headR: 9,
    wristN: wrist(armAng),
    wristF: wrist(armAng + Math.PI),
    ankleN: foot(ang),
    ankleF: foot(ang + Math.PI),
    toeN: 20, toeF: 20,
    elbowBend: -1, kneeBend: 1,
  };
}

const blend2 = (a: P, b: P, k: number): P => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) });

/** Weighted blend of the three poses. Weights sum to 1. Bend signs snap to the
 *  dominant discipline so the joints never flip mid-morph. */
function blendPose(poses: Pose[], w: number[]): Pose {
  const acc = (pick: (p: Pose) => P): P =>
    poses.reduce((s, p, i) => add(s, { x: pick(p).x * w[i], y: pick(p).y * w[i] }), { x: 0, y: 0 });
  const num = (pick: (p: Pose) => number) => poses.reduce((s, p, i) => s + pick(p) * w[i], 0);
  const dom = w.indexOf(Math.max(...w));
  return {
    hip: acc((p) => p.hip), shoulder: acc((p) => p.shoulder), head: acc((p) => p.head),
    headR: num((p) => p.headR),
    wristN: acc((p) => p.wristN), wristF: acc((p) => p.wristF),
    ankleN: acc((p) => p.ankleN), ankleF: acc((p) => p.ankleF),
    toeN: num((p) => p.toeN), toeF: num((p) => p.toeF),
    elbowBend: poses[dom].elbowBend, kneeBend: poses[dom].kneeBend,
  };
}

/** progress (0-100) → discipline weights [swim, bike, run], with smooth morph bands. */
function weights(progress: number): number[] {
  const t = clamp(progress / 100, 0, 1);
  const smooth = (k: number) => k * k * (3 - 2 * k);
  if (t < 0.3) return [1, 0, 0];
  if (t < 0.42) { const k = smooth((t - 0.3) / 0.12); return [1 - k, k, 0]; }
  if (t < 0.64) return [0, 1, 0];
  if (t < 0.76) { const k = smooth((t - 0.64) / 0.12); return [0, 1 - k, k]; }
  return [0, 0, 1];
}

// discipline stroke colours (fallbacks mirror the --swim/--bike/--run tokens)
type RGB = [number, number, number];
const FALLBACK: RGB[] = [[28, 122, 162], [176, 111, 16], [197, 55, 47]];
const mixColor = (cols: RGB[], w: number[]): string => {
  const c = [0, 1, 2].map((ch) => Math.round(cols.reduce((s, col, i) => s + col[ch] * w[i], 0)));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
};

function readTokens(): RGB[] {
  if (typeof window === "undefined") return FALLBACK;
  const cs = getComputedStyle(document.documentElement);
  const parse = (name: string, fb: RGB): RGB => {
    const v = cs.getPropertyValue(name).trim();
    const m = /^#?([0-9a-f]{6})$/i.exec(v);
    if (!m) return fb;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  return [parse("--swim", FALLBACK[0]), parse("--bike", FALLBACK[1]), parse("--run", FALLBACK[2])];
}

export function TriathleteMorph({
  progress,
  width = 280,
  frozenClock,
}: {
  progress: number;
  width?: number;
  frozenClock?: number;
}) {
  const [clock, setClock] = useState(frozenClock ?? 0);
  const cols = useRef<RGB[]>(FALLBACK);

  useEffect(() => {
    cols.current = readTokens();
  }, []);

  useEffect(() => {
    if (frozenClock != null) { setClock(frozenClock); return; }
    const reduce = typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
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

  const w = weights(progress);
  // per-discipline limb cadences (cycles/sec)
  const poses = [swimPose(clock * 0.55), bikePose(clock * 1.05), runPose(clock * 1.45)];
  const pose = blendPose(poses, w);

  const elbowN = ik(pose.shoulder, pose.wristN, UP_ARM, FORE_ARM, pose.elbowBend);
  const elbowF = ik(pose.shoulder, pose.wristF, UP_ARM, FORE_ARM, pose.elbowBend);
  const kneeN = ik(pose.hip, pose.ankleN, THIGH, SHANK, pose.kneeBend);
  const kneeF = ik(pose.hip, pose.ankleF, THIGH, SHANK, pose.kneeBend);
  const toeN = add(pose.ankleN, { x: FOOT * dir(pose.toeN).x, y: FOOT * dir(pose.toeN).y });
  const toeF = add(pose.ankleF, { x: FOOT * dir(pose.toeF).x, y: FOOT * dir(pose.toeF).y });

  const color = mixColor(cols.current, w);
  const [wSwim, wBike, wRun] = w;
  const groundOp = wBike + wRun;

  // bike geometry (fades with wBike)
  const bb = { x: 129, y: 117 };
  const rearW = { x: 100, y: GROUND - 2 };
  const frontW = { x: 176, y: GROUND - 2 };
  const seat = { x: 118, y: 98 };
  const bar = { x: 173, y: 99 };
  const wheelR = 15;
  const spin = clock * 1.05 * 360;

  // finish tape — slides in from the right during the run and meets the athlete at 100%
  const finishX = lerp(300, 168, clamp((progress - 76) / 24, 0, 1));

  // round every dynamic SVG coordinate to 2dp so server + client render byte-identical
  // strings (raw floats differ by an ULP between environments → hydration mismatch)
  const R = (n: number) => Math.round(n * 100) / 100;
  const P = (p: P) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;
  const line = (a: P, b: P, sw = 3.4) => (
    <line x1={R(a.x)} y1={R(a.y)} x2={R(b.x)} y2={R(b.y)} stroke={color} strokeWidth={sw} strokeLinecap="round" />
  );

  return (
    <svg viewBox="0 0 260 170" width={width} height={width * (170 / 260)} style={{ display: "block", overflow: "visible" }} aria-hidden>
      {/* ground line — for bike + run */}
      <line x1="16" y1={GROUND} x2="244" y2={GROUND} stroke="var(--line)" strokeWidth="1.5" opacity={groundOp} />

      {/* run speed ticks */}
      {wRun > 0.01 && [0, 1, 2].map((i) => {
        const x = 70 - i * 26 - ((clock * 120) % 26);
        return <line key={i} x1={R(x)} y1={GROUND - 14 - i * 6} x2={R(x - 16)} y2={GROUND - 14 - i * 6}
          stroke={color} strokeWidth="2" strokeLinecap="round" opacity={wRun * (0.28 - i * 0.06)} />;
      })}

      {/* water — swim surface + ripple */}
      {wSwim > 0.01 && (
        <g opacity={wSwim}>
          <path
            d={`M8 112 ${Array.from({ length: 12 }).map((_, i) => {
              const x = 8 + i * 22;
              const y = 112 + 2.5 * Math.sin(i * 1.1 + clock * 3);
              return `L${x.toFixed(1)} ${y.toFixed(1)}`;
            }).join(" ")}`}
            fill="none" stroke={color} strokeWidth="1.5" opacity={0.5}
          />
          <path
            d={`M8 118 ${Array.from({ length: 12 }).map((_, i) => {
              const x = 8 + i * 22;
              const y = 118 + 2 * Math.sin(i * 1.1 + clock * 3 + 1.5);
              return `L${x.toFixed(1)} ${y.toFixed(1)}`;
            }).join(" ")}`}
            fill="none" stroke={color} strokeWidth="1" opacity={0.28}
          />
        </g>
      )}

      {/* bike — line-art, fades in under the cyclist */}
      {wBike > 0.01 && (
        <g opacity={wBike} stroke={color} fill="none" strokeLinecap="round">
          <circle cx={rearW.x} cy={rearW.y} r={wheelR} strokeWidth="2.4" />
          <circle cx={frontW.x} cy={frontW.y} r={wheelR} strokeWidth="2.4" />
          {/* spokes */}
          {[rearW, frontW].map((wc, wi) =>
            [0, 60, 120].map((a) => {
              const d1 = dir(a + spin), d2 = dir(a + spin + 180);
              return <line key={`${wi}-${a}`} x1={R(wc.x + d1.x * wheelR)} y1={R(wc.y + d1.y * wheelR)}
                x2={R(wc.x + d2.x * wheelR)} y2={R(wc.y + d2.y * wheelR)} strokeWidth="0.8" opacity={0.5} />;
            })
          )}
          {/* frame */}
          <polyline points={`${P(rearW)} ${P(bb)} ${P(seat)} ${P(rearW)}`} strokeWidth="2" />
          <polyline points={`${P(bb)} ${P(seat)} ${P(bar)} ${P(frontW)}`} strokeWidth="2" />
          <line x1={bar.x} y1={bar.y} x2={bar.x + 6} y2={bar.y - 4} strokeWidth="2" />
        </g>
      )}

      {/* finish tape */}
      {progress > 76 && (
        <g opacity={clamp((progress - 76) / 12, 0, 1)}>
          <line x1={R(finishX)} y1={GROUND} x2={R(finishX)} y2={GROUND - 74} stroke="var(--text)" strokeWidth="2" />
          {Array.from({ length: 7 }).map((_, i) => (
            <rect key={i} x={R(finishX - 6)} y={GROUND - 74 + i * 9} width="6" height="9"
              fill={i % 2 ? "var(--text)" : "#fff"} stroke="var(--text)" strokeWidth="0.5" />
          ))}
          <line x1={R(finishX)} y1={GROUND - 40} x2={R(pose.shoulder.x)} y2={GROUND - 40}
            stroke="var(--text)" strokeWidth="1.5" opacity={0.55} strokeDasharray="1 4" />
        </g>
      )}

      {/* ---- the athlete (drawn last, on top) ---- */}
      {/* far limbs first (behind torso), slightly lighter for depth */}
      <g opacity={0.72}>
        {line(pose.shoulder, elbowF, 3)}
        {line(elbowF, pose.wristF, 3)}
        {line(pose.hip, kneeF, 3.2)}
        {line(kneeF, pose.ankleF, 3.2)}
        {line(pose.ankleF, toeF, 3)}
      </g>
      {/* torso + head */}
      {line(pose.shoulder, pose.hip, 4.4)}
      <circle cx={R(pose.head.x)} cy={R(pose.head.y)} r={R(pose.headR)} fill={color} />
      {/* near limbs */}
      {line(pose.shoulder, elbowN, 3.4)}
      {line(elbowN, pose.wristN, 3.4)}
      {line(pose.hip, kneeN, 3.6)}
      {line(kneeN, pose.ankleN, 3.6)}
      {line(pose.ankleN, toeN, 3.2)}
    </svg>
  );
}
