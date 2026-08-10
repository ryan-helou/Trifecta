// ---------------------------------------------------------------------------
// Gym routines + the exercise catalog — "build your workout so you don't have
// to log every time" (Ryan, follow-up to #199).
//
// The load-bearing claim is that a routine attaches to a SLOT (every Push day)
// and not to a workout id, so it survives the plan being rebuilt. That's what
// the first section proves, because it's the thing that would quietly break and
// only be noticed weeks later when someone's routine vanished.
//
// Pure, no clock, no I/O. Run: npx tsx test/routines.test.ts
// ---------------------------------------------------------------------------

import { generatePlan } from "../lib/planEngine";
import {
  SLOT_LABEL,
  defaultRoutineName,
  deleteRoutine,
  routineForWorkout,
  routineFromEntries,
  slotOf,
  upsertRoutine,
} from "../lib/routines";
import { EXERCISE_CATALOG, canonicalName, searchExercises } from "../lib/exerciseCatalog";
import type { Profile, StrengthEntry, StrengthSlot, Workout } from "../lib/types";

let checks = 0;
let failures = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error(`  ✗ ${msg}`);
  }
}
function section(name: string) {
  console.log(`\n• ${name}`);
}

const ANCHOR = "2026-08-10";
const profileFor = (split: "push-pull-legs" | "upper-lower" | "full"): Profile =>
  ({
    username: "t",
    raceType: "olympic",
    raceDateISO: "2026-11-01",
    level: "intermediate",
    workoutsPerWeek: 8,
    strength: { enabled: true, daysPerWeek: 3, split },
  }) as unknown as Profile;

const PUSH_DAY: StrengthEntry[] = [
  { name: "Barbell Bench Press", sets: [{ reps: 5, weightKg: 80 }, { reps: 5, weightKg: 80 }, { reps: 5, weightKg: 80 }] },
  { name: "Overhead Press", sets: [{ reps: 8, weightKg: 40 }, { reps: 8, weightKg: 40 }] },
];

// ---- 1. the slot survives a rebuild ----------------------------------------

section("A routine attaches to the gym DAY, not to a workout");
{
  const p = generatePlan(profileFor("push-pull-legs"), ANCHOR);
  const gym = Object.values(p.workouts).filter((w) => w.discipline === "strength");
  ok(gym.length > 3, `the plan has gym sessions to attach to (got ${gym.length})`);
  ok(
    gym.every((w) => !!w.strengthSlot),
    "every generated gym session carries its slot",
  );
  const slots = [...new Set(gym.map((w) => w.strengthSlot))].sort();
  ok(
    slots.join(",") === "legs,pull,push",
    `a push-pull-legs plan uses exactly those three slots (got ${slots.join(",")})`,
  );

  // The point of keying on the slot: ONE routine fills EVERY push day, of which
  // there are many across the plan, each a different workout object.
  const pushDays = gym.filter((w) => slotOf(w) === "push");
  ok(pushDays.length > 1, `there is more than one Push day (got ${pushDays.length})`);
  const prof = { ...profileFor("push-pull-legs"), routines: [routineFromEntries("push", "My Push Day", PUSH_DAY)!] };
  ok(
    pushDays.every((w) => routineForWorkout(prof, w)?.exercises.length === 2),
    "one saved routine fills every Push day in the plan",
  );
  ok(
    gym.filter((w) => slotOf(w) !== "push").every((w) => routineForWorkout(prof, w) === null),
    "...and does not leak onto Pull or Legs days",
  );

  // Rebuilding does NOT churn ids — they're positional (`w-<week>-<day>-strength`),
  // which is worse than churn for anything keyed on them: the SAME id comes back
  // meaning a different session. Measured, `w-0-4-strength` is 2026-08-14 in one
  // plan and 2026-08-21 in the next, so a routine pinned to an id would silently
  // re-point at another day rather than fail loudly. The slot doesn't move.
  const rebuilt = generatePlan(profileFor("push-pull-legs"), "2026-08-17");
  const newPush = Object.values(rebuilt.workouts).filter((w) => slotOf(w) === "push");
  ok(newPush.length > 0, "the rebuilt plan still has Push days");
  ok(
    newPush.every((w) => routineForWorkout(prof, w)?.name === "My Push Day"),
    "the routine still finds them after a rebuild",
  );
  const sameId = newPush.find((w) => w.id === pushDays[0].id);
  ok(
    !!sameId && sameId.date !== pushDays[0].date,
    `an id is reused for a different date (${pushDays[0].id}: ${pushDays[0].date} → ${sameId?.date}) — which is why the routine keys on the slot`,
  );
}

section("Older plans without a stamped slot still work");
{
  // Plans generated before routines existed carry no `strengthSlot`. Falling
  // back to the title means an athlete mid-plan doesn't have to rebuild.
  const titled = (title: string) => ({ discipline: "strength", title } as unknown as Workout);
  const cases: [string, StrengthSlot][] = [
    ["Push Strength", "push"],
    ["Pull Strength", "pull"],
    ["Leg Strength", "legs"],
    ["Lower-Body Strength", "lower"],
    ["Upper-Body & Core Strength", "upper"],
    ["Full-Body Strength Circuit", "full"],
    ["Home Strength (Bodyweight)", "home"],
    ["Your Strength Session", "custom"],
  ];
  for (const [title, want] of cases) {
    ok(slotOf(titled(title)) === want, `"${title}" → ${want} (got ${slotOf(titled(title))})`);
  }
  // The upper-body session is literally called "Upper-Body & Core Strength", so
  // a naive "core" test would have stolen it. Guard the ordering.
  ok(slotOf(titled("Upper-Body & Core Strength")) !== "full", "'& Core' in a title doesn't hijack the slot");
  ok(slotOf({ discipline: "run", title: "Push Strength" } as unknown as Workout) === null, "a run is never a gym day");
  // An explicit slot always beats the title.
  ok(
    slotOf({ discipline: "strength", title: "Push Strength", strengthSlot: "legs" } as unknown as Workout) === "legs",
    "a stamped slot wins over the title",
  );
}

// ---- 2. saving ------------------------------------------------------------

section("Saving a routine");
{
  const r = routineFromEntries("push", "My Push Day", PUSH_DAY, ANCHOR)!;
  ok(r.slot === "push" && r.exercises.length === 2, "a routine is built from what's on screen");
  ok(r.exercises[0].sets[0].weightKg === 80, "weights carry over — starting from last week's numbers is the point");
  ok(r.updatedISO === ANCHOR, "the timestamp is passed in, never read from a clock");

  // Half-typed rows must not become permanent zeroes in a reusable template.
  const messy: StrengthEntry[] = [
    { name: "Squat", sets: [{ reps: 5, weightKg: 100 }, { reps: 0 }] },
    { name: "  ", sets: [{ reps: 5 }] },
    { name: "Abandoned", sets: [{ reps: 0 }] },
  ];
  const cleaned = routineFromEntries("legs", "Legs", messy)!;
  ok(cleaned.exercises.length === 1, `empty and unnamed rows are dropped (got ${cleaned.exercises.length})`);
  ok(cleaned.exercises[0].sets.length === 1, "and a zero-rep set inside a kept exercise goes too");
  ok(routineFromEntries("push", "Nothing", []) === null, "nothing worth saving returns null, so the button can stay honest");

  // One routine per slot: saving again REPLACES rather than accumulating, or the
  // athlete ends up with six "My Push Day"s and a picker nobody asked for.
  let list = upsertRoutine([], r);
  list = upsertRoutine(list, routineFromEntries("push", "My Push Day v2", PUSH_DAY)!);
  ok(list.length === 1, `re-saving replaces the slot's routine (got ${list.length})`);
  ok(list[0].name === "My Push Day v2", "...with the newer one");
  list = upsertRoutine(list, routineFromEntries("pull", "My Pull Day", PUSH_DAY)!);
  ok(list.length === 2, "a different slot is a different routine");
  ok(upsertRoutine(list, r) !== list, "upsert returns a NEW array, or React would never persist it");

  ok(deleteRoutine(list, "push").length === 1, "deleting removes exactly one slot");
  ok(deleteRoutine(list, "push").every((x) => x.slot !== "push"), "...the right one");
  ok(deleteRoutine(undefined, "push").length === 0, "deleting from nothing is not a crash");

  ok(defaultRoutineName("push") === "My Push Day", `default name reads naturally (got "${defaultRoutineName("push")}")`);
  // The chip label is sentence case ("Full body"); a NAME needs title case, or
  // the saved routine reads "My Full body Day" — which it did, on the device.
  ok(defaultRoutineName("full") === "My Full Body Day", `got "${defaultRoutineName("full")}"`);
  ok(defaultRoutineName("lower") === "My Lower Body Day", `got "${defaultRoutineName("lower")}"`);
  ok(
    (["full", "upper", "lower", "push", "pull", "legs", "home", "custom"] as StrengthSlot[]).every(
      (sl) => !/ [a-z]/.test(defaultRoutineName(sl).replace("My ", "")),
    ),
    "no default routine name has a lowercase word mid-title",
  );
  ok(Object.keys(SLOT_LABEL).length === 8, "every slot has a human label");
}

// ---- 3. the catalog -------------------------------------------------------

section("Finding an exercise while typing");
{
  ok(searchExercises("").length === 0, "an empty box suggests nothing");
  ok(searchExercises("bench")[0] === "Barbell Bench Press", `"bench" finds the bench press (got ${searchExercises("bench")[0]})`);
  ok(searchExercises("rdl")[0] === "Romanian Deadlift", `an alias finds it (got ${searchExercises("rdl")[0]})`);
  ok(searchExercises("squat").includes("Back Squat"), "'squat' finds the squat");
  ok(searchExercises("zzzz").length === 0, "nonsense suggests nothing rather than guessing");
  ok(searchExercises("s", undefined, 4).length <= 4, "the list is capped");

  // The slot reorders, it never censors: a Push day still finds a squat.
  const onPush = searchExercises("squat", "push");
  ok(onPush.includes("Back Squat"), "a Push day still finds Back Squat if you type it");
  const presses = searchExercises("press", "push");
  ok(presses[0].includes("Press"), "on a Push day, presses come first");
  const legDay = searchExercises("press", "legs");
  ok(legDay.includes("Leg Press"), "on a Leg day, Leg Press is offered");
  ok(legDay[0] === "Leg Press", `...and ranks first (got ${legDay[0]})`);

  ok(canonicalName("bench") === "Barbell Bench Press", "a known alias resolves to one spelling");
  ok(canonicalName("BACK SQUAT") === "Back Squat", "matching ignores case");
  ok(canonicalName("Ryan's Special Lift") === null, "an unknown lift is NOT renamed to our nearest guess");
  ok(canonicalName("") === null, "empty input resolves to nothing");

  // Catalog hygiene: duplicate names would show twice in the suggestion list.
  const names = EXERCISE_CATALOG.map((e) => e.name.toLowerCase());
  ok(new Set(names).size === names.length, "no duplicate exercise names in the catalog");
  ok(EXERCISE_CATALOG.every((e) => e.name.trim() === e.name && e.name.length > 1), "every name is clean");
  // Every gym day must be able to fill a session from the catalog alone.
  for (const slot of ["push", "pull", "legs", "upper", "lower", "full", "home"] as StrengthSlot[]) {
    const n = EXERCISE_CATALOG.filter((e) => e.slots.includes(slot)).length;
    ok(n >= 5, `slot "${slot}" has enough exercises to build a session (got ${n})`);
  }
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) {
  console.error(`\n❌ ${failures} routine invariant(s) failed`);
  process.exit(1);
}
console.log("\n✅ all routine invariants passed");
