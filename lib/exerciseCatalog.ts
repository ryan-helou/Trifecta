// ---------------------------------------------------------------------------
// The exercise catalog — what "Add an exercise" suggests as you type.
//
// WHY THIS EXISTS: the log's history and personal bests are keyed on the
// exercise NAME (lib/strength.ts), so "Bench", "bench press" and "Barbell Bench
// Press" are three separate lifts with three separate PBs. Free text alone
// silently forks an athlete's history on a typo. A catalog doesn't forbid free
// text — it just makes the canonical spelling the easiest thing to tap.
//
// WHAT'S IN IT: lifts a triathlete actually programmes. Doc 01 §4.4 is explicit
// that in-season resistance work is a MAINTENANCE dose and that triathletes
// should "prefer strength/power/plyometric over hypertrophy work", so this is
// weighted to compound movements, posterior chain, single-leg work and trunk
// stability — not an arm-day bodybuilding index. Isolation work that genuinely
// serves the sports (calf raises for run durability, external rotations and
// face pulls for swim shoulders) is in; curls-for-curls' sake is thin on
// purpose but present, because refusing to list what someone is going to do
// anyway just sends them back to free text.
//
// `slots` tags which gym day a lift belongs to, so a Push day suggests presses
// before it suggests deadlifts. A lift with no tags is offered everywhere.
//
// Pure data + two pure functions. No clock, no I/O.
// ---------------------------------------------------------------------------

import type { StrengthSlot } from "./types";

export interface CatalogExercise {
  name: string;
  /** Gym days this belongs to. Empty ⇒ offered on any day. */
  slots: StrengthSlot[];
  /** Extra strings that should match this lift while typing ("rdl" → Romanian
   *  Deadlift). Not shown; purely to make search find the obvious thing. */
  aliases?: string[];
}

const PUSH: StrengthSlot[] = ["push", "upper", "full"];
const PULL: StrengthSlot[] = ["pull", "upper", "full"];
const LEGS: StrengthSlot[] = ["legs", "lower", "full"];
const CORE: StrengthSlot[] = ["full", "upper", "lower", "push", "pull", "legs", "home"];

export const EXERCISE_CATALOG: CatalogExercise[] = [
  // ---- squat pattern ----
  { name: "Back Squat", slots: LEGS, aliases: ["barbell squat", "squat"] },
  { name: "Front Squat", slots: LEGS },
  { name: "Goblet Squat", slots: [...LEGS, "home"] },
  { name: "Box Squat", slots: LEGS },
  { name: "Hack Squat", slots: LEGS },
  { name: "Leg Press", slots: LEGS },

  // ---- hinge pattern (the posterior chain doc 01 keeps pointing at) ----
  { name: "Deadlift", slots: [...LEGS, "pull"], aliases: ["conventional deadlift"] },
  { name: "Romanian Deadlift", slots: [...LEGS, "pull"], aliases: ["rdl", "romanian"] },
  { name: "Trap Bar Deadlift", slots: [...LEGS, "pull"], aliases: ["hex bar"] },
  { name: "Single-Leg Deadlift", slots: [...LEGS, "home"], aliases: ["sldl", "single leg rdl"] },
  { name: "Good Morning", slots: LEGS },
  { name: "Hip Thrust", slots: LEGS },
  { name: "Glute Bridge", slots: [...LEGS, "home"] },
  { name: "Back Extension", slots: [...LEGS, "pull"], aliases: ["hyperextension"] },
  { name: "Nordic Curl", slots: LEGS, aliases: ["nordic hamstring"] },
  { name: "Hamstring Curl", slots: LEGS, aliases: ["leg curl"] },

  // ---- single-leg: run durability and the late-race fade ----
  { name: "Bulgarian Split Squat", slots: [...LEGS, "home"], aliases: ["rear foot elevated", "bss"] },
  { name: "Split Squat", slots: [...LEGS, "home"] },
  { name: "Walking Lunge", slots: [...LEGS, "home"], aliases: ["lunge"] },
  { name: "Reverse Lunge", slots: [...LEGS, "home"] },
  { name: "Step-Up", slots: [...LEGS, "home"], aliases: ["step up"] },
  { name: "Pistol Squat", slots: [...LEGS, "home"] },
  { name: "Calf Raise", slots: [...LEGS, "home"], aliases: ["standing calf"] },
  { name: "Single-Leg Calf Raise", slots: [...LEGS, "home"] },

  // ---- horizontal press ----
  { name: "Barbell Bench Press", slots: PUSH, aliases: ["bench", "bench press", "flat bench"] },
  { name: "Dumbbell Bench Press", slots: PUSH, aliases: ["db bench"] },
  { name: "Incline Bench Press", slots: PUSH, aliases: ["incline press", "incline"] },
  { name: "Push-Up", slots: [...PUSH, "home"], aliases: ["pushup", "press up"] },
  { name: "Chest Press Machine", slots: PUSH },
  { name: "Cable Fly", slots: PUSH, aliases: ["chest fly", "pec fly"] },
  { name: "Dip", slots: PUSH, aliases: ["dips", "parallel bar dip"] },

  // ---- vertical press ----
  { name: "Overhead Press", slots: PUSH, aliases: ["ohp", "shoulder press", "military press"] },
  { name: "Dumbbell Shoulder Press", slots: PUSH, aliases: ["db shoulder press"] },
  { name: "Push Press", slots: PUSH },
  { name: "Landmine Press", slots: PUSH },
  { name: "Lateral Raise", slots: PUSH, aliases: ["side raise", "lat raise"] },
  { name: "Pike Push-Up", slots: [...PUSH, "home"] },

  // ---- vertical pull ----
  { name: "Pull-Up", slots: [...PULL, "home"], aliases: ["pullup", "chin up", "chin-up"] },
  { name: "Lat Pulldown", slots: PULL, aliases: ["pulldown"] },
  { name: "Assisted Pull-Up", slots: PULL },
  { name: "Straight-Arm Pulldown", slots: PULL, aliases: ["straight arm"] },

  // ---- horizontal pull: the swim catch, and shoulders that stay healthy ----
  { name: "Barbell Row", slots: PULL, aliases: ["bent over row", "bb row"] },
  { name: "Single-Arm Dumbbell Row", slots: PULL, aliases: ["db row", "one arm row", "single arm row"] },
  { name: "Seated Cable Row", slots: PULL, aliases: ["cable row", "seated row"] },
  { name: "Chest-Supported Row", slots: PULL },
  { name: "Inverted Row", slots: [...PULL, "home"], aliases: ["body row"] },
  { name: "Face Pull", slots: PULL },
  { name: "Band Pull-Apart", slots: [...PULL, "home"] },
  { name: "Rear-Delt Fly", slots: PULL, aliases: ["reverse fly", "rear delt"] },
  { name: "External Rotation", slots: [...PULL, "home"], aliases: ["cuff", "rotator cuff"] },
  { name: "Scapular Pull-Up", slots: PULL, aliases: ["scap pull"] },

  // ---- arms (present, deliberately thin — see the header) ----
  { name: "Biceps Curl", slots: PULL, aliases: ["bicep curl", "curl"] },
  { name: "Hammer Curl", slots: PULL },
  { name: "Triceps Extension", slots: PUSH, aliases: ["tricep extension", "skullcrusher"] },
  { name: "Triceps Pushdown", slots: PUSH, aliases: ["tricep pushdown", "pushdown"] },

  // ---- trunk: holds form when fatigue sets in ----
  { name: "Plank", slots: CORE, aliases: ["front plank"] },
  { name: "Side Plank", slots: CORE },
  { name: "Dead Bug", slots: CORE },
  { name: "Bird Dog", slots: CORE },
  { name: "Pallof Press", slots: CORE, aliases: ["anti rotation"] },
  { name: "Hanging Leg Raise", slots: CORE, aliases: ["leg raise"] },
  { name: "Ab Wheel Rollout", slots: CORE, aliases: ["ab wheel", "rollout"] },
  { name: "Russian Twist", slots: CORE },
  { name: "Farmer's Carry", slots: CORE, aliases: ["farmers walk", "loaded carry"] },
  { name: "Suitcase Carry", slots: CORE },
  { name: "Copenhagen Plank", slots: CORE, aliases: ["copenhagen"] },
  { name: "Superman", slots: [...CORE] },

  // ---- power / plyometric: doc 01 §4.4 prefers these over hypertrophy ----
  { name: "Box Jump", slots: LEGS },
  { name: "Broad Jump", slots: LEGS },
  { name: "Pogo Hop", slots: LEGS, aliases: ["pogo"] },
  { name: "Kettlebell Swing", slots: [...LEGS, "full"], aliases: ["kb swing", "swing"] },
  { name: "Power Clean", slots: [...LEGS, "pull"], aliases: ["clean"] },
  { name: "Medicine Ball Slam", slots: [...CORE], aliases: ["med ball slam", "ball slam"] },
  { name: "Jump Squat", slots: [...LEGS, "home"] },

  // ---- hips: the bit runners skip and then get hurt ----
  { name: "Hip Abduction", slots: [...LEGS, "home"], aliases: ["abduction", "clamshell"] },
  { name: "Monster Walk", slots: [...LEGS, "home"], aliases: ["band walk", "lateral band walk"] },
  { name: "Tibialis Raise", slots: [...LEGS, "home"], aliases: ["tib raise"] },
];

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Suggestions for what's being typed. Ranked so the useful thing is first:
 * a prefix match on the name beats a match mid-name, which beats an alias hit.
 * `slot` only ever REORDERS — a Push day still finds squats if you type "squat",
 * because refusing to show a lift the athlete is standing in front of would be
 * absurd.
 */
export function searchExercises(query: string, slot?: StrengthSlot, limit = 6): string[] {
  const q = norm(query);
  if (!q) return [];
  const scored: { name: string; score: number }[] = [];
  for (const ex of EXERCISE_CATALOG) {
    const name = norm(ex.name);
    let score = -1;
    if (name.startsWith(q)) score = 0;
    else if (name.includes(q)) score = 1;
    else if (ex.aliases?.some((a) => norm(a).startsWith(q))) score = 2;
    else if (ex.aliases?.some((a) => norm(a).includes(q))) score = 3;
    if (score < 0) continue;
    // A lift that belongs to today's gym day sorts above one that doesn't.
    if (slot && ex.slots.length && !ex.slots.includes(slot)) score += 4;
    scored.push({ name: ex.name, score });
  }
  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map((s) => s.name);
}

/**
 * The catalog's spelling of a name, if it recognises it — used to keep history
 * and PBs from forking across "bench" / "Bench Press". Returns null when it
 * doesn't know the lift, and the athlete's own words stand: silently renaming
 * someone's exercise to our nearest guess would be worse than a split history.
 */
export function canonicalName(input: string): string | null {
  const q = norm(input);
  if (!q) return null;
  for (const ex of EXERCISE_CATALOG) {
    if (norm(ex.name) === q) return ex.name;
    if (ex.aliases?.some((a) => norm(a) === q)) return ex.name;
  }
  return null;
}
