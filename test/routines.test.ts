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
  slotLabel,
  slotsForProfile,
  prescribedExercises,
  cardForWorkout,
  upsertRoutine,
} from "../lib/routines";
import { EXERCISE_CATALOG, canonicalName, searchExercises } from "../lib/exerciseCatalog";
import { exerciseHistory } from "../lib/strength";
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

// ---- 5. an athlete's OWN split (#206) --------------------------------------

section("A custom split rotates, and each named day owns its routine");
{
  const customPlan = (text: string) =>
    generatePlan(
      {
        ...profileFor("full"),
        strength: { enabled: true, daysPerWeek: 3, split: "custom", customSplit: text },
      } as unknown as Profile,
      ANCHOR,
    );

  // "push / pull / legs" used to produce ONE slot for every gym day, so a routine
  // saved on Push pre-filled Pull and Legs too.
  const p = customPlan("push / pull / legs");
  const gym = Object.values(p.workouts).filter((w) => w.discipline === "strength");
  const slots = [...new Set(gym.map((w) => slotOf(w)!))];
  ok(slots.length === 3, `three typed days give three slots (got ${slots.length}: ${slots.join(", ")})`);
  ok(slots.every((sl) => sl.startsWith("custom:")), "each is a named custom day");
  ok(
    gym.every((w) => /Your Session/.test(w.title) && !/^Your Strength/.test(w.title)),
    "and each session is titled with the athlete's own word",
  );
  ok(slotLabel(slots[0]) === "Push", `the label reads back as they typed it (got "${slotLabel(slots[0])}")`);

  // The whole point: a routine lands on ONE of the three, not all three.
  const withRoutine = {
    ...profileFor("full"),
    routines: [routineFromEntries(slots[0], "R", [{ name: "Bench", sets: [{ reps: 5, weightKg: 60 }] }])!],
  } as unknown as Profile;
  const covered = gym.filter((w) => routineForWorkout(withRoutine, w)).length;
  ok(covered > 0, "the routine fills its own day");
  ok(covered < gym.length, `and only its own day (${covered}/${gym.length} gym sessions)`);
  ok(
    Math.abs(covered / gym.length - 1 / 3) < 0.1,
    `roughly a third of gym days, one per rotation (got ${covered}/${gym.length})`,
  );

  // Separators people actually type.
  for (const [text, want] of [["Chest Day, Back Day, Leg Day", 3], ["upper | lower", 2], ["a / b / c / d", 4]] as [string, number][]) {
    const n = new Set(
      Object.values(customPlan(text).workouts).filter((w) => w.discipline === "strength").map((w) => slotOf(w)!),
    ).size;
    ok(n === want, `"${text}" → ${want} slots (got ${n})`);
  }

  // Free text we cannot read must fall back, not invent a rotation.
  const vague = customPlan("whatever I feel like");
  const vagueSlots = new Set(
    Object.values(vague.workouts).filter((w) => w.discipline === "strength").map((w) => slotOf(w)!),
  );
  ok(vagueSlots.size === 1 && vagueSlots.has("custom"), "unparseable free text falls back to one generic gym day");
}

// ---- the editor must offer exactly the days the plan will produce (#212) ----
//
// The routine editor asks "which gym day is this for?". If that list and the
// plan's actual rotation ever diverge, an athlete can build a routine for a day
// that never comes round — it saves, it appears in their profile, and it silently
// never attaches to anything. So the invariant is measured against generated
// plans rather than asserted against a hard-coded list.

section("the gym days offered are the gym days the plan builds");
for (const split of ["push-pull-legs", "upper-lower", "full"] as const) {
  const prof = profileFor(split);
  const plan = generatePlan(prof, ANCHOR);
  const onPlan = new Set(
    Object.values(plan.workouts).filter((w) => w.discipline === "strength").map((w) => slotOf(w)!),
  );
  const offered = new Set(slotsForProfile(prof));
  ok([...onPlan].every((sl) => offered.has(sl)), `${split}: every day the plan builds is offered (plan: ${[...onPlan].sort().join(",")})`);
  ok([...offered].every((sl) => onPlan.has(sl)), `${split}: and nothing is offered that the plan never builds (offered: ${[...offered].sort().join(",")})`);
}

{
  // A custom split the athlete typed themselves.
  const custom = {
    ...profileFor("full"),
    strength: { enabled: true, daysPerWeek: 3, split: "custom", customSplit: "Chest / Back / Legs" },
  } as unknown as Profile;
  const plan = generatePlan(custom, ANCHOR);
  const onPlan = new Set(
    Object.values(plan.workouts).filter((w) => w.discipline === "strength").map((w) => slotOf(w)!),
  );
  const offered = new Set(slotsForProfile(custom));
  ok(offered.size === 3, `a three-day custom split offers three days (got ${[...offered].join(", ")})`);
  ok([...onPlan].every((sl) => offered.has(sl)), "and they're the same three the plan builds");

  // Unparseable free text: the engine falls back to one generic day, so must the editor.
  const vague = { ...custom, strength: { enabled: true, daysPerWeek: 2, split: "custom", customSplit: "whatever I feel like" } } as unknown as Profile;
  ok(slotsForProfile(vague).join() === "custom", "unreadable free text offers the single generic gym day, matching strengthFor");

  // No gym at all ⇒ the bodyweight home circuit is the only day there is.
  const home = { ...profileFor("push-pull-legs"), equipment: { gym: false } } as unknown as Profile;
  ok(slotsForProfile(home).join() === "home", "an athlete with no gym is offered the home circuit, not a push/pull/legs split they can't do");
}

// ---- a gym day opens with something on it (#212 usability pass) ------------
//
// Measured on a fresh account before this: without a saved routine the live
// session opened on "Nothing on the card yet", and five exercises had to be typed
// on the screen that exists to stop you typing. The plan already wrote the
// circuit — "3 rounds: push-up ×12 · overhead press ×10 · …" — so parse it back.

section("a gym day opens with the session the plan prescribes");
{
  const plan = generatePlan(profileFor("push-pull-legs"), ANCHOR);
  const gym = Object.values(plan.workouts).filter((w) => w.discipline === "strength");
  const bySlot = new Map<string, Workout>();
  for (const w of gym) if (!bySlot.has(slotOf(w)!)) bySlot.set(slotOf(w)!, w);

  ok(bySlot.size === 3, "three gym days to check");
  for (const [slot, w] of bySlot) {
    const ex = prescribedExercises(w);
    ok(ex.length >= 4, `${slot}: the prescribed circuit parses into ${ex.length} exercises`);
    ok(ex.every((e) => e.sets.length >= 2 && e.sets.every((x) => x.reps > 0)), `${slot}: every exercise has real sets and reps`);
    ok(ex.every((e) => e.name && !/×|\d/.test(e.name)), `${slot}: names are clean (${ex.map((e) => e.name).slice(0, 2).join(", ")}…)`);
  }

  // Canonical names, so the plan's card and hand-logging build ONE PB history.
  const push = prescribedExercises(bySlot.get("push")!);
  ok(push.some((e) => e.name === "Push-Up"), "'push-up' is canonicalised to the catalog's 'Push-Up', not left as free text");
  const pull = prescribedExercises(bySlot.get("pull")!);
  ok(pull.some((e) => /each side/.test(e.name)), "'×12/side' becomes a per-side note rather than a bogus rep count");
  ok(pull.every((e) => e.sets.every((x) => x.reps <= 20)), "and no exercise ends up with a nonsense rep count");

  // A saved routine always wins — it's the athlete's own programme.
  const w = bySlot.get("push")!;
  const withRoutine = {
    ...profileFor("push-pull-legs"),
    routines: [{ id: "r", name: "Mine", slot: "push" as StrengthSlot, exercises: PUSH_DAY }],
  } as unknown as Profile;
  ok(cardForWorkout(withRoutine, w).source === "routine", "a saved routine beats the plan's circuit");
  ok(cardForWorkout(profileFor("push-pull-legs"), w).source === "plan", "and without one, the plan's circuit fills the card");

  // The plan can't know what you lift — but the log can. Second time round, the
  // card should arrive at your working weights without a routine.
  const past = [{
    id: "old", date: "2026-08-01", status: "done", discipline: "strength",
    strengthLog: [{ name: "Push-Up", sets: [{ reps: 12, weightKg: 20 }] }],
  }] as unknown as Workout[];
  const seeded = cardForWorkout(profileFor("push-pull-legs"), w, exerciseHistory(past));
  const pu = seeded.entries.find((e) => e.name === "Push-Up");
  ok(pu?.sets.every((x) => x.weightKg === 20) === true, "a lift you've done before arrives at last time's load");
  ok(pu?.sets.length === push.find((e) => e.name === "Push-Up")?.sets.length,
     "while the PLAN still decides the sets and reps — history supplies only the number the plan couldn't know");
  ok(seeded.entries.find((e) => e.name === "Dip")?.sets.every((x) => x.weightKg == null) === true,
     "and a lift with no history is left blank rather than given an invented weight");
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) {
  console.error(`\n❌ ${failures} routine invariant(s) failed`);
  process.exit(1);
}
console.log("\n✅ all routine invariants passed");
