import { Discipline, Level, PaceModel, Segment, SessionType, StrengthSplit, Zone } from "./types";
import { ZONES } from "./zones";

// ---------------------------------------------------------------------------
// Workout builders. Each returns a "draft" (no id/date yet); the plan engine
// stamps those on. Sessions are built from structured segments so the UI can
// render them richly and we can estimate duration + distance from zone speeds.
// ---------------------------------------------------------------------------

export interface BuildCtx {
  paces: PaceModel;
  level: Level;
}

export interface Draft {
  discipline: Discipline;
  type: SessionType;
  title: string;
  purpose: string;
  segments: Segment[];
  estDurationSec: number;
  estDistanceM?: number;
  primaryZone: Zone;
}

const M = (min: number) => Math.round(min * 60);

// ---- speed model (m/s) used for estimating duration<->distance -------------

const BIKE_KMH: Record<Level, number> = {
  beginner: 26,
  intermediate: 30,
  advanced: 33,
  elite: 36,
};
const BIKE_ZONE_FACTOR: Record<Zone, number> = { 1: 0.85, 2: 1, 3: 1.08, 4: 1.14, 5: 1.2 };

function speed(ctx: BuildCtx, disc: Discipline, zone: Zone): number {
  if (disc === "run") {
    const z = ctx.paces.run.zones[zone];
    const pace = (z.loSecPerKm + z.hiSecPerKm) / 2; // sec/km
    return 1000 / pace;
  }
  if (disc === "swim") {
    const z = ctx.paces.swim.zones[zone];
    const pace = (z.loSecPer100 + z.hiSecPer100) / 2; // sec/100m
    return 100 / pace;
  }
  if (disc === "bike") {
    const kmh = BIKE_KMH[ctx.level] * BIKE_ZONE_FACTOR[zone];
    return (kmh * 1000) / 3600;
  }
  return 0; // strength / rest
}

function measure(
  ctx: BuildCtx,
  segments: Segment[],
): { durationSec: number; distanceM: number } {
  let dur = 0;
  let dist = 0;
  for (const s of segments) {
    const reps = s.repeat ?? 1;
    if (s.children && s.children.length) {
      const inner = measure(ctx, s.children);
      dur += reps * inner.durationSec;
      dist += reps * inner.distanceM;
      continue;
    }
    const disc = s.discipline ?? "run";
    const zone = (s.zone ?? 2) as Zone;
    let sd = 0;
    let sdist = 0;
    if (s.durationSec != null) {
      sd = s.durationSec;
      sdist = s.kind === "rest" ? 0 : sd * speed(ctx, disc, zone);
    } else if (s.distanceM != null) {
      sdist = s.distanceM;
      const sp = speed(ctx, disc, zone);
      sd = sp > 0 ? s.distanceM / sp : 0;
    }
    dur += reps * sd;
    dist += reps * (s.kind === "rest" || disc === "strength" ? 0 : sdist);
  }
  return { durationSec: dur, distanceM: dist };
}

/** Sessions are prescribed on a 5-minute grid (#187). */
const GRID_SEC = 5 * 60;
/** Below this a session is short enough that 5-minute steps distort it. */
const GRID_MIN_SEC = 20 * 60;
/** Never move a session by more than this to reach the grid — the grid serves
 *  the prescription, not the other way round. */
const GRID_MAX_SHIFT_SEC = 3 * 60;

/**
 * Snap a session onto whole minutes the athlete can actually hold in their head.
 *
 * Ryan, #187: "don't tell me about a 47 minute run… make it round like 6 km runs,
 * 7 km run, why 5.7 you know". Measured before this existed, only 35% of
 * prescribed sessions landed on a 5-minute grid — the rest were 33, 39, 49, 71,
 * 97, 106. The difference between a 47 and a 45 minute ride is nothing
 * physiologically and everything in how the plan reads.
 *
 * The adjustment is made to a SEGMENT, never to the header, because the header is
 * derived from the segments — nudging it directly is exactly the
 * header-contradicts-its-steps bug this codebase keeps rediscovering. The longest
 * top-level steady block absorbs the difference; interval sets are left alone
 * because their reps are already round and shaving a rep changes the workout.
 *
 * Non-goals: nothing here forces a grid it can't reach honestly. A session with
 * no adjustable block, one under 20 minutes, or one that would have to move more
 * than 3 minutes keeps its real number.
 */
function snapToGrid(segments: Segment[], durationSec: number): Segment[] | null {
  if (durationSec < GRID_MIN_SEC) return null;
  const target = Math.round(durationSec / GRID_SEC) * GRID_SEC;
  const delta = target - durationSec;
  if (delta === 0 || Math.abs(delta) > GRID_MAX_SHIFT_SEC) return null;

  // Who absorbs the difference, in order of how little it matters:
  //
  //   1. the longest plain steady MAIN block — the endurance chunk, where three
  //      minutes is genuinely nothing
  //   2. failing that, the WARM-UP or COOL-DOWN
  //
  // The second tier is what makes interval sessions round. Every remaining
  // off-grid run and ride was a repeat set — "warm up, 4×(8min/3min), spin down"
  // — with no steady block at all, so the first rule found nothing and 63-minute
  // Hill Repeats stayed 63. Shaving a rep would change the workout; taking two
  // minutes off a 15-minute warm-up changes nothing at all.
  //
  // Repeat sets and their children are never touched, at either tier.
  const pick = (want: (s: Segment) => boolean): number => {
    let idx = -1;
    let sec = 0;
    segments.forEach((s, i) => {
      if (s.children?.length || (s.repeat ?? 1) > 1) return;
      if (s.durationSec == null || !want(s)) return;
      if (s.durationSec > sec) {
        sec = s.durationSec;
        idx = i;
      }
    });
    return idx;
  };

  let best = pick((s) => s.kind === "main");
  if (best < 0) best = pick((s) => s.kind === "warmup" || s.kind === "cooldown");
  if (best < 0) return null;
  const bestSec = segments[best].durationSec!;
  const nextSec = Math.round(bestSec + delta);
  // Floor applies whichever tier absorbed it: a 5-minute main block is thin, and
  // a warm-up under 5 minutes has stopped being a warm-up.
  if (nextSec < 5 * 60) return null;

  return segments.map((s, i) =>
    i === best
      ? {
          ...s,
          durationSec: nextSec,
          // The description carries the old minutes; regenerate the count so the
          // step never advertises a different length from the one it now is.
          description: s.description.replace(/^\d+\s*min/, `${Math.round(nextSec / 60)} min`),
        }
      : s,
  );
}

function finish(
  ctx: BuildCtx,
  draft: Omit<Draft, "estDurationSec" | "estDistanceM">,
): Draft {
  const first = measure(ctx, draft.segments);
  const snapped = snapToGrid(draft.segments, first.durationSec);
  const segments = snapped ?? draft.segments;
  // Re-measure from the segments that will actually ship, so duration AND the
  // derived distance both describe the same session.
  const { durationSec, distanceM } = snapped ? measure(ctx, segments) : first;
  const isDist = draft.discipline !== "strength";
  return {
    ...draft,
    segments,
    estDurationSec: Math.round(durationSec),
    estDistanceM: isDist ? Math.round(distanceM) : undefined,
  };
}

function seg(s: Segment): Segment {
  return s;
}
const zn = (z: Zone) => `${ZONES[z].name} (Z${z})`;

// ===========================================================================
// SWIM
// ===========================================================================

function swimWU(m: number): Segment {
  return seg({
    kind: "warmup",
    discipline: "swim",
    zone: 2,
    distanceM: m,
    description: `${m}m easy free — mix in some backstroke`,
    cue: "Long, relaxed strokes. Wake the shoulders up gradually.",
  });
}
function swimCD(m: number): Segment {
  return seg({
    kind: "cooldown",
    discipline: "swim",
    zone: 1,
    distanceM: m,
    description: `${m}m easy choice — loosen down`,
  });
}

export function swimTechnique(ctx: BuildCtx): Draft {
  return finish(ctx, {
    discipline: "swim",
    type: "technique",
    title: "Technique & Drills",
    purpose: "Cheap speed lives in your stroke — better catch and body position lower the effort of every length you'll ever swim.",
    primaryZone: 2,
    segments: [
      swimWU(300),
      seg({
        kind: "main",
        discipline: "swim",
        zone: 2,
        repeat: 4,
        description: "4 × 50m drill / swim by 25m (15s rest)",
        cue: "Rotate drills: catch-up, single-arm, fingertip-drag, 6-3-6.",
        children: [
          seg({ kind: "main", discipline: "swim", zone: 2, distanceM: 50, description: "50m drill→swim" }),
          seg({ kind: "rest", discipline: "swim", durationSec: 15, description: "15s rest" }),
        ],
      }),
      seg({
        kind: "main",
        discipline: "swim",
        zone: 3,
        repeat: 8,
        description: "8 × 50m @ Tempo, hold stroke count (15s rest)",
        cue: "Count strokes per length and keep it steady as you fatigue.",
        children: [
          seg({ kind: "main", discipline: "swim", zone: 3, distanceM: 50, description: "50m steady" }),
          seg({ kind: "rest", discipline: "swim", durationSec: 15, description: "15s rest" }),
        ],
      }),
      seg({
        kind: "main",
        discipline: "swim",
        zone: 2,
        repeat: 4,
        description: "4 × 100m pull, buoy (20s rest)",
        children: [
          seg({ kind: "main", discipline: "swim", zone: 2, distanceM: 100, description: "100m pull" }),
          seg({ kind: "rest", discipline: "swim", durationSec: 20, description: "20s rest" }),
        ],
      }),
      swimCD(200),
    ],
  });
}

export function swimEndurance(ctx: BuildCtx, mainM = 1200): Draft {
  const setM = Math.max(400, Math.round(mainM / 3 / 100) * 100);
  return finish(ctx, {
    discipline: "swim",
    type: "endurance",
    title: "Aerobic Endurance Swim",
    purpose: "Steady aerobic volume builds the engine that carries your whole race — most of your swim fitness is built right here.",
    primaryZone: 2,
    segments: [
      swimWU(300),
      seg({
        kind: "main",
        discipline: "swim",
        zone: 2,
        repeat: 3,
        description: `3 × ${setM}m @ Endurance (CSS+6s, 30s rest)`,
        cue: "Smooth and continuous — you should be able to hold a rhythm all day.",
        children: [
          seg({ kind: "main", discipline: "swim", zone: 2, distanceM: setM, description: `${setM}m steady` }),
          seg({ kind: "rest", discipline: "swim", durationSec: 30, description: "30s rest" }),
        ],
      }),
      swimCD(200),
    ],
  });
}

export function swimThreshold(ctx: BuildCtx): Draft {
  return finish(ctx, {
    discipline: "swim",
    type: "threshold",
    title: "CSS Threshold Set",
    purpose: "Raising your Critical Swim Speed is the single biggest lever on your swim split — the pace you can hold without blowing up.",
    primaryZone: 4,
    segments: [
      swimWU(300),
      seg({
        kind: "warmup",
        discipline: "swim",
        zone: 4,
        repeat: 4,
        description: "4 × 50m build to CSS (15s rest)",
        children: [
          seg({ kind: "warmup", discipline: "swim", zone: 4, distanceM: 50, description: "50m build" }),
          seg({ kind: "rest", discipline: "swim", durationSec: 15, description: "15s rest" }),
        ],
      }),
      seg({
        kind: "main",
        discipline: "swim",
        zone: 4,
        repeat: 6,
        description: "6 × 100m @ CSS (15s rest)",
        cue: "Comfortably hard, strong, repeatable — not a sprint. Hold your line.",
        children: [
          seg({ kind: "main", discipline: "swim", zone: 4, distanceM: 100, description: "100m @ CSS" }),
          seg({ kind: "rest", discipline: "swim", durationSec: 15, description: "15s rest" }),
        ],
      }),
      seg({
        kind: "main",
        discipline: "swim",
        zone: 3,
        repeat: 4,
        description: "4 × 200m @ CSS+3s, pull (25s rest)",
        children: [
          seg({ kind: "main", discipline: "swim", zone: 3, distanceM: 200, description: "200m aerobic" }),
          seg({ kind: "rest", discipline: "swim", durationSec: 25, description: "25s rest" }),
        ],
      }),
      swimCD(200),
    ],
  });
}

export function swimVO2(ctx: BuildCtx): Draft {
  return finish(ctx, {
    discipline: "swim",
    type: "vo2",
    title: "Swim Speed — VO2",
    purpose: "Short, fast repeats sharpen your top-end and make CSS pace feel easy by comparison.",
    primaryZone: 5,
    segments: [
      swimWU(400),
      seg({
        kind: "main",
        discipline: "swim",
        zone: 5,
        repeat: 12,
        description: "12 × 50m @ CSS−4s (20s rest)",
        cue: "Fast but controlled — great technique at speed, not thrashing.",
        children: [
          seg({ kind: "main", discipline: "swim", zone: 5, distanceM: 50, description: "50m fast" }),
          seg({ kind: "rest", discipline: "swim", durationSec: 20, description: "20s rest" }),
        ],
      }),
      swimCD(300),
    ],
  });
}

export function swimOpenWater(ctx: BuildCtx): Draft {
  return finish(ctx, {
    discipline: "swim",
    type: "race_prep",
    title: "Open-Water Skills",
    purpose: "Race day isn't a black line on the pool floor — sighting and pack swimming are skills you have to rehearse.",
    primaryZone: 3,
    segments: [
      swimWU(400),
      seg({
        kind: "main",
        discipline: "swim",
        zone: 3,
        repeat: 4,
        description: "4 × 200m @ race effort, sight every 6 strokes (20s rest)",
        cue: "Lift the eyes forward, don't lift the head — keep hips high.",
        children: [
          seg({ kind: "main", discipline: "swim", zone: 3, distanceM: 200, description: "200m + sighting" }),
          seg({ kind: "rest", discipline: "swim", durationSec: 20, description: "20s rest" }),
        ],
      }),
      seg({ kind: "main", discipline: "swim", zone: 2, distanceM: 200, description: "200m no-wall turns / continuous" }),
      swimCD(200),
    ],
  });
}

export function swimRecovery(ctx: BuildCtx, m = 900): Draft {
  return finish(ctx, {
    discipline: "swim",
    type: "recovery",
    title: "Recovery Swim",
    purpose: "Easy water time flushes the legs and keeps your feel for the water without adding fatigue.",
    primaryZone: 1,
    segments: [
      swimWU(200),
      seg({ kind: "main", discipline: "swim", zone: 1, distanceM: Math.max(300, m - 400), description: `${Math.max(300, m - 400)}m easy, mixed strokes` }),
      swimCD(200),
    ],
  });
}

// ===========================================================================
// BIKE
// ===========================================================================

function bikeWU(min: number): Segment {
  return seg({ kind: "warmup", discipline: "bike", zone: 2, durationSec: M(min), description: `${min} min progressive spin-up`, cue: "Cadence 85–95, ease into it." });
}
function bikeCD(min: number): Segment {
  return seg({ kind: "cooldown", discipline: "bike", zone: 1, durationSec: M(min), description: `${min} min easy spin` });
}

export function bikeEndurance(ctx: BuildCtx, min = 60): Draft {
  const main = Math.max(20, min - 15);
  return finish(ctx, {
    discipline: "bike",
    type: "endurance",
    title: "Aerobic Endurance Ride",
    purpose: "Time in Zone 2 builds the aerobic engine and fat-burning that let you ride strong for hours — the foundation of the whole sport.",
    primaryZone: 2,
    segments: [
      bikeWU(10),
      seg({ kind: "main", discipline: "bike", zone: 2, durationSec: M(main), description: `${main} min @ ${zn(2)} — steady, cadence 85–95`, cue: "Conversational. If you can't talk, you're going too hard." }),
      bikeCD(5),
    ],
  });
}

/**
 * Sweet spot — 88–94% FTP.
 *
 * Zoned Z4, not Z3. The band straddles our Z3 (76–90%) and Z4 (91–105%), so
 * either label is an approximation; Z4 is the *safe* approximation, because the
 * zone is what injury caps, hard-day spacing and load estimation all read. Under
 * the old Z3 label a niggle (`capZone: 3`) routed here and the athlete got
 * near-threshold work from a cap that existed to prevent exactly that.
 *
 * The work intervals carry an explicit `ftpPct` so the athlete still sees the true
 * 88–94%, not Z4's 91–105%.
 */
export function bikeSweetSpot(ctx: BuildCtx, min = 75): Draft {
  const reps = min >= 80 ? 4 : 3;
  return finish(ctx, {
    discipline: "bike",
    type: "tempo",
    title: `Sweet Spot ${reps}×8`,
    purpose: "Sweet spot gives ~90% of the threshold benefit at a fraction of the fatigue — the most time-efficient way to raise your FTP.",
    primaryZone: 4,
    segments: [
      bikeWU(15),
      seg({
        kind: "main",
        discipline: "bike",
        zone: 4,
        ftpPct: [88, 94],
        repeat: reps,
        description: `${reps} × (8 min @ 88–94% FTP / 3 min easy)`,
        cue: "Settle in — don't launch it. Aim for a flat power line, not a fade.",
        children: [
          seg({ kind: "main", discipline: "bike", zone: 4, ftpPct: [88, 94], durationSec: M(8), description: "8 min sweet spot" }),
          seg({ kind: "main", discipline: "bike", zone: 1, durationSec: M(3), description: "3 min easy" }),
        ],
      }),
      bikeCD(10),
    ],
  });
}

/**
 * Bike tempo — genuinely inside Z3 (76–90% FTP).
 *
 * This is what a zone-3-capped athlete gets. It exists because the only sub-threshold
 * bike quality session used to be sweet spot, which is 88–94% — so honouring a niggle's
 * `capZone: 3` meant prescribing work *above* the cap. Sustained blocks rather than
 * short reps: at tempo the point is time at effort, not repeatability.
 */
export function bikeTempo(ctx: BuildCtx, min = 70): Draft {
  const reps = min >= 75 ? 3 : 2;
  const block = min >= 75 ? 12 : 10;
  return finish(ctx, {
    discipline: "bike",
    type: "tempo",
    title: `Bike Tempo ${reps}×${block}`,
    purpose: "Sustained tempo builds muscular endurance and the ability to hold a strong, steady effort — without the tissue stress of threshold work.",
    primaryZone: 3,
    segments: [
      bikeWU(12),
      seg({
        kind: "main",
        discipline: "bike",
        zone: 3,
        repeat: reps,
        description: `${reps} × (${block} min @ ${zn(3)} / 4 min easy)`,
        cue: "Comfortably hard and repeatable. If it starts to sting, you're above tempo.",
        children: [
          seg({ kind: "main", discipline: "bike", zone: 3, durationSec: M(block), description: `${block} min tempo` }),
          seg({ kind: "main", discipline: "bike", zone: 1, durationSec: M(4), description: "4 min easy" }),
        ],
      }),
      bikeCD(8),
    ],
  });
}

export function bikeThreshold(ctx: BuildCtx, min = 70): Draft {
  const reps = min >= 75 ? 4 : 3;
  return finish(ctx, {
    discipline: "bike",
    type: "threshold",
    title: `Bike Threshold ${reps}×10`,
    purpose: "Threshold intervals lift the power you can hold for an hour — a faster bike split that leaves more in the legs for the run.",
    primaryZone: 4,
    segments: [
      bikeWU(15),
      seg({
        kind: "main",
        discipline: "bike",
        zone: 4,
        repeat: reps,
        description: `${reps} × (10 min @ 95–105% FTP / 5 min easy)`,
        cue: "Hold a steady, strong effort. The last rep should match the first.",
        children: [
          seg({ kind: "main", discipline: "bike", zone: 4, durationSec: M(10), description: "10 min @ threshold" }),
          seg({ kind: "main", discipline: "bike", zone: 1, durationSec: M(5), description: "5 min recovery" }),
        ],
      }),
      bikeCD(10),
    ],
  });
}

export function bikeVO2(ctx: BuildCtx, min = 60): Draft {
  return finish(ctx, {
    discipline: "bike",
    type: "vo2",
    title: "Bike VO2 5×3",
    purpose: "VO2 intervals raise your aerobic ceiling — hard now so everything below it feels easier on race day.",
    primaryZone: 5,
    segments: [
      bikeWU(15),
      seg({
        kind: "main",
        discipline: "bike",
        zone: 5,
        repeat: 5,
        description: "5 × (3 min @ 110–120% FTP / 3 min easy)",
        cue: "Full-gas but repeatable. Spin, don't grind — cadence 95+.",
        children: [
          seg({ kind: "main", discipline: "bike", zone: 5, durationSec: M(3), description: "3 min VO2" }),
          seg({ kind: "main", discipline: "bike", zone: 1, durationSec: M(3), description: "3 min easy" }),
        ],
      }),
      bikeCD(10),
    ],
  });
}

export function bikeLong(ctx: BuildCtx, min = 120, withRacePace = false): Draft {
  const main = Math.max(40, min - 20);
  const segs: Segment[] = [bikeWU(12)];
  if (withRacePace) {
    const rp = Math.min(30, Math.round(main * 0.25));
    segs.push(seg({ kind: "main", discipline: "bike", zone: 2, durationSec: M(main - rp), description: `${main - rp} min @ ${zn(2)} endurance` }));
    segs.push(seg({ kind: "main", discipline: "bike", zone: 3, durationSec: M(rp), description: `${rp} min @ race effort — finish strong`, cue: "Rehearse your target race pace and your fueling." }));
  } else {
    segs.push(seg({ kind: "main", discipline: "bike", zone: 2, durationSec: M(main), description: `${main} min @ ${zn(2)} — steady endurance`, cue: "Fuel every 30–40 min. This is where durability is made." }));
  }
  segs.push(bikeCD(8));
  return finish(ctx, {
    discipline: "bike",
    type: "long",
    title: withRacePace ? "Long Ride + Race Effort" : "Long Endurance Ride",
    purpose: "The weekly long ride is your durability builder — teaching body and mind to keep producing power deep into fatigue.",
    primaryZone: 2,
    segments: segs,
  });
}

export function bikeRecovery(ctx: BuildCtx, min = 40): Draft {
  return finish(ctx, {
    discipline: "bike",
    type: "recovery",
    title: "Recovery Spin",
    purpose: "Light, high-cadence spinning moves blood through tired legs and speeds recovery — keep it genuinely easy.",
    primaryZone: 1,
    segments: [seg({ kind: "main", discipline: "bike", zone: 1, durationSec: M(min), description: `${min} min @ <60% FTP, cadence 90+`, cue: "No efforts. If in doubt, go easier." })],
  });
}

// ===========================================================================
// RUN
// ===========================================================================

function runWU(min: number): Segment {
  return seg({ kind: "warmup", discipline: "run", zone: 2, durationSec: M(min), description: `${min} min easy jog`, cue: "Loose and relaxed — let the pace come to you." });
}
function runCD(min: number): Segment {
  return seg({ kind: "cooldown", discipline: "run", zone: 1, durationSec: M(min), description: `${min} min easy jog to finish` });
}
function strides(): Segment {
  return seg({
    kind: "warmup",
    discipline: "run",
    zone: 5,
    repeat: 4,
    description: "4 × 20s strides (walk-back recovery)",
    cue: "Quick, smooth turnover — neuromuscular, not a workout.",
    children: [
      seg({ kind: "warmup", discipline: "run", zone: 5, durationSec: 20, description: "20s stride" }),
      seg({ kind: "rest", discipline: "run", durationSec: 40, description: "walk back" }),
    ],
  });
}

export function runEasy(ctx: BuildCtx, min = 40): Draft {
  return finish(ctx, {
    discipline: "run",
    type: "endurance",
    title: "Easy Aerobic Run",
    purpose: "Easy running is where aerobic fitness is quietly built and injury risk stays low — resist the urge to push it.",
    primaryZone: 2,
    segments: [
      seg({ kind: "main", discipline: "run", zone: 2, durationSec: M(min), description: `${min} min @ ${zn(2)} easy`, cue: "Nose-breathing easy. You should finish feeling you could go again." }),
    ],
  });
}

export function runLong(ctx: BuildCtx, min = 75, withRacePace = false): Draft {
  const segs: Segment[] = [runWU(10)];
  if (withRacePace) {
    const rp = Math.min(25, Math.round(min * 0.25));
    segs.push(seg({ kind: "main", discipline: "run", zone: 2, durationSec: M(min - 10 - rp - 5), description: `${min - 10 - rp - 5} min @ ${zn(2)}` }));
    segs.push(seg({ kind: "main", discipline: "run", zone: 3, durationSec: M(rp), description: `${rp} min @ steady race effort to finish`, cue: "Controlled progression — strong, not straining." }));
  } else {
    segs.push(seg({ kind: "main", discipline: "run", zone: 2, durationSec: M(min - 15), description: `${min - 15} min @ ${zn(2)} steady`, cue: "Time on feet is the goal. Fuel and hydrate like race day." }));
  }
  segs.push(runCD(5));
  return finish(ctx, {
    discipline: "run",
    type: "long",
    title: withRacePace ? "Long Run + Finish Strong" : "Long Endurance Run",
    purpose: "The long run builds the fatigue-resistance that decides your race — especially the run off the bike.",
    primaryZone: 2,
    segments: segs,
  });
}

export function runTempo(ctx: BuildCtx, min = 50): Draft {
  const tempo = Math.min(25, Math.max(15, min - 25));
  return finish(ctx, {
    discipline: "run",
    type: "tempo",
    title: "Tempo Run",
    purpose: "Tempo running trains 'comfortably hard' — exactly the sustained effort long-course racing demands.",
    primaryZone: 3,
    segments: [
      runWU(15),
      seg({ kind: "main", discipline: "run", zone: 3, durationSec: M(tempo), description: `${tempo} min @ ${zn(3)} tempo`, cue: "Controlled discomfort — you could speak a sentence, not a paragraph." }),
      runCD(10),
    ],
  });
}

export function runThreshold(ctx: BuildCtx, min = 55): Draft {
  const reps = min >= 55 ? 5 : 4;
  return finish(ctx, {
    discipline: "run",
    type: "threshold",
    title: `Run Threshold ${reps}×1km`,
    purpose: "Threshold reps raise the pace you can hold before your legs flood — the ceiling on your run speed.",
    primaryZone: 4,
    segments: [
      runWU(15),
      strides(),
      seg({
        kind: "main",
        discipline: "run",
        zone: 4,
        repeat: reps,
        description: `${reps} × (1 km @ ${zn(4)} / 90s jog)`,
        cue: "Even splits. If you're fading, you started too fast.",
        children: [
          seg({ kind: "main", discipline: "run", zone: 4, distanceM: 1000, description: "1 km @ threshold" }),
          seg({ kind: "rest", discipline: "run", durationSec: 90, description: "90s jog" }),
        ],
      }),
      runCD(10),
    ],
  });
}

export function runVO2(ctx: BuildCtx, min = 50): Draft {
  return finish(ctx, {
    discipline: "run",
    type: "vo2",
    title: "Run VO2 6×3",
    purpose: "Fast intervals lift your VO2 max and running economy — the sharp end of speed.",
    primaryZone: 5,
    segments: [
      runWU(15),
      strides(),
      seg({
        kind: "main",
        discipline: "run",
        zone: 5,
        repeat: 6,
        description: "6 × (3 min @ ~5k pace / 2 min jog)",
        cue: "Strong and smooth. Hard effort, controlled form.",
        children: [
          seg({ kind: "main", discipline: "run", zone: 5, durationSec: M(3), description: "3 min hard" }),
          seg({ kind: "rest", discipline: "run", durationSec: M(2), description: "2 min jog" }),
        ],
      }),
      runCD(8),
    ],
  });
}

export function runRecovery(ctx: BuildCtx, min = 30): Draft {
  return finish(ctx, {
    discipline: "run",
    type: "recovery",
    title: "Recovery Jog",
    purpose: "A gentle jog keeps the legs turning over and blood flowing without adding real stress.",
    primaryZone: 1,
    segments: [seg({ kind: "main", discipline: "run", zone: 1, durationSec: M(min), description: `${min} min @ ${zn(1)} very easy`, cue: "Slower than feels natural. This is not a training run." })],
  });
}

// ===========================================================================
// BRICK
// ===========================================================================

export function brick(ctx: BuildCtx, bikeMin = 40, runMin = 15, racePace = false): Draft {
  return finish(ctx, {
    discipline: "brick",
    type: "brick",
    title: "Brick — Find Your Run Legs",
    purpose: "The first minutes off the bike feel awful for everyone. Practicing it is exactly why it won't rattle you on race day.",
    primaryZone: 3,
    segments: [
      seg({ kind: "warmup", discipline: "bike", zone: 2, durationSec: M(10), description: "10 min easy spin-up" }),
      seg({ kind: "main", discipline: "bike", zone: racePace ? 3 : 2, durationSec: M(bikeMin - 10), description: `${bikeMin - 10} min bike @ ${racePace ? "race effort" : zn(2)}`, cue: "Keep the bike honest but not heroic — save it for the run." }),
      seg({ kind: "main", discipline: "run", zone: 3, durationSec: M(2), description: "⚡ T2 — rack bike, swap shoes, go (under 3 min)", cue: "Practice a fast, calm transition like race day." }),
      seg({ kind: "main", discipline: "run", zone: 3, durationSec: M(runMin), description: `${runMin} min run, build easy → race pace`, cue: "Start deliberately short-strided. Heaviness lifts by minute 8 — note how long yours takes." }),
      seg({ kind: "cooldown", discipline: "run", zone: 1, durationSec: M(4), description: "4 min walk/jog down" }),
    ],
  });
}

// ===========================================================================
// STRENGTH
// ===========================================================================

// A generic gym session: dynamic-mobility warm-up, a repeated circuit, mobility
// cool-down. `min` sets the number of rounds so recovery weeks run lighter.
function gym(
  ctx: BuildCtx,
  title: string,
  purpose: string,
  circuit: string,
  min: number,
  cue = "Leave 1–2 reps in reserve. Control the movement, own each rep.",
): Draft {
  const rounds = min >= 35 ? 3 : 2;
  return finish(ctx, {
    discipline: "strength",
    type: "strength",
    title,
    purpose,
    primaryZone: 3,
    segments: [
      seg({ kind: "warmup", discipline: "strength", zone: 2, durationSec: M(8), description: "8 min dynamic mobility — leg swings, hip openers, band walks" }),
      seg({
        kind: "main",
        discipline: "strength",
        zone: 3,
        repeat: rounds,
        description: `${rounds} rounds: ${circuit}`,
        cue,
        children: [
          seg({ kind: "main", discipline: "strength", zone: 3, durationSec: M(6), description: "circuit round" }),
          seg({ kind: "rest", discipline: "strength", durationSec: M(1.5), description: "90s rest" }),
        ],
      }),
      seg({ kind: "cooldown", discipline: "strength", zone: 1, durationSec: M(5), description: "5 min mobility — calves, hips, T-spine" }),
    ],
  });
}

export function strength(ctx: BuildCtx, min = 35): Draft {
  return gym(
    ctx,
    "Full-Body Strength Circuit",
    "In-season strength keeps you durable and powerful — it protects against injury and holds form when fatigue sets in.",
    "goblet squat ×12 · RDL ×12 · step-up ×10/side · push-up ×12 · plank 45s · side plank 30s/side",
    min,
  );
}

export function strengthLower(ctx: BuildCtx, min = 35): Draft {
  return gym(
    ctx,
    "Lower-Body Strength",
    "Strong legs and hips hold your form deep into the bike and run — the antidote to the late-race fade.",
    "back/goblet squat ×8 · Romanian deadlift ×10 · walking lunge ×10/side · single-leg calf raise ×15 · glute bridge ×12",
    min,
  );
}

export function strengthUpper(ctx: BuildCtx, min = 35): Draft {
  return gym(
    ctx,
    "Upper-Body & Core Strength",
    "A resilient upper body and trunk keep your stroke powerful and your posture honest when fatigue sets in.",
    "push-up ×12 · single-arm row ×12/side · overhead press ×10 · band pull-apart ×15 · front plank 45s",
    min,
  );
}

export function strengthPush(ctx: BuildCtx, min = 35): Draft {
  return gym(
    ctx,
    "Push Strength",
    "Pressing strength builds the durable chest, shoulders and triceps that protect your posture on long days.",
    "push-up ×12 · overhead press ×10 · dips ×10 · incline press ×12 · triceps extension ×12",
    min,
  );
}

export function strengthPull(ctx: BuildCtx, min = 35): Draft {
  return gym(
    ctx,
    "Pull Strength",
    "A strong back and pulling chain power your swim catch and keep your shoulders balanced and injury-free.",
    "single-arm row ×12/side · lat pulldown or pull-up ×8 · face pull ×15 · biceps curl ×12 · rear-delt fly ×15",
    min,
  );
}

export function strengthLegs(ctx: BuildCtx, min = 35): Draft {
  return gym(
    ctx,
    "Leg Strength",
    "Leg day is where cycling power and running durability are forged — the base of a strong finish.",
    "squat ×10 · Romanian deadlift ×10 · split squat ×10/side · step-up ×10/side · calf raise ×15",
    min,
  );
}

export function strengthCore(ctx: BuildCtx, min = 25): Draft {
  return gym(
    ctx,
    "Core & Mobility",
    "A stable core transfers power between all three disciplines and protects your back over long sessions.",
    "dead bug ×10/side · front plank 45s · side plank 30s/side · bird-dog ×10/side · pallof press ×12/side · hollow hold 30s",
    min,
    "Move slowly and breathe — quality of bracing beats speed.",
  );
}

// No-gym fallback: full-body strength you can do at home with just bodyweight + a band.
export function strengthHome(ctx: BuildCtx, min = 35): Draft {
  return gym(
    ctx,
    "Home Strength (Bodyweight)",
    "No gym needed — bodyweight and a band keep you durable and powerful right at home.",
    "squat ×15 · reverse lunge ×12/side · push-up ×12 · single-leg glute bridge ×12/side · superman ×12 · plank 45s · side plank 30s/side",
    min,
  );
}

// The athlete brings their own resistance plan — we reserve the time and keep it
// clear of their hardest swim/bike/run days, but leave the session itself to them.
export function strengthCustom(ctx: BuildCtx, min = 35, note?: string): Draft {
  const own = note?.trim();
  return finish(ctx, {
    discipline: "strength",
    type: "strength",
    title: "Your Strength Session",
    purpose: "Your own resistance plan — we've reserved the time and slotted it clear of your hardest swim, bike and run days.",
    primaryZone: 3,
    segments: [
      seg({ kind: "warmup", discipline: "strength", zone: 2, durationSec: M(8), description: "8 min dynamic mobility — leg swings, hip openers, band walks" }),
      seg({
        kind: "main",
        discipline: "strength",
        zone: 3,
        durationSec: M(Math.max(15, min - 13)),
        description: own ? own : "Your planned strength work",
        cue: "Run your own session — leave 1–2 reps in reserve and keep your form honest.",
      }),
      seg({ kind: "cooldown", discipline: "strength", zone: 1, durationSec: M(5), description: "5 min mobility — calves, hips, T-spine" }),
    ],
  });
}

// Dispatch to the right session for the athlete's chosen split + which strength
// day of the week this is. Recovery weeks fall back to core/mobility; no gym
// falls back to the bodyweight home circuit. A "custom" split is honored as-is.
export function strengthFor(
  ctx: BuildCtx,
  split: StrengthSplit,
  index: number,
  recover: boolean,
  home = false,
  note?: string,
): Draft {
  const min = recover ? 25 : 35;
  if (recover || split === "core") return strengthCore(ctx, min);
  if (split === "custom") return strengthCustom(ctx, min, note);
  if (home) return strengthHome(ctx, min);
  switch (split) {
    case "upper-lower":
      return index % 2 === 0 ? strengthLower(ctx, min) : strengthUpper(ctx, min);
    case "push-pull-legs": {
      const m = index % 3;
      return m === 0 ? strengthPush(ctx, min) : m === 1 ? strengthPull(ctx, min) : strengthLegs(ctx, min);
    }
    case "full":
    default:
      return strength(ctx, min);
  }
}

// No-pool fallback: land-based swim-specific strength so the swim engine keeps
// firing without water. Credited to swim; time-based so it carries no fake distance.
export function swimDryland(ctx: BuildCtx, min = 30): Draft {
  const rounds = min >= 30 ? 3 : 2;
  return finish(ctx, {
    discipline: "swim",
    type: "technique",
    title: "Dryland Swim Strength",
    purpose: "No pool? Keep your swim engine firing on land — cords, scapular strength and catch mechanics carry straight back into the water.",
    primaryZone: 2,
    segments: [
      seg({ kind: "warmup", discipline: "strength", zone: 2, durationSec: M(6), description: "6 min shoulder prep — band dislocates, scap push-ups, T-Y-W raises" }),
      seg({
        kind: "main",
        discipline: "strength",
        zone: 3,
        repeat: rounds,
        description: `${rounds} rounds: swim-cord catch-pull ×20 · band tricep press ×15 · scap pull-up hold 20s · prone Y-raise ×12 · dead bug ×10/side`,
        cue: "Mimic the catch — high elbow, press the water back, not down.",
        children: [
          seg({ kind: "main", discipline: "strength", zone: 3, durationSec: M(5), description: "circuit round" }),
          seg({ kind: "rest", discipline: "strength", durationSec: M(1), description: "60s rest" }),
        ],
      }),
      seg({ kind: "cooldown", discipline: "strength", zone: 1, durationSec: M(4), description: "4 min stretch — lats, pecs, thoracic" }),
    ],
  });
}
