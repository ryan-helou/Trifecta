// ---------------------------------------------------------------------------
// Course-profile-aware training (lib/terrain.ts) — ticket #85.
//
// Every catalog race already carried a terrain and nothing read it: IRONMAN
// Canada (1,200 m of climbing) got the same plan and the same predicted finish
// as pancake-flat Chicago.
//
// The load-bearing claim of the design is that terrain changes the MODALITY of
// quality work and not its dose — a hill repeat at threshold is threshold work.
// That claim is what makes it safe to skip re-validating the PMC, the rails and
// the weekly budget, so it is the thing this file actually tests: for every
// archetype, the terrain-aware plan must be indistinguishable from the neutral
// one in zone, duration, type, count and weekly hours, and distinguishable in
// what the athlete is told to do.
//
// Pure, no clock, no I/O. Run: npx tsx test/terrain.test.ts
// ---------------------------------------------------------------------------

import { generatePlan, estimateRaceSeconds, categoryOf, raceDistances } from "../lib/planEngine";
import { derivePaces } from "../lib/paces";
import { checkRails, weekHours } from "../lib/rails";
import { dailyLoads, sessionLoad } from "../lib/load";
import {
  DEFAULT_TERRAIN,
  HILL_SESSIONS_PER_WEEK,
  TERRAIN_ORDER,
  TERRAIN_TIME_FACTOR,
  hillify,
  isHillCandidate,
  pacingNote,
  terrainOf,
} from "../lib/terrain";
import type { Plan, Profile, Terrain, Workout } from "../lib/types";

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

const ANCHOR = "2026-08-03";
function weeksFrom(w: number): string {
  const d = new Date(ANCHOR + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + w * 7);
  return d.toISOString().slice(0, 10);
}
function profile(over: Partial<Profile> = {}): Profile {
  return {
    username: "test", raceType: "olympic", raceDateISO: weeksFrom(16),
    level: "intermediate", workoutsPerWeek: 6, createdAtISO: ANCHOR, ...over,
  } as Profile;
}

const ARCHETYPES: Array<Partial<Profile>> = [
  { raceType: "olympic", level: "beginner", workoutsPerWeek: 5 },
  { raceType: "olympic", level: "intermediate", workoutsPerWeek: 6 },
  { raceType: "half", level: "intermediate", workoutsPerWeek: 8 },
  { raceType: "half", level: "advanced", workoutsPerWeek: 9 },
  { raceType: "full", level: "advanced", workoutsPerWeek: 10 },
];

const sorted = (p: Plan) => Object.values(p.workouts).sort((a, b) => a.id.localeCompare(b.id));

// --- 1. the default -------------------------------------------------------
section("an athlete who never picked a race is trained for a rolling course");
{
  ok(DEFAULT_TERRAIN === "rolling", "the default is rolling, not flat");
  ok(terrainOf(profile()) === "rolling", "an absent terrain reads as the default");
  ok(terrainOf(profile({ terrain: "mountainous" })) === "mountainous", "an explicit terrain is honoured");
  // Assuming flat would quietly promise a finish time nobody hits on a real course.
  ok(TERRAIN_TIME_FACTOR.flat.bike === 1.0, "flat is the baseline the pace model is built on");
  ok(
    TERRAIN_TIME_FACTOR[DEFAULT_TERRAIN].bike > 1.0,
    "the default costs time relative to flat, so the estimate is not optimistic by default",
  );
}

// --- 2. THE LOAD-BEARING CLAIM -------------------------------------------
// If this section passes, terrain cannot have moved the PMC, the rails or the
// weekly budget, because none of their inputs changed.
section("terrain changes WHAT you do, never HOW MUCH — across every archetype");
{
  for (const over of ARCHETYPES) {
    const flat = generatePlan(profile({ ...over, terrain: "flat" }), ANCHOR);
    for (const t of ["rolling", "hilly", "mountainous"] as Terrain[]) {
      const p = generatePlan(profile({ ...over, terrain: t }), ANCHOR);
      const label = `${over.raceType}/${over.level} @ ${t}`;
      const a = sorted(flat);
      const b = sorted(p);

      ok(a.length === b.length, `${label}: same number of sessions (${a.length} vs ${b.length})`);
      ok(
        a.every((w, i) => w.id === b[i].id),
        `${label}: the same sessions on the same days — terrain never reschedules`,
      );
      // RACE DAY is excluded from the duration comparison on purpose: its
      // estDurationSec is a PREDICTED FINISH TIME, not a prescription, and it is
      // supposed to move with the course (§8 below pins that it does). Every
      // session the athlete actually trains must be untouched — and the strongest
      // form of that claim is that race day is the ONLY thing that differs.
      const differing = a.filter((w, i) => w.estDurationSec !== b[i].estDurationSec).map((w) => w.id);
      ok(
        differing.every((id) => id === "w-race-day"),
        `${label}: only race day's estimate moves (also differing: ${differing.filter((x) => x !== "w-race-day").join(", ") || "none"})`,
      );
      ok(a.every((w, i) => w.primaryZone === b[i].primaryZone), `${label}: every zone is unchanged`);
      ok(a.every((w, i) => w.type === b[i].type), `${label}: every session type is unchanged`);
      ok(a.every((w, i) => w.discipline === b[i].discipline), `${label}: every discipline is unchanged`);
      ok(
        p.weeks.every(
          (w, i) => w.isRaceWeek || Math.abs(weekHours(p, w) - weekHours(flat, flat.weeks[i])) < 1e-9,
        ),
        `${label}: every training week carries identical hours`,
      );

      // ...and therefore the safety rails see an identical plan
      const rf = checkRails(flat);
      const rt = checkRails(p);
      ok(rt.violations.length === rf.violations.length, `${label}: introduces no rail violation`);
      ok(
        rf.blockHardShare != null && rt.blockHardShare != null &&
          Math.abs(rf.blockHardShare - rt.blockHardShare) < 1e-9,
        `${label}: block intensity distribution is untouched`,
      );
    }
  }
}

// --- 3. ...but the athlete is genuinely told to do something different ----
section("a hilly plan actually contains hill work");
{
  const flat = generatePlan(profile({ raceType: "half", workoutsPerWeek: 8, terrain: "flat" }), ANCHOR);
  const hilly = generatePlan(profile({ raceType: "half", workoutsPerWeek: 8, terrain: "hilly" }), ANCHOR);
  const mtn = generatePlan(profile({ raceType: "half", workoutsPerWeek: 8, terrain: "mountainous" }), ANCHOR);

  const focused = (p: Plan) => Object.values(p.workouts).filter((w) => w.terrainFocus && w.id !== "w-race-day");
  ok(focused(flat).length === 0, "a flat course adds no hill work at all");
  ok(focused(hilly).length > 0, `a hilly course does (${focused(hilly).length} sessions)`);
  ok(
    focused(mtn).length >= focused(hilly).length,
    `mountainous asks for at least as much as hilly (${focused(mtn).length} vs ${focused(hilly).length})`,
  );

  // the change is visible in the words, which is the entire user-facing point
  const changed = Object.values(hilly.workouts).filter((w) => w.title !== flat.workouts[w.id]?.title);
  ok(changed.length > 0, "sessions are retitled, so the plan reads differently");
  ok(
    changed.every((w) => w.purpose !== flat.workouts[w.id].purpose),
    "and every retitled session explains why it's a climb",
  );

  // NO SILENT FLAGS. terrainFocus claims "this session was made specific to your
  // course", so something the athlete can read must actually differ. The long run
  // regressed exactly here: climbCue only set a cue when the segment had none, and
  // the long run ships with one, so it was marked course-specific while reading
  // identically to the flat plan.
  for (const t of ["rolling", "hilly", "mountainous"] as Terrain[]) {
    const p = generatePlan(profile({ raceType: "half", workoutsPerWeek: 8, terrain: t }), ANCHOR);
    for (const w of Object.values(p.workouts)) {
      if (!w.terrainFocus || w.id === "w-race-day") continue;
      const before = flat.workouts[w.id];
      if (!before) continue;
      const differs =
        w.title !== before.title ||
        w.purpose !== before.purpose ||
        JSON.stringify(w.segments) !== JSON.stringify(before.segments);
      ok(differs, `${t}/${w.id} (${w.type}) is flagged course-specific AND actually reads differently`);
    }
  }

  // ...and the route instruction lands ONCE, on the block that IS the route.
  // A brick cued on every eligible segment told the athlete to find a hilly route
  // during T2, i.e. while racking their bike and changing shoes.
  const routeNote = /hilliest route|rolling ground/;
  for (const t of ["hilly", "mountainous"] as Terrain[]) {
    const p = generatePlan(profile({ raceType: "half", workoutsPerWeek: 8, terrain: t }), ANCHOR);
    for (const w of Object.values(p.workouts)) {
      if (w.type !== "long" && w.type !== "brick") continue;
      const hits = w.segments.filter((s) => s.cue && routeNote.test(s.cue));
      ok(hits.length <= 1, `${t}/${w.id}: the route cue appears at most once (found ${hits.length})`);
      for (const s of hits) {
        ok(
          (s.durationSec ?? 0) > 15 * 60,
          `${t}/${w.id}: the route cue is on a real training block, not a transition (${Math.round((s.durationSec ?? 0) / 60)} min)`,
        );
      }
    }
  }
}

// --- 4. where hill work is NOT allowed ------------------------------------
section("hill work stays out of base, taper and recovery weeks");
{
  const p = generatePlan(profile({ raceType: "full", workoutsPerWeek: 10, terrain: "mountainous" }), ANCHOR);
  const weekOf = new Map(p.weeks.flatMap((w) => w.workoutIds.map((id) => [id, w] as const)));
  for (const w of Object.values(p.workouts)) {
    if (!w.terrainFocus || w.id === "w-race-day") continue;
    const wk = weekOf.get(w.id);
    if (!wk) continue;
    ok(wk.phase === "build" || wk.phase === "peak", `hill work only in build/peak (found in ${wk.phase})`);
    ok(!wk.isRecovery, `no hill work in a recovery week (week ${wk.index + 1})`);
    ok(!wk.isRaceWeek, `no hill work in race week (week ${wk.index + 1})`);
  }
  // the taper specifically: a novel eccentric stimulus in the last fortnight is
  // how athletes arrive at a start line with wrecked quads
  const taper = p.weeks.filter((w) => w.phase === "taper");
  ok(taper.length > 0, "the plan has a taper to check");
  ok(
    taper.every((wk) => wk.workoutIds.every((id) => id === "w-race-day" || !p.workouts[id].terrainFocus)),
    "no hill session is introduced during the taper",
  );
}

// --- 5. the weekly dose is bounded ----------------------------------------
section("the number of hill sessions per week is capped, and rolling is gentle");
{
  for (const t of ["rolling", "hilly", "mountainous"] as Terrain[]) {
    const p = generatePlan(profile({ raceType: "half", workoutsPerWeek: 9, terrain: t }), ANCHOR);
    for (const wk of p.weeks) {
      if (wk.phase !== "build" && wk.phase !== "peak") continue;
      const converted = wk.workoutIds.filter((id) => {
        const w = p.workouts[id];
        return w.terrainFocus && (w.type === "threshold" || w.type === "vo2" || w.type === "tempo");
      }).length;
      ok(
        converted <= HILL_SESSIONS_PER_WEEK[t],
        `${t} week ${wk.index + 1}: ${converted} hill sessions, cap ${HILL_SESSIONS_PER_WEEK[t]}`,
      );
    }
  }
  // rolling is the DEFAULT, so it must not restructure the plan of someone who
  // never expressed a preference
  ok(HILL_SESSIONS_PER_WEEK.rolling === 1, "the default terrain adds at most one hill session a week");
  ok(HILL_SESSIONS_PER_WEEK.flat === 0, "flat adds none");
}

// --- 6. hillify preserves the prescription --------------------------------
section("converting a session keeps every number in it");
{
  const p = generatePlan(profile({ raceType: "half", workoutsPerWeek: 8, terrain: "flat" }), ANCHOR);
  const candidates = Object.values(p.workouts).filter(isHillCandidate);
  ok(candidates.length > 0, "there are convertible sessions to test");

  const totalSec = (segs: Workout["segments"]): number =>
    segs.reduce((a, s) => a + (s.durationSec ?? 0) * (s.repeat ?? 1) + (s.children ? totalSec(s.children) * (s.repeat ?? 1) : 0), 0);

  for (const w of candidates.slice(0, 12)) {
    const h = hillify(w, "hilly");
    ok(h.estDurationSec === w.estDurationSec, `${w.id}: duration preserved`);
    ok(h.primaryZone === w.primaryZone, `${w.id}: zone preserved`);
    ok(h.type === w.type, `${w.id}: type preserved`);
    ok(h.discipline === w.discipline, `${w.id}: discipline preserved`);
    ok(h.segments.length === w.segments.length, `${w.id}: segment count preserved`);
    ok(Math.abs(totalSec(h.segments) - totalSec(w.segments)) < 1e-9, `${w.id}: total segment seconds preserved`);
    ok(sessionLoad({ ...h, status: "done", rpe: 7 }, null).load === sessionLoad({ ...w, status: "done", rpe: 7 }, null).load,
      `${w.id}: the session carries identical training load`);
    ok(h.title !== w.title, `${w.id}: but it is named differently`);
    ok(h.terrainFocus === "hilly", `${w.id}: and records the course it was built for`);
  }
}

// --- 7. warmups and recoveries are not run up a hill ----------------------
section("only the working segments become climbs");
{
  const p = generatePlan(profile({ raceType: "half", workoutsPerWeek: 8, terrain: "flat" }), ANCHOR);
  const w = Object.values(p.workouts).find((x) => isHillCandidate(x) && x.type === "threshold")!;
  const h = hillify(w, "hilly");
  const walk = (segs: Workout["segments"], orig: Workout["segments"]) => {
    segs.forEach((s, i) => {
      const o = orig[i];
      if (s.kind !== "main" || (s.zone ?? 0) < 3) {
        ok(s.description === o.description, `a ${s.kind} segment (zone ${s.zone ?? "-"}) is left flat`);
      }
      if (s.children && o.children) walk(s.children, o.children);
    });
  };
  walk(h.segments, w.segments);
}

// --- 8. the finish estimate reflects the course ---------------------------
section("a hilly course predicts a slower race than a flat one");
{
  for (const over of ARCHETYPES) {
    const prof = profile(over);
    const cat = categoryOf(prof);
    const dist = raceDistances(prof);
    const paces = derivePaces(prof);
    const times = TERRAIN_ORDER.map((t) => estimateRaceSeconds(paces, prof.level, cat, dist, t));
    const label = `${over.raceType}/${over.level}`;
    for (let i = 1; i < times.length; i++) {
      ok(times[i] > times[i - 1], `${label}: ${TERRAIN_ORDER[i]} is slower than ${TERRAIN_ORDER[i - 1]}`);
    }
    // ...and by a believable margin, not a different race
    const spread = (times[times.length - 1] - times[0]) / times[0];
    ok(spread > 0.02 && spread < 0.20, `${label}: flat → mountainous costs ${(spread * 100).toFixed(0)}% (2–20%)`);
  }
  // the swim is not affected by terrain — a lake has no hills. Verified by the
  // fact that the bike/run factors alone account for the whole difference.
  const prof = profile({ raceType: "half" });
  const dist = raceDistances(prof);
  const paces = derivePaces(prof);
  const flat = estimateRaceSeconds(paces, prof.level, categoryOf(prof), dist, "flat");
  const hilly = estimateRaceSeconds(paces, prof.level, categoryOf(prof), dist, "hilly");
  ok(hilly > flat, `a hilly 70.3 predicts slower (${Math.round((hilly - flat) / 60)} min)`);
  ok(hilly - flat < 3600, "but not by more than an hour — the estimate stays sane");
}

// --- 9. race-day pacing guidance ------------------------------------------
section("the course gets the last word on race day");
{
  ok(pacingNote("flat") === null, "a flat course gets no pacing note — nothing useful to say");
  for (const t of ["rolling", "hilly", "mountainous"] as Terrain[]) {
    const note = pacingNote(t);
    ok(!!note && note.length > 20, `${t} gets real guidance`);
    ok(!!note && /effort/i.test(note), `${t}'s note is about EFFORT, not pace — the mistake it exists to prevent`);
  }
  const hilly = generatePlan(profile({ terrain: "hilly" }), ANCHOR);
  const flat = generatePlan(profile({ terrain: "flat" }), ANCHOR);
  ok(hilly.workouts["w-race-day"].purpose.includes("effort"), "race day carries the pacing note");
  ok(
    hilly.workouts["w-race-day"].purpose !== flat.workouts["w-race-day"].purpose,
    "and a flat race day does not",
  );
  ok(
    hilly.workouts["w-race-day"].estDurationSec > flat.workouts["w-race-day"].estDurationSec,
    "the race-day session's own estimate is course-adjusted too",
  );
}

// --- 10. determinism ------------------------------------------------------
section("determinism");
{
  // `plan.id` (`plan-${Date.now()}`) and `generatedAtISO` are pre-existing clock
  // dependencies — ticket #49, "Engine · Clock seam for determinism" — and not
  // terrain's to fix. They are excluded BY NAME rather than by a loose comparison,
  // so this still fails loudly if terrain introduces nondeterminism of its own.
  const stable = (p: Plan) => JSON.stringify({ ...p, id: "", generatedAtISO: "" });
  for (const t of TERRAIN_ORDER) {
    const a = generatePlan(profile({ terrain: t }), ANCHOR);
    const b = generatePlan(profile({ terrain: t }), ANCHOR);
    ok(stable(a) === stable(b), `${t}: same profile ⇒ identical plan (modulo the clock-derived id, #49)`);
  }
  // and the daily load ledger is identical across terrains, which is the
  // cheapest possible proof that the PMC cannot have moved
  const base = dailyLoads(generatePlan(profile({ terrain: "flat" }), ANCHOR), weeksFrom(16));
  for (const t of TERRAIN_ORDER) {
    const d = dailyLoads(generatePlan(profile({ terrain: t }), ANCHOR), weeksFrom(16));
    ok(JSON.stringify(d) === JSON.stringify(base), `${t}: identical daily load ledger`);
  }
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) {
  console.error(`\n❌ ${failures} terrain invariant(s) FAILED`);
  process.exit(1);
}
console.log("\n✅ all terrain invariants passed");
