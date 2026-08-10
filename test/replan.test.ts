// ---------------------------------------------------------------------------
// The plan responds to what you CHANGE (lib/replan.ts).
//
// Ryan, after swapping a run for a bike: "the plan updates only when you do the
// activity? i don't like this, it should change when we manually modify the
// workout too."
//
// He was right, and the cause was structural: represcribe reads the load LEDGER,
// which credits nothing until a session is done. Measured on a real plan, the
// deviation was 35.72% before a swap and 35.72% after — the responder could not
// see the edit at all.
//
// The properties that matter here are not "does it react" but "does it react to
// the right thing, in the right direction, without breaking the week":
//   - an untouched week must read EXACTLY zero, or the signal has a false floor
//   - a swap is volume-neutral and quality-destructive, so volume alone misses it
//   - making the week harder must ease around it; making it lighter must NOT
//     hand the time back
//   - relocating quality must stay volume-neutral, must not manufacture
//     back-to-back hard days, and must never leave a session whose title
//     contradicts its sport
//
// Pure, no clock, no I/O. Run: npx tsx test/replan.test.ts
// ---------------------------------------------------------------------------

import { generatePlan } from "../lib/planEngine";
import { swapDiscipline, setStatus } from "../lib/adapt";
import { adjustSession } from "../lib/prescribe";
import { checkRails } from "../lib/rails";
import { hardDayConflicts } from "../lib/respond";
import { DISCIPLINE_META } from "../lib/zones";
import {
  EDIT_HARD_DEADBAND,
  EDIT_VOL_DEADBAND,
  designedOf,
  respondToEdit,
  weekDrift,
} from "../lib/replan";
import type { Plan, Profile, Week } from "../lib/types";

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

const ANCHOR = "2026-06-15";
const d = (n: number) => {
  const x = new Date(ANCHOR + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
function profile(wpw: number, perSport: Record<string, number>): Profile {
  return {
    username: "test", raceType: "half", raceDateISO: d(112), level: "intermediate",
    workoutsPerWeek: wpw, createdAtISO: ANCHOR, perSport,
  } as unknown as Profile;
}

const ARCHETYPES: Array<[number, Record<string, number>]> = [
  [4, { swim: 1, bike: 2, run: 1 }],
  [5, { swim: 1, bike: 2, run: 2 }],
  [6, { swim: 2, bike: 2, run: 2 }],
  [8, { swim: 2, bike: 3, run: 3 }],
  [9, { swim: 2, bike: 4, run: 3 }],
  [10, { swim: 3, bike: 4, run: 3 }],
];

const plan8 = generatePlan(profile(8, { swim: 2, bike: 3, run: 3 }), ANCHOR);
const week8 = plan8.weeks[7];
const TODAY = week8.startDate;
const wkOf = (p: Plan, i: number): Week => p.weeks.find((w) => w.index === i)!;
const inWeek = (p: Plan, wk: Week) => wk.workoutIds.map((id) => p.workouts[id]).filter(Boolean);

// --- 1. the signal has no false floor -------------------------------------
section("an untouched week reads exactly zero on both axes");
{
  for (const [wpw, ps] of ARCHETYPES) {
    const p = generatePlan(profile(wpw, ps), ANCHOR);
    for (const wk of p.weeks) {
      const dr = weekDrift(p, wk);
      ok(Math.abs(dr.volPct) < 1e-9, `${wpw}/wk week ${wk.index + 1}: volume drift is 0 (got ${dr.volPct.toFixed(4)})`);
      ok(Math.abs(dr.hardPct) < 1e-9, `${wpw}/wk week ${wk.index + 1}: quality drift is 0 (got ${dr.hardPct.toFixed(4)})`);
    }
  }
  // ...and therefore nothing to respond to
  const any = inWeek(plan8, week8).find((w) => w.status === "planned" && w.discipline !== "rest")!;
  ok(respondToEdit(plan8, TODAY, any.id) === null, "an untouched plan produces no response at all");
}

// --- 2. the design is recovered exactly, not inferred ----------------------
section("the design survives every kind of edit");
{
  const hard = inWeek(plan8, week8).find((w) => w.primaryZone >= 4 && w.status === "planned")!;
  const before = designedOf(hard);

  const swapped = swapDiscipline(plan8, hard.id, "bike");
  ok(designedOf(swapped.workouts[hard.id]).zone === before.zone, "a swap still reports the zone it was designed at");
  ok(designedOf(swapped.workouts[hard.id]).sec === before.sec, "...and the length");

  const easy = inWeek(plan8, week8).find((w) => w.primaryZone <= 2 && w.discipline !== "rest" && w.status === "planned")!;
  const adj = adjustSession(plan8, easy.id, Math.round(easy.estDurationSec * 0.5));
  if (adj) {
    ok(
      designedOf(adj.plan.workouts[easy.id]).sec === designedOf(easy).sec,
      "a resize still reports its designed length",
    );
  }
}

// --- 3. THE CASE THAT PROMPTED THIS ---------------------------------------
section("swapping a hard session is seen, even though volume didn't move");
{
  const hard = inWeek(plan8, week8).find((w) => w.primaryZone >= 4 && w.status === "planned")!;
  const swapped = swapDiscipline(plan8, hard.id, "bike");
  const dr = weekDrift(swapped, wkOf(swapped, week8.index));

  ok(Math.abs(dr.volPct) < 1, `a swap is volume-neutral (${dr.volPct.toFixed(1)}%) — volume alone would miss it`);
  ok(dr.hardPct < -EDIT_HARD_DEADBAND, `but the week lost ${Math.abs(dr.hardPct).toFixed(0)}% of its hard work`);

  const res = respondToEdit(swapped, TODAY, hard.id);
  ok(!!res, "and the plan has something to say about it — the silence Ryan hit is gone");
  ok(!!res && res.headline.length > 0, "with a sentence explaining it");
}

// --- 4. direction: harder acts, lighter reports ---------------------------
section("adding load is absorbed; removing it is respected");
{
  const easy = inWeek(plan8, week8).find((w) => w.primaryZone <= 2 && w.discipline !== "rest" && w.status === "planned")!;

  const longer = adjustSession(plan8, easy.id, Math.round(easy.estDurationSec * 1.5));
  ok(!!longer, "an easy session can be lengthened 50%");
  if (longer) {
    const res = respondToEdit(longer.plan, TODAY, easy.id);
    ok(!!res && res.changedIds.length > 0, "the week eases around a session the athlete lengthened");
    if (res) {
      ok(!res.changedIds.includes(easy.id), "and never touches the session they just set");
      const after = weekDrift(res.plan, wkOf(res.plan, week8.index));
      const beforeDr = weekDrift(longer.plan, wkOf(longer.plan, week8.index));
      ok(after.volPct < beforeDr.volPct, `the week moves back toward its design (${beforeDr.volPct.toFixed(1)}% → ${after.volPct.toFixed(1)}%)`);

      // CONVERGENCE: re-running must not keep shaving the week down
      const again = respondToEdit(res.plan, TODAY, easy.id);
      ok(!again || again.changedIds.length === 0, "re-applying converges instead of ratcheting");
    }
  }

  const shorter = adjustSession(plan8, easy.id, Math.round(easy.estDurationSec * 0.5));
  ok(!!shorter, "an easy session can be halved");
  if (shorter) {
    const res = respondToEdit(shorter.plan, TODAY, easy.id);
    // You shortened it because you were busy. Handing the time back elsewhere is
    // the app arguing with you — it says so instead.
    ok(!!res && res.changedIds.length === 0, "shortening a session moves nothing else — it is reported, not undone");
    ok(!!res && /lighter/i.test(res.headline), "and the athlete is told the week is lighter");
  }
}

// --- 5. relocation is volume-neutral and safe -----------------------------
section("relocated quality keeps the week's shape, across every archetype");
{
  let relocated = 0;
  let reported = 0;
  for (const [wpw, ps] of ARCHETYPES) {
    const p = generatePlan(profile(wpw, ps), ANCHOR);
    for (const wk of p.weeks) {
      if (wk.isRaceWeek) continue;
      const today = wk.startDate;
      for (const w of inWeek(p, wk)) {
        if (w.primaryZone < 4 || w.status !== "planned" || w.discipline === "rest") continue;
        const swapped = swapDiscipline(p, w.id, "bike");
        const res = respondToEdit(swapped, today, w.id);
        if (!res) continue;
        if (!res.changedIds.length) {
          reported++;
          ok(res.plan === swapped, "a report-only response leaves the plan untouched");
          continue;
        }
        relocated++;
        const id = res.changedIds[0];
        const was = swapped.workouts[id];
        const now = res.plan.workouts[id];

        ok(now.estDurationSec === was.estDurationSec, `${wpw}/wk ${id}: relocation is volume-neutral`);
        ok(now.primaryZone > was.primaryZone, `${wpw}/wk ${id}: the receiver actually got harder`);
        ok(now.discipline === was.discipline, `${wpw}/wk ${id}: the receiver keeps its own sport`);
        // the bug this caught: a swim titled "Run Threshold 5×1km"
        ok(
          now.title.includes(DISCIPLINE_META[now.discipline].label),
          `${wpw}/wk ${id}: the title names the sport it actually is ("${now.title}" on a ${now.discipline})`,
        );
        ok(id !== w.id, `${wpw}/wk: never relocates onto the session the athlete just edited`);
        ok(
          checkRails(res.plan).violations.length <= checkRails(swapped).violations.length,
          `${wpw}/wk ${id}: introduces no rail violation`,
        );
        ok(
          hardDayConflicts(res.plan, today).length <= hardDayConflicts(swapped, today).length,
          `${wpw}/wk ${id}: never manufactures back-to-back hard days`,
        );
      }
    }
  }
  ok(relocated > 0, `the relocation path actually runs (${relocated} cases)`);
  ok(reported > 0, `and the "nowhere to put it" path does too (${reported} cases)`);
}

// --- 6. what it must never touch ------------------------------------------
section("boundaries");
{
  const hard = inWeek(plan8, week8).find((w) => w.primaryZone >= 4 && w.status === "planned")!;
  const swapped = swapDiscipline(plan8, hard.id, "bike");

  // never reaches into the past
  const laterToday = week8.startDate;
  const res = respondToEdit(swapped, laterToday, hard.id);
  if (res) {
    for (const id of res.changedIds) {
      ok(res.plan.workouts[id].date >= laterToday, `${id} is not in the past`);
    }
  }

  // race week is left alone entirely
  const raceWeek = plan8.weeks.find((w) => w.isRaceWeek);
  if (raceWeek) {
    const rw = inWeek(plan8, raceWeek).find((w) => w.status === "planned" && w.discipline !== "rest");
    if (rw) ok(respondToEdit(plan8, raceWeek.startDate, rw.id) === null, "race week never responds");
  }

  ok(respondToEdit(plan8, TODAY, "no-such-session") === null, "an unknown session is refused");

  // skipping is seen, and never answered by adding load back
  const skipped = setStatus(plan8, hard.id, "skipped");
  const sres = respondToEdit(skipped, TODAY, hard.id);
  if (sres) {
    for (const id of sres.changedIds) {
      const was = skipped.workouts[id];
      const now = sres.plan.workouts[id];
      ok(
        now.estDurationSec <= was.estDurationSec || now.primaryZone > was.primaryZone,
        `${id}: a skip is never answered with more volume`,
      );
    }
  }
}

// --- 7. the deadbands are where the measurements put them ------------------
section("deadbands");
{
  ok(EDIT_VOL_DEADBAND < 5, `volume deadband (${EDIT_VOL_DEADBAND}%) sits below a real single-session edit (5.2–5.4%)`);
  ok(EDIT_HARD_DEADBAND < 36, `quality deadband (${EDIT_HARD_DEADBAND}%) sits below the ~36% a swap costs`);
  ok(EDIT_VOL_DEADBAND > 0 && EDIT_HARD_DEADBAND > 0, "and neither is zero, so trivial edits stay quiet");
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) {
  console.error(`\n❌ ${failures} replan invariant(s) FAILED`);
  process.exit(1);
}
console.log("\n✅ all replan invariants passed");
