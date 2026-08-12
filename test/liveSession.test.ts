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
  REST_CIRCUIT_SEC,
  REST_HEAVY_SEC,
  REST_WORKING_SEC,
  addExercise,
  addSet,
  clearRest,
  completeSet,
  finishSession,
  nudgeRest,
  restRemainingSec,
  restSecondsFor,
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
import { compareLifts, congratulate, exerciseHistory, setBeatsLast, topSet } from "../lib/strength";
import type { StrengthEntry, Workout } from "../lib/types";

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

// ---------------------------------------------------------------------------
// "It should compare to what you did last time or congratulate you if you did
// better." — Ryan.
//
// The rule: a congratulation that fires on a lighter day teaches the athlete to
// ignore the badge, so "better" is load first, then reps AT that load. Nothing
// else counts, and having no history is its own state rather than a free win.
// ---------------------------------------------------------------------------

section("what counts as beating last time");
{
  const last = [{ reps: 5, weightKg: 100 }, { reps: 5, weightKg: 100 }, { reps: 4, weightKg: 100 }];

  ok(setBeatsLast({ reps: 5, weightKg: 105 }, last) === "weight", "heavier than last time's best set is a win");
  ok(setBeatsLast({ reps: 6, weightKg: 100 }, last) === "reps", "same weight for more reps than were done at that weight is a win");
  ok(setBeatsLast({ reps: 5, weightKg: 100 }, last) === null, "matching last time is not a win — it's a match");
  ok(setBeatsLast({ reps: 4, weightKg: 95 }, last) === null, "a lighter set is never a win");

  // The trap this exists to prevent: rewarding a heavy triple over a hard set of eight.
  ok(setBeatsLast({ reps: 3, weightKg: 105 }, [{ reps: 8, weightKg: 100 }]) === "weight",
     "105 × 3 over 100 × 8 IS heavier, so it reads as a load win — deliberate, and only ever on load");
  ok(setBeatsLast({ reps: 8, weightKg: 95 }, [{ reps: 3, weightKg: 100 }]) === null,
     "…but more reps at a LIGHTER weight is not, which is the direction that would cheapen the badge");

  ok(setBeatsLast({ reps: 8, weightKg: 60 }, []) === null, "with no history there is nothing to beat");
  ok(setBeatsLast({ reps: 8, weightKg: 60 }, null) === null, "and a missing history is the same — 'first time' is its own state");

  // Bodyweight: reps are the only axis, and must still work.
  ok(setBeatsLast({ reps: 22 }, [{ reps: 20 }]) === "reps", "bodyweight progression is measured in reps");
  ok(setBeatsLast({ reps: 18 }, [{ reps: 20 }]) === null, "and fewer reps is not progression");

  ok(topSet([{ reps: 5, weightKg: 100 }, { reps: 8, weightKg: 100 }])?.reps === 8,
     "the top set breaks weight ties on reps");
}

section("the congratulation is specific, or silent");
{
  const hist = (name: string, sets: { reps: number; weightKg?: number }[], date = "2026-08-04"): Workout =>
    ({ id: "old-" + name, date, status: "done", discipline: "strength", strengthLog: [{ name, sets }] }) as unknown as Workout;

  const history = [
    hist("Back Squat", [{ reps: 5, weightKg: 100 }]),
    hist("Bench Press", [{ reps: 8, weightKg: 60 }]),
  ];
  const past = exerciseHistory(history);

  const better = compareLifts([{ name: "Back Squat", sets: [{ reps: 5, weightKg: 105 }] }], past);
  ok(better[0].beat === "weight", "a heavier squat is flagged");
  const msg = congratulate(better);
  ok(!!msg && msg.includes("Back Squat") && msg.includes("105"), `and named with the number: "${msg}"`);
  ok(!!msg && msg.includes("5 up"), "including how much better, which is the part worth hearing");

  const same = compareLifts([{ name: "Back Squat", sets: [{ reps: 5, weightKg: 100 }] }], past);
  ok(congratulate(same) === null, "repeating last week says nothing — silence beats a hollow well-done");

  const worse = compareLifts([{ name: "Back Squat", sets: [{ reps: 3, weightKg: 80 }] }], past);
  ok(congratulate(worse) === null, "and a lighter day is never congratulated");

  // First time on a lift: real, but not a personal best over nothing.
  const firstTime = compareLifts([{ name: "Front Squat", sets: [{ reps: 5, weightKg: 60 }] }], past);
  ok(firstTime[0].last === null, "a lift never done before reports no 'last time'");
  ok(congratulate(firstTime) === null, "and doesn't congratulate you for beating nothing");

  // The biggest jump leads, and the rest are counted rather than listed.
  const many = compareLifts(
    [
      { name: "Back Squat", sets: [{ reps: 5, weightKg: 102.5 }] },
      { name: "Bench Press", sets: [{ reps: 8, weightKg: 70 }] },
    ],
    past,
  );
  const m2 = congratulate(many);
  ok(!!m2 && m2.startsWith("Bench Press"), `the biggest gain leads (${m2})`);
  ok(!!m2 && m2.includes("1 more lift"), "and the others are counted, not recited");

  // Reps progression reads as reps, not as a weight gain of zero.
  const repsWin = compareLifts([{ name: "Bench Press", sets: [{ reps: 10, weightKg: 60 }] }], past);
  const m3 = congratulate(repsWin);
  ok(!!m3 && m3.includes("10 reps") && m3.includes("up from 8"), `a reps win says so: "${m3}"`);
}

// --- rest between sets ------------------------------------------------------
//
// The invariant that matters: rest is an ABSOLUTE END INSTANT, never a tick
// count. A phone on a bench locks and the WebView suspends, so anything that
// counted its own ticks would come back having lost exactly the interval it
// exists to measure. Every assertion below advances the clock by hand — no
// timers, no waiting — which is only possible because the module takes `nowISO`.
section("rest is measured against the clock, not counted in ticks");
{
  const at = (sec: number) => new Date(Date.parse("2026-08-12T10:00:00.000Z") + sec * 1000).toISOString();
  const s0 = startSession({ workoutId: "w1", startedISO: at(0), slot: "push", name: "Push", from: ROUTINE });

  ok(restRemainingSec(s0, at(0)) === null, "a session nobody has ticked is not resting");

  // Bench Press is 8 reps → the ordinary working set.
  const resting = completeSet(s0, 0, 0, true, at(0));
  ok(resting.exercises[0].sets[0].done, "ticking the set still ticks the set");
  ok(restRemainingSec(resting, at(0)) === REST_WORKING_SEC, `an 8-rep set rests ${REST_WORKING_SEC}s`);
  ok(restRemainingSec(resting, at(30)) === REST_WORKING_SEC - 30, "and it counts down with the clock");

  // The case the whole design exists for: the screen was off for the entire rest.
  ok(
    restRemainingSec(resting, at(600)) === 0,
    "a rest that elapsed while the phone was locked reads done — never a negative number",
  );

  ok(restRemainingSec(clearRest(resting), at(10)) === null, "Skip stops the clock");
  ok(
    restRemainingSec(completeSet(resting, 0, 0, false, at(10)), at(10)) === null,
    "and un-ticking a set stops it too — that rest was for work that didn't happen",
  );
}

section("rest length is prescribed by the set, per doc 01 §4 rule 4");
{
  ok(restSecondsFor({ reps: 3, weightKg: 100, done: true }) === REST_HEAVY_SEC, "a heavy triple gets the long recovery");
  ok(restSecondsFor({ reps: 6, weightKg: 90, done: true }) === REST_HEAVY_SEC, "so does a 6");
  ok(restSecondsFor({ reps: 8, weightKg: 60, done: true }) === REST_WORKING_SEC, "an 8 is an ordinary working set");
  ok(restSecondsFor({ reps: 20, done: true }) === REST_CIRCUIT_SEC, "high-rep circuit work rests short");
  ok(
    REST_HEAVY_SEC > REST_WORKING_SEC && REST_WORKING_SEC > REST_CIRCUIT_SEC,
    "heavier work always rests longer — the ordering IS the prescription",
  );
  // The specific mistake this guards: defaulting everything to a bodybuilder's
  // 90s turns a triathlete's heavy triple into a fatigue set, which is the one
  // stimulus doc 01 says they should not be buying.
  ok(restSecondsFor({ reps: 3, done: true }) !== REST_WORKING_SEC, "heavy work is never given the hypertrophy default");
}

section("nudging rest");
{
  const at = (sec: number) => new Date(Date.parse("2026-08-12T10:00:00.000Z") + sec * 1000).toISOString();
  const s = completeSet(
    startSession({ workoutId: "w1", startedISO: at(0), slot: "push", name: "Push", from: ROUTINE }),
    0, 0, true, at(0),
  );
  ok(restRemainingSec(nudgeRest(s, at(0), 30), at(0)) === REST_WORKING_SEC + 30, "+30s adds thirty seconds");
  ok(restRemainingSec(nudgeRest(s, at(0), -30), at(0)) === REST_WORKING_SEC - 30, "and it goes the other way");
  ok(
    restRemainingSec(nudgeRest(s, at(0), -9999), at(0)) === 0,
    "taking off more than is left lands on zero, not below it",
  );
  const notResting = startSession({ workoutId: "w1", startedISO: at(0), slot: "push", name: "Push", from: ROUTINE });
  ok(
    restRemainingSec(nudgeRest(notResting, at(0), 30), at(0)) === null,
    "+30s with no timer running is a no-op — it must not conjure a rest nobody started",
  );
}

section("rest never reaches what gets logged");
{
  const at = (sec: number) => new Date(Date.parse("2026-08-12T10:00:00.000Z") + sec * 1000).toISOString();
  const s = completeSet(
    startSession({ workoutId: "w1", startedISO: at(0), slot: "push", name: "Push", from: ROUTINE }),
    0, 0, true, at(0),
  );
  const entries = finishSession(s);
  ok(entries.length === 1 && entries[0].sets.length === 1, "the ticked set is logged");
  ok(
    !JSON.stringify(entries).includes("rest"),
    "and no rest bookkeeping leaks into the strength history everything else is computed from",
  );
}

console.log(`\n${checks - failures}/${checks} live-session invariants passed`);
if (failures > 0) {
  console.error(`\n❌ ${failures} live-session invariant(s) FAILED`);
  process.exit(1);
}
console.log("\n✅ all live-session invariants passed");
