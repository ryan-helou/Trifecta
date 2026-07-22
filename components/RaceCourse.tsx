"use client";

/* =============================================================================
 * RaceCourse — the plan-generation loading centrepiece
 * =============================================================================
 *
 * An editorial race-course PROFILE that inks itself in as `progress` (0–100)
 * climbs. The full swim → T1 → bike → T2 → run course is always present as a
 * faint "ghost" (the whole journey ahead, like a course map); the completed
 * portion draws in over it AND fills with its discipline colour — swim-blue open
 * water, bike-ochre rolling hills, run-brick to the line — like a race-profile
 * chart filling up. A pulsing marker rides the leading edge and a checkered
 * finish flag waves at the end.
 *
 * No human figure: the hard, uncanny part (anatomy) is gone. This is the "Paper"
 * aesthetic at its best — ink on white, a restrained elevation chart, discipline
 * colour used only where it tells the story. Progress-driven and deterministic;
 * the only ambient motion is a SMIL marker pulse + a fluttering flag, both
 * suppressed under prefers-reduced-motion.
 * ============================================================================= */

import { useEffect, useId, useState } from "react";

type Pt = { x: number; y: number };
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const r2 = (n: number) => Math.round(n * 100) / 100;

/* -- geometry ---------------------------------------------------------------- */

// viewBox: 0 0 320 190. x runs start → finish; y is elevation (smaller = higher).
const BASE = 158; // chart baseline (sea level / ground) for the area fill

/** Sample a Catmull-Rom spline through `anchors` into a dense, smooth polyline. */
function catmull(anchors: Pt[], perSeg: number): Pt[] {
  const out: Pt[] = [];
  const n = anchors.length;
  for (let i = 0; i < n - 1; i++) {
    const p0 = anchors[Math.max(0, i - 1)];
    const p1 = anchors[i];
    const p2 = anchors[i + 1];
    const p3 = anchors[Math.min(n - 1, i + 2)];
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(anchors[n - 1]);
  return out;
}

type Leg = {
  key: "swim" | "bike" | "run";
  color: string;
  label: string;
  pts: Pt[];
  cum: number[]; // cumulative arc length at each point
  len: number;
  startArc: number; // arc length from the course start to this leg's start
};

function measure(pts: Pt[], startArc: number): Omit<Leg, "key" | "color" | "label"> {
  const cum = [0];
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += dist(pts[i - 1], pts[i]);
    cum.push(len);
  }
  return { pts, cum, len, startArc };
}

function buildCourse(): { legs: Leg[]; total: number } {
  // SWIM — open water: a low, gently rippling line
  const swim: Pt[] = [];
  for (let x = 22; x <= 104; x += 2) swim.push({ x, y: 132 + 4 * Math.sin((x - 22) * 0.42) });

  // BIKE — the marquee: rolling hills with two real climbs
  const bike = catmull(
    [{ x: 104, y: 130 }, { x: 126, y: 92 }, { x: 150, y: 114 }, { x: 176, y: 70 }, { x: 200, y: 116 }, { x: 216, y: 122 }],
    9,
  );

  // RUN — steadier, a gentle roll to the line
  const run = catmull(
    [{ x: 216, y: 122 }, { x: 242, y: 128 }, { x: 266, y: 114 }, { x: 290, y: 126 }, { x: 304, y: 126 }],
    9,
  );

  const s = measure(swim, 0);
  const b = measure(bike, s.len);
  const r = measure(run, s.len + b.len);
  const legs: Leg[] = [
    { key: "swim", color: "var(--swim)", label: "Swim", ...s },
    { key: "bike", color: "var(--bike)", label: "Bike", ...b },
    { key: "run", color: "var(--run)", label: "Run", ...r },
  ];
  return { legs, total: s.len + b.len + r.len };
}

const COURSE = buildCourse();

// perceptual balance for the completed-area tints (blue reads darker than
// ochre/red at the same alpha, so it gets less)
const FILL_OPACITY: Record<Leg["key"], number> = { swim: 0.26, bike: 0.44, run: 0.4 };

/* -- helpers ----------------------------------------------------------------- */

const pathD = (pts: Pt[]) => "M " + pts.map((p) => `${r2(p.x)} ${r2(p.y)}`).join(" L ");
const areaD = (pts: Pt[]) => `${pathD(pts)} L ${r2(pts[pts.length - 1].x)} ${BASE} L ${r2(pts[0].x)} ${BASE} Z`;

/** Point at local arc length `a` along one leg's polyline. */
function pointOnLeg(leg: Leg, a: number): Pt {
  if (a <= 0) return leg.pts[0];
  if (a >= leg.len) return leg.pts[leg.pts.length - 1];
  for (let i = 1; i < leg.pts.length; i++) {
    if (leg.cum[i] >= a) {
      const t = (a - leg.cum[i - 1]) / (leg.cum[i] - leg.cum[i - 1] || 1);
      return { x: lerp(leg.pts[i - 1].x, leg.pts[i].x, t), y: lerp(leg.pts[i - 1].y, leg.pts[i].y, t) };
    }
  }
  return leg.pts[leg.pts.length - 1];
}

/* -- small scene pieces ------------------------------------------------------ */

function Node({ p, label }: { p: Pt; label: string }) {
  return (
    <g>
      <line x1={r2(p.x)} y1={r2(p.y)} x2={r2(p.x)} y2={BASE} stroke="var(--line)" strokeWidth={1} strokeDasharray="1 3" />
      <circle cx={r2(p.x)} cy={r2(p.y)} r={2.4} fill="var(--background)" stroke="var(--text-faint)" strokeWidth={1.4} />
      <text x={r2(p.x)} y={BASE + 12} textAnchor="middle" fontSize={6.5} fontWeight={700} letterSpacing={0.6} fill="var(--text-faint)">
        {label}
      </text>
    </g>
  );
}

/** A checkered finish flag on a pole that gently flutters (SMIL). */
function FinishFlag({ p, reduce, checkerId }: { p: Pt; reduce: boolean; checkerId: string }) {
  const fx = r2(p.x);
  const top = r2(p.y - 42);
  const w = 26;
  const h = 17;
  // two wave states — the outline ripples, the checker pattern shows through
  const wave = (s: number) =>
    `M ${fx} ${top} Q ${r2(p.x + 6.5)} ${r2(p.y - 42 - 3 * s)} ${r2(p.x + 13)} ${top} ` +
    `Q ${r2(p.x + 19.5)} ${r2(p.y - 42 + 3 * s)} ${r2(p.x + w)} ${r2(p.y - 42 - 1 * s)} ` +
    `L ${r2(p.x + w)} ${r2(p.y - 42 + h - 1 * s)} ` +
    `Q ${r2(p.x + 19.5)} ${r2(p.y - 42 + h + 3 * s)} ${r2(p.x + 13)} ${r2(p.y - 42 + h)} ` +
    `Q ${r2(p.x + 6.5)} ${r2(p.y - 42 + h - 3 * s)} ${fx} ${r2(p.y - 42 + h)} Z`;
  const d1 = wave(1);
  const d2 = wave(-1);
  return (
    <g>
      <line x1={fx} y1={r2(p.y)} x2={fx} y2={r2(p.y - 44)} stroke="var(--text)" strokeWidth={2} strokeLinecap="round" />
      <circle cx={fx} cy={r2(p.y - 44)} r={1.7} fill="var(--text)" />
      <path d={d1} fill={`url(#${checkerId})`} stroke="var(--text)" strokeWidth={0.6} strokeLinejoin="round">
        {!reduce && <animate attributeName="d" values={`${d1};${d2};${d1}`} dur="1.7s" repeatCount="indefinite" calcMode="spline" keyTimes="0;0.5;1" keySplines="0.4 0 0.6 1;0.4 0 0.6 1" />}
      </path>
      <text x={r2(p.x + 8)} y={BASE + 12} textAnchor="middle" fontSize={6.5} fontWeight={700} letterSpacing={0.6} fill="var(--text-faint)">
        FINISH
      </text>
    </g>
  );
}

/* -- component ---------------------------------------------------------------- */

export function RaceCourse({ progress, width = 300 }: { progress: number; width?: number }) {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    setReduce(!!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  }, []);

  // unique ids so multiple instances (or SSR + client) never collide on the
  // shared clipPath / pattern definitions
  const uid = useId().replace(/[:]/g, "");
  const doneId = `done-${uid}`;
  const todoId = `todo-${uid}`;
  const checkerId = `checker-${uid}`;

  const p = clamp(progress, 0, 100);
  const tipArc = (p / 100) * COURSE.total;

  // which leg is the marker in, and where
  let active = COURSE.legs[0];
  for (const leg of COURSE.legs) if (tipArc >= leg.startArc - 0.001) active = leg;
  const tip = pointOnLeg(active, tipArc - active.startArc);

  const allPts = COURSE.legs.flatMap((l) => l.pts);
  const start = COURSE.legs[0].pts[0];
  const t1 = COURSE.legs[0].pts[COURSE.legs[0].pts.length - 1];
  const t2 = COURSE.legs[1].pts[COURSE.legs[1].pts.length - 1];
  const finish = COURSE.legs[2].pts[COURSE.legs[2].pts.length - 1];

  return (
    <svg viewBox="0 0 320 190" width={width} height={width * (190 / 320)} style={{ display: "block", overflow: "visible" }} aria-hidden>
      <defs>
        {/* finish-flag checker */}
        <pattern id={checkerId} width="6.4" height="6.4" patternUnits="userSpaceOnUse">
          <rect width="6.4" height="6.4" fill="var(--background)" />
          <rect width="3.2" height="3.2" fill="var(--text)" />
          <rect x="3.2" y="3.2" width="3.2" height="3.2" fill="var(--text)" />
        </pattern>
        {/* the marker splits the chart: everything left is "done", right is "todo" */}
        <clipPath id={doneId}>
          <rect x="0" y="0" width={r2(tip.x)} height="190" />
        </clipPath>
        <clipPath id={todoId}>
          <rect x={r2(tip.x)} y="0" width={r2(320 - tip.x)} height="190" />
        </clipPath>
      </defs>

      {/* upcoming portion — faint grey elevation base */}
      <g clipPath={`url(#${todoId})`}>
        <path d={areaD(allPts)} fill="var(--surface-2)" opacity={0.75} />
      </g>

      {/* completed portion — fills in with each leg's discipline colour, so the
          chart converts grey → colour as the marker sweeps across it. Per-leg
          opacity balances the tints perceptually (ochre/red wash out paler than
          blue at the same alpha). */}
      <g clipPath={`url(#${doneId})`}>
        {COURSE.legs.map((leg) => (
          <path key={`${leg.key}-fill`} d={areaD(leg.pts)} fill={leg.color} opacity={FILL_OPACITY[leg.key]} />
        ))}
      </g>

      {/* ghost of the full route — the whole journey, always visible */}
      <path d={pathD(allPts)} fill="none" stroke="var(--line)" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />

      {/* start + transition nodes */}
      <Node p={start} label="START" />
      <Node p={t1} label="T1" />
      <Node p={t2} label="T2" />

      {/* inked-in progress line: each leg colours in as the marker passes through */}
      {COURSE.legs.map((leg) => {
        const frac = clamp((tipArc - leg.startArc) / leg.len, 0, 1);
        if (frac <= 0) return null;
        return (
          <path
            key={leg.key}
            d={pathD(leg.pts)}
            fill="none"
            stroke={leg.color}
            strokeWidth={3.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={r2(leg.len)}
            strokeDashoffset={r2(leg.len * (1 - frac))}
          />
        );
      })}

      <FinishFlag p={finish} reduce={reduce} checkerId={checkerId} />

      {/* leg labels — the active one lights up in its colour */}
      {COURSE.legs.map((leg) => {
        const mid = leg.pts[Math.floor(leg.pts.length / 2)];
        const isActive = leg.key === active.key;
        return (
          <text
            key={`lbl-${leg.key}`}
            x={r2(mid.x)}
            y={182}
            textAnchor="middle"
            fontSize={8}
            fontWeight={700}
            letterSpacing={0.8}
            fill={isActive ? leg.color : "var(--text-faint)"}
            opacity={isActive ? 1 : 0.7}
          >
            {leg.label.toUpperCase()}
          </text>
        );
      })}

      {/* travelling marker at the inked tip */}
      <g>
        {!reduce && (
          <circle cx={r2(tip.x)} cy={r2(tip.y)} r={4} fill="none" stroke={active.color} strokeWidth={1.4}>
            <animate attributeName="r" values="4;11" dur="1.5s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.5;0" dur="1.5s" repeatCount="indefinite" />
          </circle>
        )}
        <circle cx={r2(tip.x)} cy={r2(tip.y)} r={4.4} fill={active.color} stroke="var(--background)" strokeWidth={1.6} />
        <circle cx={r2(tip.x)} cy={r2(tip.y)} r={1.5} fill="var(--background)" />
      </g>
    </svg>
  );
}
