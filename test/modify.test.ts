// ---------------------------------------------------------------------------
// Modifying a session by distance and by pace (lib/modify.ts) — ticket #185.
//
// The product decision under test: editing PACE is not cosmetic. Say you'll ride
// today's Zone 2 endurance session at threshold and the session IS a threshold
// session — the zone moves and the load moves with it.
//
// Which makes the safety property the important one. A pace control is the
// cheapest way in the whole app to add load: six taps could turn a base block
// into a threshold block. So a pace edit gets exactly the privileges every other
// adaptation gets and no more — `railsRegressed` has the final say, and a change
// it refuses must leave the plan untouched rather than half-applied.
//
// The second property is honesty about what CAN'T be done. Most athletes never
// enter an FTP, there is no bike speed model anywhere in the codebase, and
// inventing one to accept a km/h target would be fabricating a prescription.
//
// Pure, no clock, no I/O. Run: npx tsx test/modify.test.ts
// ---------------------------------------------------------------------------

import { generatePlan } from "../lib/planEngine";
import { checkRails } from "../lib/rails";
import { respondTo } from "../lib/respond";
import { adjustChoices, adjustSession } from "../lib/prescribe";
import { sessionLoad } from "../lib/load";
import {
  canSetDistance,
  distanceChoices,
  distanceOptions,
  isAtDistance,
  isAtLength,
  lengthOptions,
  repaceSession,
  resizeByDistance,
  targetChoices,
  targetForZone,
  targetKindFor,
  targetLabel,
  targetUnavailableReason,
  zoneForTarget,
  reslotStrength,
} from "../lib/modify";
import { slotOf } from "../lib/routines";
import { fmtDistance } from "../lib/format";
import type { Plan, Profile, StrengthSlot, Workout, Zone } from "../lib/types";

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
    username: "test", raceType: "half", raceDateISO: weeksFrom(20),
    level: "intermediate", workoutsPerWeek: 8, createdAtISO: ANCHOR, ...over,
  } as Profile;
}

const plan = generatePlan(profile(), ANCHOR);
const withFtp = generatePlan(profile({ ftp: 240 }), ANCHOR);

const find = (p: Plan, fn: (w: Workout) => boolean) => Object.values(p.workouts).filter(fn);
const easyRun = find(plan, (w) => w.discipline === "run" && w.primaryZone <= 2 && w.status === "planned")[0];
const easyRide = find(withFtp, (w) => w.discipline === "bike" && w.primaryZone <= 2 && w.status === "planned")[0];

// --- 1. what can be given an intensity, and what honestly can't -------------
section("the pace control appears only where a real target exists");
{
  ok(!!easyRun, "there is an easy run to work with");
  ok(targetKindFor(easyRun, plan.paces) === "run-pace", "a run takes a pace target");

  const swim = find(plan, (w) => w.discipline === "swim" && w.status === "planned")[0];
  ok(targetKindFor(swim, plan.paces) === "swim-pace", "a swim takes a per-100m target");

  // THE HONEST GAP: no FTP ⇒ no bike zones in watts, and there is no bike speed
  // model anywhere. Offering a km/h box would be inventing a prescription.
  const rideNoFtp = find(plan, (w) => w.discipline === "bike" && w.status === "planned")[0];
  ok(plan.paces.bike.ftp == null, "the default athlete has no FTP (which is most athletes)");
  ok(targetKindFor(rideNoFtp, plan.paces) === null, "so a ride offers no intensity target at all");
  ok(
    (targetUnavailableReason(rideNoFtp, plan.paces) ?? "").includes("FTP"),
    "...and says why, rather than silently omitting the control (#130)",
  );
  ok(targetKindFor(easyRide, withFtp.paces) === "bike-power", "with an FTP, a ride takes a power target");
  ok(targetUnavailableReason(easyRide, withFtp.paces) === null, "and then there's nothing to explain");

  const rest = find(plan, (w) => w.discipline === "rest")[0];
  if (rest) ok(targetKindFor(rest, plan.paces) === null, "a rest day has no intensity to set");
  ok(targetKindFor(plan.workouts["w-race-day"], plan.paces) === null, "race day is not re-paceable");
}

// --- 2. a pace maps to the zone it actually is ------------------------------
section("a chosen pace resolves to the zone that pace really is");
{
  for (const z of [1, 2, 3, 4, 5] as Zone[]) {
    const v = targetForZone(plan.paces, "run-pace", z);
    ok(zoneForTarget(plan.paces, "run-pace", v) === z, `the middle of run Z${z} reads back as Z${z}`);
    const s = targetForZone(plan.paces, "swim-pace", z);
    ok(zoneForTarget(plan.paces, "swim-pace", s) === z, `the middle of swim Z${z} reads back as Z${z}`);
    const w = targetForZone(withFtp.paces, "bike-power", z);
    ok(zoneForTarget(withFtp.paces, "bike-power", w) === z, `the middle of bike Z${z} reads back as Z${z}`);
  }
  // faster pace ⇒ harder zone, monotonically
  const z1 = zoneForTarget(plan.paces, "run-pace", targetForZone(plan.paces, "run-pace", 1));
  const z5 = zoneForTarget(plan.paces, "run-pace", targetForZone(plan.paces, "run-pace", 5));
  ok(z5 > z1, "a faster pace is a harder zone");
  // absurd inputs land at the ends rather than throwing
  ok(zoneForTarget(plan.paces, "run-pace", 30) === 5, "a 0:30/km pace is Z5, not an error");
  ok(zoneForTarget(plan.paces, "run-pace", 3600) === 1, "an hour per km is Z1");

  // The bands have GAPS (run Z2 ends 5:53, Z3 starts 5:47). A pace in the gap has
  // to resolve to something, and it must resolve to the EASIER side — rounding a
  // between-zones pace up would silently add load the athlete didn't ask for.
  const gapLo = plan.paces.run.zones[3].hiSecPerKm; // fast edge of Z3's slow end
  const gapHi = plan.paces.run.zones[2].loSecPerKm; // slow edge of Z2's fast end
  ok(gapHi > gapLo, "there is a real gap between run Z2 and Z3 to test");
  const mid = (gapLo + gapHi) / 2;
  ok(zoneForTarget(plan.paces, "run-pace", mid) === 2, `a pace exactly between Z2 and Z3 reads as the EASIER zone`);
}

// --- 3. THE POINT: pace changes the session, and the load ------------------
section("saying you'll go faster makes it a harder session, for real");
{
  const hard = targetForZone(plan.paces, "run-pace", 4);
  const res = repaceSession(plan, easyRun.id, hard);
  ok(!!res, `an easy run re-paced to threshold is a real change`);
  if (res) {
    ok(res.workout.primaryZone === 4, `the session is now Zone 4 (was ${easyRun.primaryZone})`);
    ok(res.workout.pacedAt?.value === hard, "the chosen target is recorded on the session");

    // the load the plan will reason from has actually moved
    const before = sessionLoad({ ...easyRun, status: "done" }, null).load;
    const after = sessionLoad({ ...res.workout, status: "done" }, null).load;
    ok(after > before, `the session now carries more load (${before.toFixed(0)} → ${after.toFixed(0)})`);

    // duration is NOT changed by a pace edit — that's what the length control is for
    ok(res.workout.estDurationSec === easyRun.estDurationSec, "the session is the same length");

    // and the prescription is preserved so it can be put back
    ok(!!res.workout.prescribed, "the original prescription is kept");
    ok(
      JSON.stringify(res.workout.prescribed?.segments) === JSON.stringify(easyRun.segments),
      "...verbatim, so a later edit computes from the design, not from this edit",
    );
    ok(res.summary.length > 0 && /zone|endurance|threshold|recovery|vo/i.test(res.summary), "and it says what it did");
  }
}

// --- 4. the scaffolding of the session survives ----------------------------
section("re-pacing moves the work, not the warm-up");
{
  const interval = find(plan, (w) => w.discipline === "run" && w.type === "threshold" && w.status === "planned")[0];
  ok(!!interval, "there is an interval session to test");
  if (interval) {
    const easy = targetForZone(plan.paces, "run-pace", 2);
    const res = repaceSession(plan, interval.id, easy);
    ok(!!res, "a threshold run can be re-paced down to endurance");
    if (res) {
      const zonesOf = (segs: Workout["segments"]): number[] =>
        segs.flatMap((s) => [s.zone ?? 0, ...(s.children ? zonesOf(s.children) : [])]);
      const was = zonesOf(interval.segments);
      const now = zonesOf(res.workout.segments);
      ok(was.length === now.length, "the session keeps its structure");
      // every segment that was NOT the working zone is untouched
      was.forEach((z, i) => {
        if (z !== interval.primaryZone) {
          ok(now[i] === z, `a Z${z} segment (warm-up/recovery) is left alone`);
        }
      });
      ok(
        was.some((z, i) => z === interval.primaryZone && now[i] !== z),
        "and the working segments did move",
      );
      // descriptions are regenerated, never left contradicting the new zone
      const descs = (segs: Workout["segments"]): string[] =>
        segs.flatMap((s) => [s.description, ...(s.children ? descs(s.children) : [])]);
      const label = targetLabel("run-pace", easy);
      ok(
        descs(res.workout.segments).some((d) => d.includes(label)),
        `the steps state the chosen target (${label})`,
      );
      ok(
        !descs(res.workout.segments).some((d) => /\(Z\d\)/.test(d) && d.includes(label)),
        "and no step carries two prescriptions at once",
      );
    }
  }
}

// --- 5. THE SAFETY PROPERTY ------------------------------------------------
section("a pace edit gets no privilege the other paths don't have");
{
  // Try to turn an entire block into threshold work, one session at a time. The
  // rails must stop it, and every refusal must be a clean no-op.
  let p = plan;
  let applied = 0;
  let refused = 0;
  // EVERY planned run, not a fixed slice. This used to take the first 25, which
  // silently encoded "25 is more than the block can absorb" — true when a recovery
  // week deleted sessions, and no longer true now that recovery weeks keep their
  // frequency and cut volume instead. The invariant was never about 25: it is that
  // the block-intensity ceiling stops you turning a whole plan into threshold work.
  const targets = find(plan, (w) => w.discipline === "run" && w.status === "planned");
  for (const w of targets) {
    const before = JSON.stringify(p);
    const res = repaceSession(p, w.id, targetForZone(p.paces, "run-pace", 5));
    if (res) {
      applied++;
      p = res.plan;
    } else {
      refused++;
      ok(JSON.stringify(p) === before, `a refused edit leaves the plan byte-identical (${w.id})`);
    }
  }
  ok(applied + refused === targets.length, "every attempt either applied or was refused");
  ok(refused > 0, `the rails refused at least one (applied ${applied}, refused ${refused})`);

  const rb = checkRails(plan);
  const ra = checkRails(p);
  ok(
    ra.violations.length <= rb.violations.length,
    `spamming the pace control never leaves more violations than it found (${rb.violations.length} → ${ra.violations.length})`,
  );
  ok(
    Object.keys(p.workouts).length === Object.keys(plan.workouts).length,
    "and it never invents or deletes sessions",
  );
}

// --- 5b. the responder must not overrule the athlete's own session ---------
// Found by driving the real app, not by reading code. Setting today's easy run to
// threshold pace made it Zone 4 — and then respondTo's credit branch also made it
// 10% LONGER in the same action, so asking for "harder" quietly bought harder AND
// longer. The plan responds AROUND a deliberate choice, never TO it.
section("the plan adjusts around your choice, not the session you just set");
{
  const runs = find(plan, (w) => w.discipline === "run" && w.primaryZone <= 2 && w.status === "planned");
  const target = runs[0];
  const res = repaceSession(plan, target.id, targetForZone(plan.paces, "run-pace", 4));
  ok(!!res, "the setup edit applies");
  if (res) {
    const answered = respondTo(res.plan, target.date, { kind: "logged", workoutId: target.id });
    const after = (answered?.plan ?? res.plan).workouts[target.id];
    ok(
      after.estDurationSec === res.workout.estDurationSec,
      `the re-paced session keeps the length the athlete left it at (${Math.round(res.workout.estDurationSec / 60)} → ${Math.round(after.estDurationSec / 60)} min)`,
    );
    ok(after.primaryZone === res.workout.primaryZone, "and the zone they chose");
    ok(!answered || !answered.changedIds.includes(target.id), "it is not listed among what the plan changed");
  }

  // the same guarantee for the length control: shortening a session because you're
  // short of time must not be partly handed back by the responder
  const adj = adjustSession(plan, target.id, Math.round(target.estDurationSec * 0.6));
  if (adj) {
    const answered = respondTo(adj.plan, target.date, { kind: "logged", workoutId: target.id });
    const after = (answered?.plan ?? adj.plan).workouts[target.id];
    ok(
      after.estDurationSec === adj.workout.estDurationSec,
      `a shortened session stays shortened (${Math.round(adj.workout.estDurationSec / 60)} → ${Math.round(after.estDurationSec / 60)} min)`,
    );
  }

  // ...but the OTHER sessions are still fair game — the responder isn't disabled,
  // just kept off the one the athlete set.
  const other = runs[1];
  if (other) {
    const r2 = repaceSession(plan, other.id, targetForZone(plan.paces, "run-pace", 4));
    if (r2) {
      const answered = respondTo(r2.plan, other.date, { kind: "logged", workoutId: other.id });
      ok(
        !answered || answered.changedIds.every((id) => id !== other.id),
        "the responder still works on everything except the touched session",
      );
    }
  }
}

// --- 6. no-ops are refused -------------------------------------------------
section("nothing happens when nothing would change");
{
  const same = targetForZone(plan.paces, "run-pace", easyRun.primaryZone);
  ok(repaceSession(plan, easyRun.id, same) === null, "re-pacing to the zone it already is does nothing (#108)");
  ok(repaceSession(plan, "no-such-id", 300) === null, "an unknown session is refused");
  ok(repaceSession(plan, plan.workouts["w-race-day"].id, 300) === null, "race day is refused");
}

// --- 7. distance ------------------------------------------------------------
section("setting a distance moves time with it");
{
  const distanced = find(plan, (w) => canSetDistance(w) && w.discipline === "run");
  ok(distanced.length > 0, "there are distance-based sessions");
  const w = distanced[0];

  const choices = distanceChoices(w);
  ok(choices.length >= 3, `a ladder of distances is offered (${choices.map((m) => (m / 1000).toFixed(1)).join(", ")} km)`);
  ok(choices.every((m, i) => i === 0 || m > choices[i - 1]), "sorted and de-duplicated");

  const longer = Math.round((w.estDistanceM ?? 0) * 1.25);
  const res = resizeByDistance(plan, w.id, longer);
  if (res) {
    ok((res.workout.estDistanceM ?? 0) > (w.estDistanceM ?? 0), "the session got longer in distance");
    ok(res.workout.estDurationSec > w.estDurationSec, "...and in time, because they move together");
    // the header must never disagree with the structure
    const segSec = (segs: Workout["segments"]): number =>
      segs.reduce((a, s) => a + ((s.durationSec ?? 0) + (s.children ? segSec(s.children) : 0)) * (s.repeat ?? 1), 0);
    ok(
      Math.abs(segSec(res.workout.segments) - res.workout.estDurationSec) < 1,
      "the header equals the sum of its steps",
    );
    ok(res.workout.primaryZone === w.primaryZone, "distance does not change intensity");
  }
  ok(resizeByDistance(plan, w.id, 0) === null, "a zero distance is refused");
  ok(resizeByDistance(plan, "nope", 5000) === null, "an unknown session is refused");

  const strength = find(plan, (x) => x.discipline === "strength")[0];
  if (strength) ok(!canSetDistance(strength), "a gym session has no distance to set");
}

// --- 8. the choices offered are real prescriptions --------------------------
section("the offered targets are the plan's own zones");
{
  for (const kind of ["run-pace", "swim-pace"] as const) {
    const cs = targetChoices(plan.paces, kind);
    ok(cs.length === 5, `${kind}: one choice per zone`);
    ok(
      cs.every((c) => zoneForTarget(plan.paces, kind, c.value) === c.zone),
      `${kind}: every offered target resolves back to the zone it claims`,
    );
    ok(cs.every((c) => targetLabel(kind, c.value).length > 0), `${kind}: every choice has a label`);
  }
  ok(targetLabel("bike-power", 217.4) === "217 W", "power reads in whole watts");
  ok(targetLabel("run-pace", 315) === "5:15/km", "run pace reads as mm:ss/km");
  ok(targetLabel("swim-pace", 110) === "1:50/100m", "swim pace reads per 100m");
}

// --- changing which day of the split a gym session is -----------------------
//
// Ryan, 2026-08-12: "allow me to modify the day or my split for the workout so I can
// change it from push to pull or whatever." The important part is that it rebuilds the
// EXERCISES — relabelling alone would leave an athlete pressing under a heading that
// says rows.
section("a gym session can be moved to another day of the split");
{
  const plan = generatePlan(
    { username: "t", raceType: "olympic", raceDateISO: weeksFrom(16), level: "intermediate",
      workoutsPerWeek: 8, createdAtISO: ANCHOR,
      strength: { enabled: true, daysPerWeek: 3, split: "push-pull-legs" } } as unknown as Profile,
    ANCHOR,
  );
  const gym = Object.values(plan.workouts).find((w) => w.discipline === "strength" && w.status === "planned");
  ok(!!gym, "the plan has a gym session to reslot");
  if (gym) {
    const from = slotOf(gym);
    const target: StrengthSlot = from === "pull" ? "push" : "pull";
    const res = reslotStrength(plan, gym.id, target);
    ok(!!res, `${from} -> ${target} produces a change`);
    if (res) {
      const after = res.workout;
      ok(slotOf(after) === target, `the slot is now ${target}`);
      ok(after.discipline === "strength", "it is still a strength session");
      ok(after.date === gym.date && after.weekIndex === gym.weekIndex, "it stays on its own day");
      ok(
        JSON.stringify(after.segments) !== JSON.stringify(gym.segments),
        "the EXERCISES changed, not just the title",
      );
      ok(
        Math.abs(after.estDurationSec - gym.estDurationSec) <= 10 * 60,
        `the athlete's time carries across (${Math.round(gym.estDurationSec / 60)} -> ${Math.round(after.estDurationSec / 60)} min)`,
      );
      ok(after.prescribed === undefined, "the old split's resize baseline is dropped");
      // idempotent: asking for the slot it already is must not be a dead button
      ok(reslotStrength(res.plan, gym.id, target) === null, "re-selecting the same day changes nothing");
    }
  }
  // a non-strength session is never reslotted
  const run = Object.values(plan.workouts).find((w) => w.discipline === "run" && w.status === "planned");
  if (run) ok(reslotStrength(plan, run.id, "push") === null, "a run has no split to change");
}

section("every chip the Modify panel shows is a chip that DOES something");
{
  // `adjustSession` has promised since #108 that it "returns null when nothing would
  // change, so the UI never offers a button that does nothing" — and for a long time
  // nothing asked it. The ladders were arithmetic on the prescribed value handed
  // straight to the screen, so ~1 in 5 chips was inert: tap it, nothing happens, and
  // (because the toast rendered behind the sheet) nothing is said either. Ryan: "it's
  // not letting me set to distances in my… to modify workout."
  //
  // Swept across race distances and levels rather than one fixture, because the dead
  // rungs appear wherever a ratio happens to round to no honest change — which is a
  // property of the session, not of the plan.
  let offered = 0;
  for (const [raceType, level, wpw] of [
    ["olympic", "beginner", 4],
    ["olympic", "intermediate", 6],
    ["half", "advanced", 8],
    ["full", "intermediate", 6],
    ["fitness", "beginner", 5],
  ] as const) {
    const p = generatePlan(profile({ raceType, level, workoutsPerWeek: wpw }), ANCHOR);
    for (const w of Object.values(p.workouts)) {
      if (w.status !== "planned" || w.discipline === "rest") continue;

      const lengths = lengthOptions(p, w.id);
      for (const c of lengths) {
        offered++;
        if (c.current) continue; // "you are here" — selected, not a dead button
        ok(!!adjustSession(p, w.id, c.value), `${raceType}/${level} ${w.title}: ${Math.round(c.value / 60)} min length chip does something`);
      }
      if (lengths.length) ok(lengths.some((c) => c.current), `${raceType}/${level} ${w.title}: the length row shows where you are`);

      const distances = distanceOptions(p, w.id);
      for (const c of distances) {
        offered++;
        if (c.current) continue;
        ok(!!resizeByDistance(p, w.id, c.value), `${raceType}/${level} ${w.title}: ${c.value}m distance chip does something`);
      }
      if (distances.length) ok(distances.some((c) => c.current), `${raceType}/${level} ${w.title}: the distance row shows where you are`);
      // A session that can't be resized by distance offers no distance chips at all,
      // rather than a row of buttons that all refuse.
      if (!canSetDistance(w)) ok(distances.length === 0, `${raceType}/${level} ${w.title}: no distance row when distance can't be set`);
    }
  }
  ok(offered > 1000, `the sweep actually covered the ladders (${offered} chips checked)`);

  // No two chips may READ the same. fmtDistance prints whole kilometres on purpose
  // (#187) while the ladder steps in 500s, so a short session offered "3 km · 4 km ·
  // 4 km · 5 km" — two identical-looking buttons doing different things.
  for (const [raceType, level] of [["olympic", "beginner"], ["half", "advanced"]] as const) {
    const p = generatePlan(profile({ raceType, level }), ANCHOR);
    for (const w of Object.values(p.workouts)) {
      if (!canSetDistance(w)) continue;
      for (const unit of ["metric", "imperial"] as const) {
        const label = (m: number) => fmtDistance(m, unit, w.discipline === "swim");
        const labels = distanceOptions(p, w.id, label).map((c) => label(c.value));
        ok(new Set(labels).size === labels.length, `${raceType}/${unit} ${w.title}: no two distance chips read the same (${labels.join(", ")})`);
      }
    }
  }

  // The ladder itself is unchanged — `distanceChoices` is still the raw rungs, and
  // the menu is a SUBSET of it plus at most the athlete's current value.
  const w = Object.values(plan.workouts).find((x) => canSetDistance(x))!;
  const raw = new Set(distanceChoices(w));
  const menu = distanceOptions(plan, w.id);
  const extras = menu.filter((c) => !raw.has(c.value));
  ok(extras.every((c) => c.current), "anything offered beyond the ladder is only ever the current value");
}

// --- every session the plan writes can actually be resized -------------------
// Ryan, on 1.0.60: "why is it not letting me resize sessions?"
//
// A recovery swim is built as plain distance blocks — 200m / 500m / 200m, no rep
// count and no minutes — and `scaleSegment` had a branch for rep-sets and a branch
// for durations and none for those. Every rung of the ladder came back "can't be
// expressed truthfully", so the Modify panel told him the session was already as
// close as it could get, for every option, including obviously reachable ones.
//
// Asserted across the profile matrix rather than on one fixture, because the sessions
// that hit it were confined to recovery weeks: on a single default plan the bug is
// 0% of what you look at, and across the matrix it was 11% of every recovery week.
section("every planned session offers at least one real length option");
{
  let blocked = 0;
  let total = 0;
  let firstBad = "";
  for (const level of ["beginner", "intermediate", "advanced", "elite"] as const) {
    for (const raceType of ["olympic", "half", "full"] as const) {
      for (const per of [{ swim: 2, bike: 2, run: 2 }, { swim: 3, bike: 3, run: 3 }, { swim: 4, bike: 4, run: 4 }]) {
        const p = generatePlan(
          {
            username: "t",
            raceType,
            raceDateISO: weeksFrom(20),
            level,
            workoutsPerWeek: per.swim + per.bike + per.run,
            perSport: per,
            createdAtISO: ANCHOR,
          } as Profile,
          ANCHOR,
        );
        for (const w of Object.values(p.workouts)) {
          if (w.discipline === "rest" || w.status !== "planned" || w.id === "w-race-day") continue;
          total++;
          if (lengthOptions(p, w.id).filter((o) => !o.current).length === 0) {
            blocked++;
            if (!firstBad) firstBad = `${level}/${raceType} ${per.swim}/${per.bike}/${per.run} · ${w.title} ${Math.round(w.estDurationSec / 60)}min`;
          }
        }
      }
    }
  }
  ok(total > 3000, `the matrix is broad enough to catch a recovery-week-only bug (${total} sessions)`);
  ok(blocked === 0, `every session can be resized (${blocked} blocked; first: ${firstBad})`);
}

// …and a plain distance block scales its metres AND its wording together.
section("a distance-only segment resizes without the text drifting from the metres");
{
  const p = generatePlan(profile(), ANCHOR);
  const swim = Object.values(p.workouts).find(
    (w) => w.discipline === "swim" && w.status === "planned" && w.segments.some((s) => s.kind === "main" && s.distanceM && !s.durationSec),
  );
  ok(!!swim, "the fixture has a distance-built swim");
  if (swim) {
    const target = adjustChoices(swim).find((sec) => Math.abs(sec - swim.estDurationSec) > 60)!;
    const res = adjustSession(p, swim.id, target);
    ok(!!res, `it can be resized (asked ${Math.round(target / 60)}min)`);
    if (res) {
      for (const seg of res.workout.segments) {
        if (seg.kind !== "main" || !seg.distanceM) continue;
        const stated = /^(\d[\d,]*)\s*m\b/.exec(seg.description);
        ok(!!stated, `the main set still states its distance ("${seg.description}")`);
        if (stated) {
          ok(
            Number(stated[1].replace(/,/g, "")) === seg.distanceM,
            `and the words match the metres (${stated[1]} vs ${seg.distanceM})`,
          );
        }
        ok(seg.distanceM % 25 === 0, `and it lands on whole pool lengths (${seg.distanceM}m)`);
      }
    }
  }
}

// --- tapping the chip you are already on is never an error -------------------
// Ryan, against 1.0.61: "its still saying that session cant be resized to that
// distance". It was — for the chip the row highlights as your current value. Both
// rows render that chip as a live button, so tapping it called the action, the action
// truthfully answered "nothing would change", and the UI rendered that as a refusal.
//
// Measured across the profile matrix BEFORE the fix: 0 failures on chips offered as
// selectable, 4,842 on the current one. So it fired on virtually every session for
// anyone who tapped the highlighted chip — the natural thing to do when checking what
// a control does.
section("the current chip is a no-op, not a refusal");
{
  let atCurrent = 0;
  let offeredButRefused = 0;
  let total = 0;
  for (const level of ["beginner", "intermediate", "advanced", "elite"] as const) {
    for (const raceType of ["olympic", "half", "full"] as const) {
      const p = generatePlan(profile({ level, raceType }), ANCHOR);
      for (const w of Object.values(p.workouts)) {
        if (!canSetDistance(w) || w.status !== "planned" || w.id === "w-race-day") continue;
        total++;
        for (const c of distanceOptions(p, w.id)) {
          const refused = !resizeByDistance(p, w.id, c.value);
          if (!refused) continue;
          // Every refusal must be explainable as "you are already there" — which the
          // UI now recognises and answers with silence instead of an error.
          if (isAtDistance(w, c.value)) atCurrent++;
          else offeredButRefused++;
        }
      }
    }
  }
  ok(total > 500, `the matrix is broad enough to be meaningful (${total} distance-capable sessions)`);
  ok(
    offeredButRefused === 0,
    `no chip the row offers as a real change is ever refused (${offeredButRefused})`,
  );
  ok(atCurrent > 0, `and the refusals that do exist are all "already there" (${atCurrent})`);
  // …which `isAtDistance` classifies, so the UI can stay silent on exactly those.
  const w = Object.values(generatePlan(profile(), ANCHOR).workouts).find((x) => canSetDistance(x))!;
  ok(isAtDistance(w, w.estDistanceM ?? 0), "isAtDistance recognises the session's own distance");
  ok(!isAtDistance(w, (w.estDistanceM ?? 0) * 2), "…and does not swallow a real change");
  ok(isAtLength(w, w.estDurationSec), "isAtLength recognises the session's own length");
  ok(!isAtLength(w, w.estDurationSec + 20 * 60), "…and does not swallow a real one");
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) {
  console.error(`\n❌ ${failures} modify invariant(s) FAILED`);
  process.exit(1);
}
console.log("\n✅ all modify invariants passed");
