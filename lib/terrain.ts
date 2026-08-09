// ---------------------------------------------------------------------------
// Course profile — training for the race you actually entered.
//
// Every race in the catalog already carried a `terrain` (flat | rolling | hilly
// | mountainous) and nothing read it. An athlete riding IRONMAN Canada — 1,200 m
// of climbing out of Penticton — got the same plan as someone racing pancake-flat
// Chicago, and the same predicted finish time. That is the whole of ticket #85.
//
// WHAT THIS DOES, AND DELIBERATELY DOESN'T
//
// Terrain changes the MODALITY of quality work, not its dose. A hill repeat at
// threshold is threshold work: same zone, same duration, same session type, same
// place in the week. Only the title, the purpose and the segment prescriptions
// change — you're told to hold the effort up a climb instead of on the flat.
//
// That is not a shortcut, it's the point:
//   - the PMC is untouched, because sessionLoad reads zone × minutes
//   - the safety rails are untouched, because intensity share and weekly hours
//     are identical to the terrain-neutral plan
//   - no periodization decision moves, because the slot was already chosen
// so terrain-awareness cannot smuggle in a load change under cover of realism.
// If hilly races should carry MORE load than flat ones, that is a separate
// argument and belongs in the engine, not here.
//
// One real thing is left on the table, and it is named rather than hidden:
// sustained downhill running is eccentric work and carries more mechanical
// (bone/tendon) cost per minute than the same minutes on the flat. `mechanical.ts`
// prices impact per minute with no terrain term, so a hill run and a flat run
// look identical to the impact ramp. Adding one would move a SAFETY rail, so it
// is not being done silently as part of a training-content ticket.
//
// PROVENANCE. Doc 01 (exercise physiology) had no terrain guidance at all when
// this was written — the §4 rules cover phase, zones, taper and long-session
// structure, and say nothing about course profile. Ryan's call (2026-08-09) was
// that terrain guidance is valid and part of the training, so this ships and doc
// 01 gains a §4 rule rather than the code pretending the realm doesn't exist.
// The time factors below are reasoned from climbing's basic asymmetry (you spend
// far longer going up than coming down, so elevation always costs net time), not
// taken from a source. They are deliberately modest.
//
// Pure — no clock, no I/O.
// ---------------------------------------------------------------------------

import type { Profile, Segment, Terrain, Workout } from "./types";

export type { Terrain };

/**
 * What a race is assumed to be when nobody said.
 *
 * "rolling", not "flat": most real courses have some elevation, and assuming
 * flat would quietly promise a finish time no one can hit on a normal course.
 * Athletes who pick a catalog race get the real value; everyone else gets the
 * honest middle and can change it in Settings → Your race.
 */
export const DEFAULT_TERRAIN: Terrain = "rolling";

export const TERRAIN_ORDER: Terrain[] = ["flat", "rolling", "hilly", "mountainous"];

export function terrainOf(p: Profile): Terrain {
  return p.terrain ?? DEFAULT_TERRAIN;
}

/**
 * Race-time cost of the course, as a multiplier on the flat-course split.
 *
 * The baseline is FLAT: `RACE_BIKE_KMH` and the pace model are both flat-course
 * numbers (see the TYPICAL_FTP note in planEngine). Climbing costs net time even
 * when the descent gives some back — you spend far longer going up than coming
 * down, so the average speed over a rolling course is below the flat-course
 * average even for identical power.
 *
 * The bike pays more than the run because aerodynamic drag makes cycling speed
 * extremely sensitive to gradient, while running speed is closer to linear in
 * effort. The swim is unaffected — a lake doesn't have hills.
 *
 * Reasoned, not sourced. Kept modest on purpose: a wrong prediction that is
 * slightly pessimistic costs an athlete nothing, and these move the estimate by
 * minutes, not by a different race.
 */
export const TERRAIN_TIME_FACTOR: Record<Terrain, { bike: number; run: number }> = {
  flat: { bike: 1.0, run: 1.0 },
  rolling: { bike: 1.03, run: 1.02 },
  hilly: { bike: 1.08, run: 1.05 },
  mountainous: { bike: 1.15, run: 1.09 },
};

/**
 * How many of a week's quality sessions become hill work.
 *
 * Flat races get none — there is nothing to prepare for, and a flat-course
 * athlete's time is better spent holding an aero position than climbing.
 *
 * Rolling is capped at one deliberately, BECAUSE it is the default: an athlete
 * who never picked a catalog race should not have their plan quietly
 * restructured by an assumption. One hill session a week is ordinary coaching.
 */
export const HILL_SESSIONS_PER_WEEK: Record<Terrain, number> = {
  flat: 0,
  rolling: 1,
  hilly: 2,
  mountainous: 3,
};

/** Terrain steep enough that the long sessions should rehearse it too. */
export function longSessionsClimb(t: Terrain): boolean {
  return t === "hilly" || t === "mountainous";
}

export function terrainLabel(t: Terrain): string {
  return t === "flat" ? "Flat" : t === "rolling" ? "Rolling" : t === "hilly" ? "Hilly" : "Mountainous";
}

export function terrainBlurb(t: Terrain): string {
  return t === "flat"
    ? "Fast and level — no real climbing"
    : t === "rolling"
    ? "Some short climbs, nothing sustained"
    : t === "hilly"
    ? "Sustained climbing you'll feel"
    : "Big elevation — the course is the challenge";
}

// ---------------------------------------------------------------------------
// Race-day pacing
// ---------------------------------------------------------------------------

/**
 * The single most useful thing to say to someone about a hilly course, which is
 * also the thing they most reliably get wrong: effort, not pace. Riding a climb
 * to your flat power target is how you arrive at T2 with nothing left.
 *
 * null for flat — there is no advice to give, and inventing some would train
 * athletes to ignore this line on the courses where it matters.
 */
export function pacingNote(t: Terrain): string | null {
  if (t === "flat") return null;
  if (t === "rolling") {
    return "Rolling course. Let the pace drift on the short climbs rather than fighting to hold a number — even effort beats even pace.";
  }
  if (t === "hilly") {
    return "Hilly course. Ride the climbs by effort, not by your flat power target, and go out of T2 easier than feels right — the run will ask for it back.";
  }
  return "Mountainous course. Your flat numbers do not apply today — ride and run the effort you can hold all day, not the pace you trained at. Climb well within yourself, eat more than feels necessary, and treat the first half as setup for the second.";
}

// ---------------------------------------------------------------------------
// Turning a flat session into a hill session
// ---------------------------------------------------------------------------

/** Quality work that has a sensible hill equivalent. Endurance and recovery
 *  sessions are left alone — their job is aerobic time, and doing it on a climb
 *  makes them harder than prescribed, which would quietly change the load. */
const CONVERTIBLE = new Set(["threshold", "vo2", "tempo"]);

export function isHillCandidate(w: Workout): boolean {
  return (w.discipline === "bike" || w.discipline === "run") && CONVERTIBLE.has(w.type) && w.status === "planned";
}

interface HillCopy {
  title: string;
  purpose: string;
  cue: string;
  /** rewrites a main-segment description; keeps the numbers, changes the target */
  target: string;
}

function hillCopy(w: Workout, t: Terrain): HillCopy {
  const steep = t === "mountainous";
  const bike = w.discipline === "bike";
  if (w.type === "vo2") {
    return bike
      ? {
          title: steep ? "Steep Hill Attacks" : "Bike Hill Attacks",
          purpose:
            "Short, steep efforts build the punch a climb demands — the gear you need when the road kicks up and you're already at your limit.",
          cue: "Out of the saddle, drive from the hips. Recover fully on the descent.",
          target: "up a 6–10% climb, full gas",
        }
      : {
          // NOT "Hill Sprints". hillify preserves the prescription, and the VO2 run
          // it converts can be 3-minute reps as easily as 20-second ones — naming it
          // a sprint would put a title on the session that contradicts the intervals
          // printed directly underneath it.
          title: "Uphill Intervals",
          purpose:
            "Hard efforts uphill load the muscle at full intensity while the gradient caps your speed — the power your course demands, with far less pounding than flat speed work.",
          cue: "Tall posture, quick turnover, drive the knees. Take the full recovery on the way back down.",
          target: "uphill, hard",
        };
  }
  if (w.type === "threshold") {
    return bike
      ? {
          title: steep ? "Mountain Climb Repeats" : "Bike Hill Repeats",
          purpose:
            "Sustained climbing at threshold is the specific demand of your course — the same power, held on the gradient you'll actually race.",
          cue: "Seated, steady, cadence 70–80. Hold the effort even as the gradient changes.",
          target: "climbing at threshold effort",
        }
      : {
          title: "Hill Repeats",
          purpose:
            "Threshold effort on a climb builds the strength your race course asks for, and the gradient caps your speed so the joints take less than flat intervals.",
          cue: "Run the effort, not the pace. Shorten your stride and keep the cadence up.",
          target: "uphill at threshold effort",
        };
  }
  // tempo
  return bike
    ? {
        title: "Rolling Tempo Ride",
        purpose:
          "Tempo over rolling terrain rehearses the thing that actually breaks race plans: repeatedly lifting the effort for a climb and settling again without going into the red.",
        cue: "Ease over the tops rather than surging. Let the pace move, keep the effort flat.",
        target: "over rolling terrain, steady effort",
      }
    : {
        title: "Rolling Tempo Run",
        purpose:
          "Tempo over undulating ground teaches you to hold effort while your pace moves around — exactly what your race course will demand.",
        cue: "Effort stays level; let the watch number rise on the climbs and fall on the descents.",
        target: "over rolling terrain, steady effort",
      };
}

/**
 * Rewrite a segment tree's main descriptions so they name the terrain target.
 *
 * The numbers are preserved verbatim — durations, zones, repeats, FTP bands all
 * survive, because those are the prescription. Only the "@ threshold" half of a
 * description is re-pointed at the climb, since holding a flat pace target on a
 * gradient is precisely the mistake this exists to prevent.
 */
function retarget(segments: Segment[], copy: HillCopy, depth = 0): Segment[] {
  return segments.map((s) => {
    const next: Segment = { ...s };
    // Children are walked so the tree is rebuilt immutably, but only the OUTERMOST
    // working segment gets the terrain suffix. An interval wrapper already reads
    // "3 × (10 min @ 95–105% FTP / 5 min easy)", and suffixing its children too
    // produced "10 min @ threshold — climbing at threshold effort" nested inside a
    // set that had just said the same thing.
    if (next.children) next.children = retarget(next.children, copy, depth + 1);
    // only the working segments — warmups, cooldowns and recoveries stay flat,
    // which is also how you'd actually run the session
    if (depth === 0 && s.kind === "main" && (s.zone ?? 0) >= 3) {
      next.description = `${s.description} — ${copy.target}`;
      if (!next.cue) next.cue = copy.cue;
    }
    return next;
  });
}

/** The hill version of a session: same discipline, type, zone and duration. */
export function hillify(w: Workout, t: Terrain): Workout {
  const copy = hillCopy(w, t);
  return {
    ...w,
    title: copy.title,
    purpose: copy.purpose,
    segments: retarget(w.segments, copy),
    terrainFocus: t,
  };
}

/** A climbing cue on the long ride/run, for courses where the long day is where
 *  the course is really rehearsed. Doesn't change the session — adds the
 *  instruction that makes the same minutes course-specific. */
export function climbCue(w: Workout, t: Terrain): Workout {
  const note =
    w.discipline === "bike" || w.discipline === "brick"
      ? "Take this one over the hilliest route you can find — climbing at endurance effort is the specific fitness your course wants."
      : "Find rolling ground for this. Steady effort over the undulations, not steady pace.";
  // Exactly ONE segment carries the note, and it's the longest aerobic block —
  // the part of the session that IS the route. Cueing every eligible segment put
  // "take this one over the hilliest route you can find" on a brick's T2, which
  // reads as advice about racking your bike. Picking the longest also naturally
  // skips transitions without needing to special-case them.
  let best = -1;
  let bestSec = 0;
  w.segments.forEach((s, i) => {
    if (s.kind !== "main" || (s.zone ?? 0) > 3) return;
    const sec = (s.durationSec ?? 0) * (s.repeat ?? 1);
    if (sec > bestSec) {
      bestSec = sec;
      best = i;
    }
  });
  // If nothing could carry the instruction, don't claim the session is course-specific.
  // APPEND rather than only-when-absent: the long run's main segment already ships
  // with "Time on feet is the goal…", and a `!s.cue` guard silently did nothing
  // while still stamping the session course-specific — a flag with no instruction
  // behind it, which is worse than not marking it at all.
  if (best < 0) return w;
  const segments = w.segments.map((s, i) =>
    i === best ? { ...s, cue: s.cue ? `${s.cue} ${note}` : note } : s,
  );
  return { ...w, segments, terrainFocus: t };
}

/**
 * Apply the course profile to one built week, in place.
 *
 * Only build and peak weeks are touched:
 *   - BASE is aerobic by design (doc 01 §4 #3). Its quality sessions are few and
 *     its job is volume; converting them would make base weeks race-specific,
 *     which is the classic way to arrive at the build phase already cooked.
 *   - the TAPER holds intensity while volume falls (doc 01 §4 #6). Introducing a
 *     novel eccentric stimulus in the last two weeks is how athletes turn up to
 *     a start line with sore quads, so hill work is not added there. An athlete
 *     who has trained the hills all block does not need one more session of them.
 *   - RECOVERY weeks are left alone for the same reason as base.
 *
 * Sessions are chosen in the week's own order so the result is deterministic.
 */
export function applyTerrainToWeek(
  workoutIds: string[],
  out: Record<string, Workout>,
  t: Terrain,
  phase: string,
  isRecovery: boolean,
): void {
  if (t === "flat") return;
  if (isRecovery) return;
  if (phase !== "build" && phase !== "peak") return;

  let budget = HILL_SESSIONS_PER_WEEK[t];
  for (const id of workoutIds) {
    if (budget <= 0) break;
    const w = out[id];
    if (!w || !isHillCandidate(w)) continue;
    out[id] = hillify(w, t);
    budget--;
  }

  if (!longSessionsClimb(t)) return;
  for (const id of workoutIds) {
    const w = out[id];
    if (!w || w.terrainFocus) continue;
    if (w.type !== "long" && w.type !== "brick") continue;
    if (w.discipline === "swim") continue;
    out[id] = climbCue(w, t);
  }
}
