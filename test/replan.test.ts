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
import { swapDiscipline, setStatus, unswapDiscipline, easeUpcoming } from "../lib/adapt";
import { adjustSession, scaleWorkout } from "../lib/prescribe";
import { checkRails } from "../lib/rails";
import { hardDayConflicts, respondTo } from "../lib/respond";
import { DISCIPLINE_META } from "../lib/zones";
import {
  EDIT_HARD_DEADBAND,
  EDIT_VOL_DEADBAND,
  designedOf,
  respondToEdit,
  sportDrift,
  weekDrift,
} from "../lib/replan";
import { RESTORE_GROWTH_TOLERANCE_SEC } from "../lib/equilibrium";
import type { Discipline, Plan, Profile, Week } from "../lib/types";

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
        // A response can now carry TWO kinds of change, and they have different
        // contracts: a SPORT restoration changes discipline (and may resize, since
        // swapAllowance caps it on impact), a QUALITY relocation keeps the sport and
        // duration and only raises the zone. Asserting one contract on both is how
        // this test started failing when sport balance landed.
        for (const id of res.changedIds) {
          const was = swapped.workouts[id];
          const now = res.plan.workouts[id];
          ok(id !== w.id, `${wpw}/wk: never changes the session the athlete just edited`);
          ok(
            now.title.includes(DISCIPLINE_META[now.discipline].label) || now.discipline === was.discipline,
            `${wpw}/wk ${id}: the title names the sport it actually is ("${now.title}" on a ${now.discipline})`,
          );
          if (now.discipline !== was.discipline) {
            // Sport restoration — volume may shrink under the impact cap, and may
            // round UP by a few minutes because every session builder has its own
            // granularity (the swim rounds its main set to whole 100 m blocks; the
            // bike will not build below its 40-minute floor). This used to assert
            // exact non-growth, which no builder can honour — so the restoration was
            // simply refused in those cases and the week stayed a sport short, which
            // is the bug Ryan reported. The contract is that it never grows
            // MATERIALLY, and the bound is a named constant rather than a hope.
            ok(
              now.estDurationSec <= was.estDurationSec + RESTORE_GROWTH_TOLERANCE_SEC,
              `${wpw}/wk ${id}: a restored sport never materially adds time (${Math.round(was.estDurationSec / 60)} → ${Math.round(now.estDurationSec / 60)} min)`,
            );
          } else {
            // quality relocation — volume-neutral, strictly harder
            ok(now.estDurationSec === was.estDurationSec, `${wpw}/wk ${id}: relocation is volume-neutral`);
            ok(now.primaryZone > was.primaryZone, `${wpw}/wk ${id}: the receiver actually got harder`);
          }
        }
        ok(
          checkRails(res.plan).violations.length <= checkRails(swapped).violations.length,
          `${wpw}/wk: introduces no rail violation`,
        );
        ok(
          hardDayConflicts(res.plan, today).length <= hardDayConflicts(swapped, today).length,
          `${wpw}/wk: never manufactures back-to-back hard days`,
        );
      }
    }
  }
  ok(relocated > 0, `the relocation path actually runs (${relocated} cases)`);
  ok(reported > 0, `and the "nowhere to put it" path does too (${reported} cases)`);
}

// --- 5b. SPORT BALANCE: the loophole Ryan named --------------------------
// "someone could get away with just biking all the time and never running."
// Volume and quality both survive that — the week keeps its hours and can keep
// its hard minutes — so this is the axis that actually closes it.
section("you cannot bike your way out of running");
{
  const p = generatePlan(profile(8, { swim: 2, bike: 3, run: 3 }), ANCHOR);
  const wk = p.weeks.find((w) => !w.isRecovery && !w.isRaceWeek && inWeek(p, w).some((x) => x.primaryZone >= 4))!;
  const today = wk.startDate;
  const runsIn = (q: Plan) => sportDrift(q, wkOf(q, wk.index)).run;

  ok(runsIn(p).current === runsIn(p).designed, "the week starts with its designed number of runs");

  // swap EVERY run away, one at a time, and the count must hold
  let cur: Plan = p;
  let swaps = 0;
  for (const id of [...wk.workoutIds]) {
    const w = cur.workouts[id];
    if (!w || w.discipline !== "run" || w.status !== "planned") continue;
    const swapped = swapDiscipline(cur, id, "bike");
    const res = respondToEdit(swapped, today, id);
    cur = res?.plan ?? swapped;
    swaps++;
    const r = runsIn(cur);
    ok(r.current >= r.designed, `after ${swaps} run→bike swaps the week still has its runs (${r.current}/${r.designed})`);
  }
  ok(swaps > 0, `there were runs to swap (${swaps})`);

  // SKIPPING is the same hole by another route
  const skipped = setStatus(p, inWeek(p, wk).find((w) => w.discipline === "run" && w.status === "planned")!.id, "skipped");
  const sres = respondToEdit(skipped, today, inWeek(p, wk).find((w) => w.discipline === "run")!.id);
  if (sres) {
    const r = runsIn(sres.plan);
    ok(r.current >= r.designed, `skipping a run is counteracted too (${r.current}/${r.designed})`);
  }

  // ...and it settles rather than ping-ponging between sports
  let settled: Plan = cur;
  const anyId = inWeek(settled, wkOf(settled, wk.index)).find((w) => w.status === "planned")!.id;
  for (let i = 0; i < 5; i++) {
    const res = respondToEdit(settled, today, anyId);
    ok(!res || res.changedIds.length === 0, `pass ${i + 1}: a settled week stops changing`);
    settled = res?.plan ?? settled;
  }

  // A SEVERE injury must outrank the sport count — never force someone back onto
  // a stress fracture to satisfy a number.
  const injured = generatePlan(
    { ...profile(8, { swim: 2, bike: 3, run: 3 }), injuries: [{ disciplines: ["run"], severity: "severe", area: "shin" }] } as unknown as Profile,
    ANCHOR,
  );
  const iwk = injured.weeks.find((w) => w.index === wk.index)!;
  const irun = inWeek(injured, iwk).find((w) => w.discipline === "run" && w.status === "planned");
  if (irun) {
    const res = respondToEdit(swapDiscipline(injured, irun.id, "bike"), iwk.startDate, irun.id);
    const restoredRun = res?.changedIds.some((id) => res.plan.workouts[id].discipline === "run");
    ok(!restoredRun, "a severe run injury is never overruled to restore a run");
  } else {
    ok(true, "a severe run injury leaves no running in the week to begin with");
  }

  // Restoring a sport must never ADD time — it is a relocation, not a top-up.
  // This caught a live bug: swapping a 133 min ride to a swim produced a 214 min,
  // 11,000 m swim, because replacementDraft sized swims at 1.3 m/s (1:17/100m).
  for (const [wpw, ps] of ARCHETYPES) {
    const q = generatePlan(profile(wpw, ps), ANCHOR);
    for (const w of Object.values(q.workouts)) {
      if (w.status !== "planned" || w.discipline === "rest") continue;
      for (const to of ["swim", "bike", "run"] as const) {
        if (to === w.discipline) continue;
        const made = swapDiscipline(q, w.id, to).workouts[w.id];
        if (made.discipline !== to) continue;
        // Two legitimate reasons a replacement can be longer: rounding to whole
        // blocks, and a floor — a swim still needs a warm-up and a cool-down, so
        // a 26 min session becomes a ~35 min swim rather than a pointless one.
        // Beyond that it's the 1.6× bug: a 133 min ride became a 214 min swim.
        const MIN_VIABLE_SEC = 36 * 60;
        ok(
          made.estDurationSec <= Math.max(w.estDurationSec * 1.15, MIN_VIABLE_SEC),
          `${wpw}/wk swap ${w.discipline}→${to}: ${Math.round(w.estDurationSec / 60)} min becomes ${Math.round(made.estDurationSec / 60)} min, not wildly more`,
        );
      }
    }
  }
}

// --- 6. what it must never touch ------------------------------------------
// A session must never advertise a speed no human produces. The specific failure
// (#201, Ryan: "How can I do 15k in 35 mins") was NOT the swap — it was the
// baseline the swap left behind. `prescribed` is what every later resize measures
// against, and it still described the sport that had just been replaced, so
// `scaleWorkout`'s `baseline.estDistanceM × ratio` rebuilt the RUN's distance from
// the BIKE's. Any ease after the swap resurrected it.
section("a swapped session never inherits the old sport's distance");
{
  // km/h a human can actually sustain for a training session, generously bounded.
  const SANE: Record<string, [number, number]> = { run: [5, 26], bike: [10, 60], swim: [1, 9] };
  const insane = (p: Plan) =>
    Object.values(p.workouts).filter((w) => {
      const lim = SANE[w.discipline];
      if (!lim || !w.estDistanceM || !w.estDurationSec) return false;
      const kmh = w.estDistanceM / 1000 / (w.estDurationSec / 3600);
      return kmh < lim[0] || kmh > lim[1];
    });

  ok(insane(plan8).length === 0, `a fresh plan implies no impossible speeds (got ${insane(plan8).length})`);

  // The exact reproduction, in both directions and for every sport pair.
  for (const [from, to] of [
    ["bike", "run"],
    ["run", "bike"],
    ["bike", "swim"],
    ["swim", "run"],
    ["run", "swim"],
    ["swim", "bike"],
  ] as Array<[Discipline, Discipline]>) {
    const victim = Object.values(plan8.workouts).find(
      (w) => w.discipline === from && w.status === "planned" && w.estDurationSec >= 30 * 60,
    );
    if (!victim) continue;
    // 1) the athlete resizes it — this is what mints `prescribed`
    const resized = adjustSession(plan8, victim.id, Math.round(victim.estDurationSec * 0.8));
    const base = resized?.plan ?? plan8;
    // 2) they swap the sport
    const swapped = swapDiscipline(base, victim.id, to);
    const madeIt = swapped.workouts[victim.id];
    ok(
      madeIt.prescribed === undefined,
      `${from}→${to}: the swap clears the baseline minted for the sport that left`,
    );
    ok(insane(swapped).length === 0, `${from}→${to}: the swap itself implies no impossible speed`);
    // 3) anything that RESIZES it afterwards must not resurrect the old sport's
    //    size. This is the assertion that catches the user-visible symptom: the
    //    week rebalance in respondToEdit scales pool sessions through exactly this
    //    call, and easeUpcoming alone doesn't reach an easy session, so asserting
    //    only through easeUpcoming would let the bug back in.
    const rescaled = scaleWorkout(madeIt, 0.9);
    if (rescaled?.estDistanceM && rescaled.estDurationSec) {
      const kmh = rescaled.estDistanceM / 1000 / (rescaled.estDurationSec / 3600);
      const lim = SANE[rescaled.discipline];
      ok(
        !lim || (kmh >= lim[0] && kmh <= lim[1]),
        `${from}→${to}: resizing after the swap stays possible — got ${(rescaled.estDistanceM / 1000).toFixed(1)}km in ${Math.round(rescaled.estDurationSec / 60)}min = ${kmh.toFixed(1)} km/h`,
      );
    }
    const eased = easeUpcoming(swapped, TODAY, 7, "manual");
    const bad = insane(eased);
    ok(
      bad.length === 0,
      `${from}→${to}: an ease after the swap keeps every session possible${
        bad.length ? ` — ${bad[0].title} ${(bad[0].estDistanceM! / 1000).toFixed(1)}km in ${Math.round(bad[0].estDurationSec / 60)}min` : ""
      }`,
    );
  }

  // And undoing a swap must not leave the incoming sport's baseline behind either.
  const r = Object.values(plan8.workouts).find((w) => w.discipline === "run" && w.status === "planned");
  if (r) {
    const there = swapDiscipline(plan8, r.id, "bike");
    const back = unswapDiscipline(there, r.id);
    ok(back.workouts[r.id].prescribed === undefined, "unswapping clears the baseline too");
    ok(insane(easeUpcoming(back, TODAY, 7, "manual")).length === 0, "...and easing after an unswap stays possible");
  }
}

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

// --- 6b. #219 — a restoration relocates a session, it never deletes one -----
//
// `swapDiscipline` never refuses: it fits the replacement to the week's remaining
// mechanical-impact headroom and falls back to a 20-minute floor when there is none.
// Correct for a swap the athlete asked for; wrong for one the responder does on its
// own. Reported as "Why did my 1h bike turn into a 20 min run" — and the week had
// silently lost forty minutes to fix a sport count.
section("an automatic sport restoration never guts the session it converts");
{
  const CASES: { name: string; wpw: number; perSport: Record<string, number> }[] = [
    { name: "6/wk balanced", wpw: 6, perSport: { swim: 2, bike: 2, run: 2 } },
    { name: "9/wk balanced", wpw: 9, perSport: { swim: 3, bike: 3, run: 3 } },
    { name: "8/wk bike-heavy", wpw: 8, perSport: { swim: 2, bike: 4, run: 2 } },
    { name: "5/wk light", wpw: 5, perSport: { swim: 1, bike: 2, run: 2 } },
  ];
  let converted = 0;
  for (const c of CASES) {
    const plan = generatePlan(profile(c.wpw, c.perSport), ANCHOR);
    const today = d(2);
    const runs = Object.values(plan.workouts).filter(
      (w) => w.date >= today && w.discipline === "run" && w.status === "planned",
    );
    for (const run of runs.slice(0, 4)) {
      const swapped = swapDiscipline(plan, run.id, "bike");
      const res = respondTo(swapped, today, { kind: "swapped", workoutId: run.id });
      const after = res?.plan ?? swapped;
      for (const [id, w] of Object.entries(after.workouts)) {
        const was = swapped.workouts[id];
        if (!was || id === run.id || was.discipline === w.discipline) continue;
        converted++;
        ok(
          w.estDurationSec >= was.estDurationSec * 0.7,
          `${c.name}: ${was.title} ${Math.round(was.estDurationSec / 60)}min ${was.discipline} -> ` +
            `${Math.round(w.estDurationSec / 60)}min ${w.discipline} keeps >=70% of the session`,
        );
      }
    }
  }
  ok(converted > 0, `the sweep actually exercised some conversions (${converted})`);
}

// --- 7. the deadbands are where the measurements put them ------------------
section("deadbands");
{
  ok(EDIT_VOL_DEADBAND < 5, `volume deadband (${EDIT_VOL_DEADBAND}%) sits below a real single-session edit (5.2–5.4%)`);
  ok(EDIT_HARD_DEADBAND < 36, `quality deadband (${EDIT_HARD_DEADBAND}%) sits below the ~36% a swap costs`);
  ok(EDIT_VOL_DEADBAND > 0 && EDIT_HARD_DEADBAND > 0, "and neither is zero, so trivial edits stay quiet");
}

// --- a skip must not MASK a later edit in the same week ---------------------
//
// A skipped session used to count on the designed side of the drift and not the current
// side, so it read as a permanent deficit that NETTED against anything done afterwards.
// Measured on device: skip a 60 min run on Tuesday, lengthen Friday's run by 28 min, and
// the week came out at -2% — inside the deadband — so the responder saw "on plan" and did
// nothing, while the truth was a lost Z5 session plus half an hour of extra easy volume.
section("a skip is drift-neutral, and never hides a later change");
{
  const plan = generatePlan(profile(6, { swim: 2, bike: 2, run: 2 }), ANCHOR);
  const today = d(2);
  const week = plan.weeks.find((w) => w.index === 1)!;
  const base = weekDrift(plan, week);
  ok(Math.abs(base.volPct) < 0.001, `an untouched week measures 0 (${base.volPct.toFixed(2)}%)`);

  const victim = week.workoutIds
    .map((id) => plan.workouts[id]!)
    .find((w) => w && w.status === "planned" && w.discipline !== "rest" && w.date >= today)!;
  const skipped = setStatus(plan, victim.id, "skipped");
  const afterSkip = weekDrift(skipped, week);
  ok(
    Math.abs(afterSkip.volPct) < 0.001,
    `a skip leaves the comparison entirely (${afterSkip.volPct.toFixed(2)}%, was ${base.volPct.toFixed(2)}%)`,
  );

  // Now lengthen a DIFFERENT session in the same week. The property is not that any
  // particular edit clears the deadband — that depends on how big the session is — but
  // that the skip contributes NOTHING to the measurement. Drift after the edit must be
  // identical whether or not a session was skipped first; that identity is exactly what
  // was broken, and it is what let a skip swallow a later change.
  const other = week.workoutIds
    .map((id) => skipped.workouts[id]!)
    .find((w) => w && w.status === "planned" && w.discipline !== "rest" && w.id !== victim.id && !!w.segments?.length)!;
  if (other) {
    const longer = scaleWorkout(other, 1.5, { allowLonger: true });
    if (longer && longer.estDurationSec > other.estDurationSec) {
      const withSkip: Plan = { ...skipped, workouts: { ...skipped.workouts, [other.id]: longer } };
      const noSkip: Plan = { ...plan, workouts: { ...plan.workouts, [other.id]: longer } };
      const a = weekDrift(withSkip, week).volPct;
      const b = weekDrift(noSkip, week).volPct;
      // Not identical — dropping the skipped session shrinks the denominator, so the same
      // edit is a slightly LARGER share of what is left. That is correct. The property is
      // directional: a skip may never make a subsequent addition measure smaller, and can
      // certainly never flip its sign, which is how +28 min used to read as -2%.
      ok(
        a >= b - 0.001,
        `an earlier skip never shrinks a later addition (${a.toFixed(2)}% with, ${b.toFixed(2)}% without)`,
      );
      ok(a > 0, `and the addition still reads as MORE work, not less (${a.toFixed(2)}%)`);
    } else {
      ok(true, "that session could not be lengthened (vacuous)");
    }
  }
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) {
  console.error(`\n❌ ${failures} replan invariant(s) FAILED`);
  process.exit(1);
}
console.log("\n✅ all replan invariants passed");
