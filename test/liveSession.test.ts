// ---------------------------------------------------------------------------
// Invariants for the live gym session (#212).
//
// The rule this suite exists to hold: ONLY WHAT YOU ACTUALLY DID IS LOGGED.
// Everything downstream of a gym session — personal bests, the "what did I lift
// last time" prefill, volume load — is computed from `workout.strengthLog`. A
// set that was prescribed but never performed leaking into that history would
// quietly corrupt every one of them, and it would look right on screen.
// ---------------------------------------------------------------------------

import {
  addExercise,
  addSet,
  finishSession,
  patchSet,
  removeExercise,
  removeSet,
  sessionAsEntries,
  sessionProgress,
  setDone,
  startSession,
  type LiveSession,
} from "../lib/liveSession";
import { MAX_AGE_DAYS } from "../lib/liveStore";
import type { StrengthEntry } from "../lib/types";

let checks = 0;
let failures = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (cond) console.log(`  ✓ ${msg}`);
  else { failures++; console.error(`  ✗ ${msg}`); }
}
function section(name: string) {
  console.log(`\n• ${name}\n`);
}

const ROUTINE: StrengthEntry[] = [
  { name: "Bench Press", sets: [{ reps: 8, weightKg: 60 }, { reps: 8, weightKg: 60 }, { reps: 8, weightKg: 60 }] },
  { name: "Overhead Press", sets: [{ reps: 10, weightKg: 30 }, { reps: 10, weightKg: 30 }] },
];

const fresh = (): LiveSession =>
  startSession({ workoutId: "w-1-0-strength", startedISO: "2026-08-11T18:00:00.000Z", slot: "push", name: "My Push Day", from: ROUTINE });

// ---------------------------------------------------------------------------
section("a session starts as the routine, with nothing done");
{
  const s = fresh();
  ok(s.exercises.length === 2, "both exercises are on the card");
  ok(s.exercises[0].sets.length === 3, "with their prescribed sets");
  ok(s.exercises[0].sets[0].weightKg === 60 && s.exercises[0].sets[0].reps === 8, "pre-filled with the routine's numbers — confirm, don't type");
  ok(s.exercises.every((e) => e.sets.every((x) => !x.done)), "and NOTHING is ticked: they just walked in");

  const p = sessionProgress(s);
  ok(p.done === 0 && p.total === 5, `progress counts every set as the denominator (0/${p.total})`);
  ok(!p.complete, "an untouched session is not complete");

  ok(finishSession(s).length === 0, "finishing without ticking anything logs NOTHING — the crux of this module");
}

// ---------------------------------------------------------------------------
section("only completed sets are logged");
{
  let s = fresh();
  s = setDone(s, 0, 0, true);
  s = setDone(s, 0, 1, true);

  const out = finishSession(s);
  ok(out.length === 1, "an exercise with no ticked sets doesn't appear at all");
  ok(out[0].name === "Bench Press" && out[0].sets.length === 2, "and the one that does carries only its completed sets (2 of 3)");
  ok(out[0].sets.every((x) => x.weightKg === 60 && x.reps === 8), "with the numbers as performed");

  // The failure this prevents: a bailed-out session inflating the history that
  // personal bests and next session's prefill are computed from.
  const all = fresh().exercises.reduce((n, e) => n + e.sets.length, 0);
  ok(out.reduce((n, e) => n + e.sets.length, 0) < all, "a session you bailed on records the half you did, not the whole you intended");

  // Un-ticking is honest too — a mis-tap must be fully reversible.
  const undone = finishSession(setDone(s, 0, 1, false));
  ok(undone[0].sets.length === 1, "un-ticking a set removes it from the log again");
}

// ---------------------------------------------------------------------------
section("editing mid-session");
{
  let s = fresh();
  // The set that didn't go to plan: 8 × 60 was meant, 5 × 60 happened.
  s = patchSet(s, 0, 2, { reps: 5 });
  s = setDone(s, 0, 2, true);
  const out = finishSession(s);
  ok(out[0].sets[0].reps === 5, "an edited set logs what actually happened, not what was prescribed");

  // A new set copies the one above — but NOT its done flag.
  let t = setDone(fresh(), 0, 0, true);
  t = addSet(t, 0);
  const added = t.exercises[0].sets[t.exercises[0].sets.length - 1];
  ok(added.reps === 8 && added.weightKg === 60, "＋ Set inherits the numbers above it");
  ok(!added.done, "but arrives UNTICKED — copying the numbers is convenience, copying the fact you did it is a lie");

  // Removing things
  const fewer = removeSet(fresh(), 0, 0);
  ok(fewer.exercises[0].sets.length === 2, "a set can be removed");
  const dropped = removeExercise(fresh(), 0);
  ok(dropped.exercises.length === 1 && dropped.exercises[0].name === "Overhead Press", "so can a whole exercise");

  // Adding
  const more = addExercise(fresh(), "Cable Fly");
  ok(more.exercises.length === 3, "an exercise not on the card can be added");
  ok(addExercise(more, "cable fly").exercises.length === 3, "and the same one twice can't, whatever the casing");
  ok(addExercise(fresh(), "   ").exercises.length === 2, "a blank name adds nothing");
}

// ---------------------------------------------------------------------------
section("what a set has to be worth recording");
{
  // Ticked but empty: no information, and it would poison the prefill for next time.
  let s = startSession({ workoutId: "w", startedISO: "2026-08-11T18:00:00.000Z", slot: null, name: "Gym", from: [{ name: "Squat", sets: [{ reps: 0 }] }] });
  s = setDone(s, 0, 0, true);
  ok(finishSession(s).length === 0, "a ticked set with no reps is dropped — 0 reps carries no information");

  // Bodyweight is real training (StrengthSet.weightKg is optional by design).
  let b = startSession({ workoutId: "w", startedISO: "2026-08-11T18:00:00.000Z", slot: null, name: "Gym", from: [{ name: "Press-up", sets: [{ reps: 20 }] }] });
  b = setDone(b, 0, 0, true);
  const bo = finishSession(b);
  ok(bo.length === 1 && bo[0].sets[0].reps === 20, "a bodyweight set logs fine with no load");
  ok(bo[0].sets[0].weightKg === undefined, "and stores no weight rather than a zero");
}

// ---------------------------------------------------------------------------
section("saving the session as a routine takes the whole card");
{
  let s = addExercise(fresh(), "Cable Fly");
  s = patchSet(s, 2, 0, { reps: 12, weightKg: 20 });
  s = setDone(s, 0, 0, true); // only one set actually done

  const logged = finishSession(s);
  const asRoutine = sessionAsEntries(s);
  ok(logged.length === 1, "the LOG is what you completed");
  ok(asRoutine.length === 3, "but the ROUTINE is the whole card, including what you added and haven't done yet");
  ok(asRoutine.some((e) => e.name === "Cable Fly"), "so an exercise added mid-session is in next week's routine");
}

// ---------------------------------------------------------------------------
section("progress reads the way an athlete counts");
{
  let s = fresh();
  for (const [ei, si] of [[0, 0], [0, 1], [0, 2]] as const) s = setDone(s, ei, si, true);
  const p = sessionProgress(s);
  ok(p.done === 3 && p.total === 5, "3/5 after one exercise of two");
  ok(!p.complete, "not complete while a set remains");

  let all = s;
  for (const [ei, si] of [[1, 0], [1, 1]] as const) all = setDone(all, ei, si, true);
  ok(sessionProgress(all).complete, "complete once every set is ticked");

  ok(sessionProgress(startSession({ workoutId: "w", startedISO: "x", slot: null, name: "n" })).complete === false,
     "an EMPTY session is never 'complete' — otherwise a blank card would claim a finished workout");
}

// ---------------------------------------------------------------------------
section("mutations never mutate");
{
  const s = fresh();
  const before = JSON.stringify(s);
  setDone(s, 0, 0, true);
  addSet(s, 0);
  patchSet(s, 0, 0, { reps: 99 });
  removeExercise(s, 0);
  ok(JSON.stringify(s) === before,
     "every operation returns a new session — the caller holds it in React state and writes it to storage, so in-place mutation would persist nothing");
}

// ---------------------------------------------------------------------------
section("the staleness rule is a real number");
{
  ok(MAX_AGE_DAYS >= 1 && MAX_AGE_DAYS <= 7,
     `an abandoned draft expires in ${MAX_AGE_DAYS} days — long enough to survive a phone dying mid-session, short enough that last Tuesday's ghost never lands on this Tuesday`);
}

console.log(`\n${checks - failures}/${checks} live-session invariants passed`);
if (failures > 0) {
  console.error(`\n❌ ${failures} live-session invariant(s) FAILED`);
  process.exit(1);
}
console.log("\n✅ all live-session invariants passed");
