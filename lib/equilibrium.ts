// ---------------------------------------------------------------------------
// The frequency you asked for is a contract, and equivalence is what settles it.
//
// Ryan, 2026-08-13:
//   "when someone tells you how many times a week they want for each sport, stick
//    to it. If I swap one of my bikes for a swim, then one of the swims in the
//    future should be swapped for a bike… but this rule of equilibrium stands if
//    the swap is the equivalent. If I do something that is not the equivalent,
//    then you have to not delete the other one in the future, but rather lighten
//    it up."
//
// And the case that proves it:
//
//   "I do my Monday run as planned, my Wednesday run as planned, but on Thursday
//    I decide to do a two kilometre run, yet my Friday run was a twelve kilometre
//    run. We cannot just say okay, he did the three runs for the week."
//
// TWO CONTRACTS, NOT ONE — this is the thing the old code got wrong
//
// There are two separate promises in a training week and they need separate
// arithmetic:
//
//   COUNT   — "three runs a week". Settled in whole sessions. Broken by a SWAP,
//             which trades one sport for another and leaves the mix wrong. Fixed
//             by converting one session of the surplus sport back, ROLE-MATCHED
//             (a long ride becomes the long run, not the easy one).
//   CREDIT  — "this much running, at this intensity". Settled continuously.
//             Broken by unplanned work, which pays down part or all of a session
//             you have not done yet. Fixed by absorbing or lightening THAT
//             session — never by spreading the cost across the week.
//
// The old implementation ran count logic (replan.ts `sportDrift`/`restoreSport`)
// and credit logic (absorb.ts) as two independent systems that each rewrote the
// plan and then argued about the result. Three separate bug reports (#215, #219,
// #220) were all versions of the same collision. Here they are one pass with a
// defined order: credit settles first, because it decides which sessions are
// still standing, and count runs second on what remains.
//
// THE FORMULA
//
//     e  =  credit(what you did)  /  credit(the session as first prescribed)
//
// where credit is duration × intensity, in the sRPE units the load model already
// uses — so an easy hour and a threshold hour are not pretended to be the same
// thing. Then:
//
//     e ≥ 0.85   the session is COVERED and comes off the week
//     0.10–0.85  the session is LIGHTENED to (1 − e) of its design
//     e < 0.10   noted, nothing moves
//
// Ryan's Thursday 2 km against a 12 km Friday scores e ≈ 0.17 → Friday survives,
// trimmed by what was already done, which is what he asked for in as many words.
// A long bike swapped for a long run scores e ≈ 1.0 → a clean 1:1, and the count
// contract then puts a bike back somewhere else in the week.
//
// Measuring against the session AS FIRST PRESCRIBED, never its current value, is
// what stops two unplanned rides between them absorbing a session neither earned,
// and what stops repeated passes ratcheting a session towards zero.
//
// Pure — no clock, no I/O. The caller supplies today.
// ---------------------------------------------------------------------------

import { MAX_STRETCH, MIN_SESSION_SEC, scaleWorkout } from "./prescribe";
import { railsRegressed } from "./rails";
import { creditedSeconds } from "./credit";
import { designedDiscipline } from "./decisions";
import { injuryMods } from "./planEngine";
import { ZONES } from "./zones";
import type { Discipline, Plan, Profile, SessionType, Week, Workout, Zone } from "./types";

export type Sport = "swim" | "bike" | "run";

/** Full cover: the work stands in for the session outright.
 *
 *  0.85 rather than absorb.ts's old 0.7 because that 0.7 was borrowed from
 *  `isEquivalent`, which answers a different question — "is this near enough to
 *  tick off the session you were going to do anyway?" — and is allowed to be
 *  generous. This one DELETES a session from the week, so it has to be strict:
 *  at 0.7 an athlete lost a 60-minute ride to 42 minutes of riding, which is not
 *  "the equivalent" in any sense Ryan would recognise. */
export const FULL_COVER = 0.85;

/**
 * Below this the work is too small to move anything at all.
 *
 * SET FROM RYAN'S OWN EXAMPLE, and it was wrong at first. His case is a 2 km jog
 * against a 12 km long run — ratio 0.17 — and his instruction for it is explicit:
 * "you could lighten up the Friday run, because I did a Thursday run." At the
 * first value (0.25) that ratio fell into "negligible" and the plan did NOTHING,
 * which is the same do-nothing he filed the complaint about, arrived at from the
 * opposite direction. The floor exists only to stop trivial work causing churn —
 * a ten-minute shakeout should not re-cut a two-hour ride — so it belongs well
 * under his case, not above it.
 */
export const NEGLIGIBLE = 0.1;

/**
 * The most of a session a single settlement may ask to take off.
 *
 * NOT the binding limit, and the distinction matters. `scaleWorkout` enforces
 * `MAX_CUT` (prescribe.ts) — no session is ever cut below **70% of its design** —
 * so however deep a ratio says to go, a session bottoms out at 70%, not at 30%.
 * This value only bounds what gets ASKED for. Measured: an `e` of 0.71 requests a
 * cut to 29% and lands at 70%.
 *
 * That is deliberate and it errs the safe way: a settlement can only ever
 * UNDER-credit work already done, never over-credit it, and doc 02 §4 #8 is
 * explicit that consistency is the driver — gate intensity, don't delete work.
 * The cases this clamps are the ones already near the full-cover boundary, where
 * the right answer is "that covers it" rather than "that guts it".
 */
export const MAX_LIGHTEN = 0.7;

const rpeMid = (z: Zone) => (ZONES[z].rpe[0] + ZONES[z].rpe[1]) / 2;

/** What a session is WORTH, in the same sRPE units as the load ledger: minutes ×
 *  the effort its zone represents. One unit for the whole file means a hard hour
 *  and an easy hour never accidentally compare as equal. */
export function creditOf(sec: number, zone: Zone): number {
  return (sec / 60) * rpeMid(zone);
}

/** What the engine first asked this session for — the denominator of every ratio
 *  here. Reading the CURRENT value instead is how repeated passes ratchet a
 *  session down: each one measures against an already-trimmed baseline and takes
 *  another slice of it. */
export function prescribedCredit(w: Workout): number {
  const sec = w.prescribed?.estDurationSec ?? w.estDurationSec;
  const zone = w.prescribed?.primaryZone ?? w.primaryZone;
  return creditOf(sec, zone);
}

/**
 * The zone a session was actually DONE at — read off the athlete's own RPE when
 * they gave us one, otherwise the zone it was prescribed at.
 *
 * Both sides of every ratio here are priced in ZONES rather than raw RPE, and
 * that symmetry is load-bearing rather than tidy. Pricing the delivered side at
 * the literal RPE while the prescribed side used its zone's MIDPOINT punished
 * honest reporting: an athlete who rode 95% of their Z2 endurance ride and
 * accurately called it RPE 3 — squarely inside Z2's own 3–4 band — measured as a
 * 19% shortfall and had the session trimmed instead of covered. Landing inside
 * the band you were asked for IS hitting the prescription, and the arithmetic has
 * to agree with that or the app argues with people for being accurate.
 */
export function deliveredZone(w: Workout): Zone {
  if (typeof w.rpe !== "number") return w.primaryZone;
  for (const z of [5, 4, 3, 2, 1] as Zone[]) {
    if (w.rpe >= ZONES[z].rpe[0]) return z;
  }
  return 1;
}

/** What the athlete actually produced. Prefers logged reality over the estimate
 *  for the duration, and the zone they really worked at for the intensity. */
export function deliveredCredit(w: Workout): number {
  return creditOf(creditedSeconds(w), deliveredZone(w));
}

/**
 * Did the ENGINE design this session, or did it arrive some other way?
 *
 * Three routes produce work the plan never wrote, and they must all answer yes or
 * the week's arithmetic is wrong for one of them:
 *   - logged by hand with nothing planned that day (`logged-` ids, adapt.ts)
 *   - synced from a device and matched to nothing (`synced-` ids, activity.ts)
 *   - deliberately added by the athlete (#209, `addedByAthlete`)
 */
export function isUnplanned(w: Workout): boolean {
  return !!w.addedByAthlete || w.id.startsWith("logged-") || w.id.startsWith("synced-");
}

/** Would work in `did` count toward a session planned as `planned`?
 *  A brick is part ride and part run, so either satisfies part of it. */
export function covers(did: Discipline, planned: Discipline): boolean {
  if (did === planned) return true;
  if (planned === "brick" && (did === "bike" || did === "run")) return true;
  return false;
}

export type Verdict = "full" | "partial" | "negligible";

export interface Equivalence {
  ratio: number;
  verdict: Verdict;
  /** the sports line up (or a brick absorbs one of its legs) */
  sportOk: boolean;
  /** the work was at least as hard as the session it would stand in for.
   *
   *  A ONE-WAY DOOR, and non-negotiable: an easy hour on the bike must never buy
   *  an athlete out of their sweet-spot intervals. Fixing a week's volume by
   *  destroying its only quality is the trade this whole file exists to refuse. */
  intensityOk: boolean;
}

/**
 * How much of `target` the work in `did` actually represents.
 *
 * The ratio is unconditional — it is arithmetic, and it is useful even when the
 * gates fail — while `sportOk` / `intensityOk` say whether it may be SPENT. That
 * split matters: work that is too easy to stand in for a session may still be
 * allowed to shorten it (you have done that riding; the session keeps its shape
 * and asks for less), and the caller needs both facts to make that call.
 */
export function equivalence(did: Workout, target: Workout): Equivalence {
  return equivalenceOf(deliveredCredit(did), deliveredZone(did), did.discipline, target);
}

/**
 * The same judgement, expressed in raw credit rather than in a session.
 *
 * The overshoot path has no session to hand over — its quantity is the SURPLUS a
 * completed session produced beyond its own prescription, which belongs to no
 * workout object. Both callers route through here so there is exactly one
 * definition of "how much of that session is this worth", whatever produced it.
 */
export function equivalenceOf(
  credit: number,
  zone: Zone,
  discipline: Discipline,
  target: Workout,
): Equivalence {
  const base = prescribedCredit(target);
  const ratio = base > 0 ? credit / base : 0;
  return {
    ratio,
    verdict: ratio >= FULL_COVER ? "full" : ratio >= NEGLIGIBLE ? "partial" : "negligible",
    sportOk: covers(discipline, target.discipline),
    intensityOk: zone >= (target.prescribed?.primaryZone ?? target.primaryZone),
  };
}

// ---- the COUNT contract ----------------------------------------------------

/**
 * What a session is FOR, which is what makes two of them interchangeable.
 *
 * The old restoration sorted candidates by zone and took the easiest, which is
 * how "swap my long bike for a long run" put a twenty-minute easy run in the
 * week and left the long ride nowhere (#219). Ryan's rule is explicitly
 * like-for-like — "I swapped my long run for a long bike, that is a one-to-one
 * switch" — and like-for-like needs a notion of likeness.
 */
export type Role = "long" | "quality" | "easy";

export function roleOf(w: Workout): Role {
  const type: SessionType = w.swappedFrom?.type ?? w.type;
  if (type === "long") return "long";
  const zone = w.prescribed?.primaryZone ?? w.primaryZone;
  if (zone >= 4 || type === "tempo" || type === "threshold" || type === "vo2" || type === "race_prep") {
    return "quality";
  }
  return "easy";
}

/**
 * Which sport's slot a session occupies.
 *
 * A BRICK IS A BIKE. Not a philosophical claim — an observation about what the
 * engine does: from the build phase on it converts one of the week's bike slots
 * into a bike-then-run brick, so a 3/3/3 athlete's build week reads `bike 2,
 * run 3, brick 1`. Counting the brick as neither made every build week look one
 * ride short of the contract and had the restoration converting a swim into a
 * ride to fill a hole that was never there.
 */
function countsAs(d: Discipline): Sport | null {
  if (d === "swim" || d === "bike" || d === "run") return d;
  if (d === "brick") return "bike";
  return null;
}

export interface SportBalance {
  /** sessions of this sport the week was designed to hold */
  contracted: number;
  /** sessions of it the week actually still holds */
  current: number;
}

/**
 * The week's sport mix, designed versus as it now stands.
 *
 * A SWAP counts as lost — it is the whole reason this exists, and the exploit it
 * closes is real: volume and quality both survive turning every run into a ride,
 * so without a count contract an athlete can quietly stop running with the plan's
 * blessing.
 *
 * A SKIP does not count as lost. It used to, and it made the plan do the one
 * thing Ryan has asked it not to do repeatedly — rewrite a session he never
 * touched. The hole would sit in the week and the next unrelated edit would trip
 * over it: skip Tuesday's run, lengthen Sunday's long run three days later, and
 * Friday's swim silently became a run. A skip is a decision about one session,
 * and it is answered by leaving the week one session lighter and saying so.
 *
 * Work the engine never wrote sits outside the comparison on BOTH sides. Counting
 * an extra ride as current-only would read as a bike surplus and convert a planned
 * ride into a run — the athlete rode more, which is not a reason to owe a run.
 */
export function sportBalance(plan: Plan, week: Week): Record<Sport, SportBalance> {
  const out: Record<Sport, SportBalance> = {
    swim: { contracted: 0, current: 0 },
    bike: { contracted: 0, current: 0 },
    run: { contracted: 0, current: 0 },
  };

  for (const id of week.workoutIds) {
    const w = plan.workouts[id];
    if (!w || w.discipline === "rest" || w.discipline === "strength") continue;
    if (isUnplanned(w)) continue;
    // An ABSORBED session carries `skipped` too, and that one was supplied rather
    // than lost — the athlete did that ride, it just wasn't the one on the calendar.
    if (w.status === "skipped" && !w.absorbedBy) continue;

    const designed = countsAs(designedDiscipline(w));
    if (designed) out[designed].contracted++;
    const current = countsAs(w.discipline);
    if (current) out[current].current++;
  }
  return out;
}

export interface Restoration {
  plan: Plan;
  /** the session that changed sport */
  id: string;
  from: Sport;
  to: Sport;
  wasSec: number;
  nowSec: number;
  role: Role;
}

/**
 * Put back a sport the athlete's swaps took out of the week.
 *
 * Automatic, not offered: an offer is a loophole, and declining it every week
 * buys a bike-only block with the plan's blessing. Undoable like every other
 * adaptation.
 *
 * Volume-neutral by construction — a session of the SURPLUS sport becomes the
 * missing one, so the week's hours never move. It cannot ping-pong, because a
 * restored sport lands exactly at its contract and is therefore never itself the
 * surplus on the next pass.
 *
 * Three guards, all non-negotiable:
 *   • a sport a severe injury rules out is never restored. Forcing someone back
 *     onto a stress fracture to satisfy a session count is the worst thing this
 *     file could do.
 *   • the conversion goes through `swapDiscipline`, so the mechanical-impact
 *     allowance caps it. Restoring runs is exactly the direction that spikes
 *     bone and tendon load.
 *   • it must be a RELOCATION, not a deletion. `swapDiscipline` never refuses —
 *     with no headroom left it falls back to a 20-minute floor, which is right
 *     for a swap the athlete asked for and wrong for one nobody requested. A
 *     60-minute ride coming back as a 20-minute run "fixed" the count by
 *     quietly deleting forty minutes of training (#219). If the receiving sport
 *     cannot carry most of the session, the ride stays a ride.
 */
export const MIN_RESTORE_KEEP = 0.7;

/**
 * How much longer a restored session may come out than the one it replaces.
 *
 * The guard above this exists so a restoration can never inflate the week, and as
 * an absolute "never longer" rule it silently did nothing at all: every builder
 * has a minimum sensible session, so converting a 31-minute swim into a ride
 * produces the 40-minute floor `bikeEndurance` will not go below, which is longer,
 * which was refused — and the week simply stayed a bike short. Measured on a
 * 3/3/3 olympic block: swapping one ride to a swim left the week at 2 bikes and
 * `respondTo` returned null, which is Ryan's original complaint ("the plan should
 * have swapped one of my swims back") reappearing through the guard meant to
 * protect him.
 *
 * Ten minutes is the difference between a builder's floor and an expansion: it
 * covers every minimum-length rounding in `replacementDraft` and is under 3% of a
 * typical week, while anything that actually grows the week is still refused.
 */
export const RESTORE_GROWTH_TOLERANCE_SEC = 10 * 60;

export function restoreSportContract(
  plan: Plan,
  week: Week,
  todayISO: string,
  exceptId: string | undefined,
  swap: (plan: Plan, id: string, to: Discipline) => Plan,
): Restoration | null {
  const balance = sportBalance(plan, week);
  const mods = injuryMods(plan.profile);

  const short = (Object.keys(balance) as Sport[])
    .filter((s) => balance[s].current < balance[s].contracted && !mods[s].avoid)
    .sort((a, b) => balance[b].contracted - balance[b].current - (balance[a].contracted - balance[a].current));
  if (!short.length) return null;

  const surplus = new Set((Object.keys(balance) as Sport[]).filter((s) => balance[s].current > balance[s].contracted));
  if (!surplus.size) return null;

  for (const want of short) {
    // ROLE-MATCHED, and this is the point. Sorting by "easiest first" is what
    // turned a long ride into a twenty-minute jog; the session that should give
    // way is the one playing the same part in the week as the one that left.
    const wantedRole = missingRole(plan, week, want);
    const pool = eligible(plan, week, todayISO, exceptId)
      .filter((w) => surplus.has(w.discipline as Sport) && w.discipline !== "brick")
      .sort((a, b) => {
        const ra = roleOf(a) === wantedRole ? 0 : 1;
        const rb = roleOf(b) === wantedRole ? 0 : 1;
        return ra !== rb ? ra - rb : a.primaryZone - b.primaryZone;
      });

    // Every viable donor is costed, then the CHEAPEST relocation wins — the one
    // that changes the session's length least. Taking the first that passes made
    // the outcome depend on the week's id ordering, which is how an athlete could
    // lose a 75-minute long ride when a 30-minute easy one would have done.
    const options: Restoration[] = [];
    for (const w of pool) {
      const next = swap(plan, w.id, want);
      const made = next.workouts[w.id];
      if (!made || made.discipline !== want) continue;
      // never let a restoration meaningfully GROW the week…
      if (made.estDurationSec > w.estDurationSec + RESTORE_GROWTH_TOLERANCE_SEC) continue;
      // …and never let it delete training either (#219).
      if (made.estDurationSec < w.estDurationSec * MIN_RESTORE_KEEP) continue;
      if (railsRegressed(plan, next).length) continue;
      options.push({
        plan: next,
        id: w.id,
        from: w.discipline as Sport,
        to: want,
        wasSec: w.estDurationSec,
        nowSec: made.estDurationSec,
        role: roleOf(w),
      });
    }
    if (!options.length) continue;
    options.sort((a, b) => {
      const ra = a.role === wantedRole ? 0 : 1;
      const rb = b.role === wantedRole ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return Math.abs(a.nowSec - a.wasSec) - Math.abs(b.nowSec - b.wasSec);
    });
    return topUpVolume(options[0], week);
  }
  return null;
}

/**
 * Give the restored sport back the TIME the swap took, not just the session count.
 *
 * Ryan's call, 2026-08-14. Restoring the count alone is honest but incomplete: swap a
 * 75-minute long ride for a swim and convert a 35-minute swim back, and the week has
 * three rides again while riding time has fallen 170 → 130 minutes. The count contract
 * is satisfied and the training is not.
 *
 * Deliberately narrow, because this is the one place the plan lengthens something the
 * athlete did not ask it to:
 *   • ONLY the session this restoration just converted is grown. A third, untouched
 *     session is never enlarged to balance the books — that is the rewrite Ryan has
 *     objected to repeatedly, and #219 ("why did my 1h bike turn into a 20 min run")
 *     is what the length guards exist for.
 *   • It closes the gap and stops. It never overshoots the sport's designed volume.
 *   • `MAX_STRETCH` bounds it, and the rails get the final say, so topping up cannot
 *     blow the week's ramp or its intensity balance.
 * If any of that refuses, the restoration stands at its natural length and the week is
 * simply a little lighter on that sport — which `respondToEdit` then says out loud.
 */
function topUpVolume(best: Restoration, week: Week): Restoration {
  const plan = best.plan;
  const ids = week.workoutIds.map((id) => plan.workouts[id]).filter((w): w is Workout => !!w);

  let designed = 0;
  let current = 0;
  for (const w of ids) {
    if (isUnplanned(w) || w.discipline === "rest") continue;
    if (designedDiscipline(w) === best.to) {
      designed += w.swappedFrom?.estDurationSec ?? w.prescribed?.estDurationSec ?? w.estDurationSec;
    }
    if (w.discipline === best.to && w.status !== "skipped") current += w.estDurationSec;
  }
  const deficit = designed - current;
  if (deficit < 5 * 60) return best;

  const converted = plan.workouts[best.id];
  if (!converted) return best;
  const target = Math.min(converted.estDurationSec + deficit, converted.estDurationSec * MAX_STRETCH);
  const baseline = converted.prescribed?.estDurationSec ?? converted.estDurationSec;
  if (baseline <= 0) return best;

  const grown = scaleWorkout(converted, target / baseline, { allowLonger: true });
  if (!grown || grown.estDurationSec <= converted.estDurationSec) return best;

  const next: Plan = { ...plan, workouts: { ...plan.workouts, [best.id]: grown } };
  if (railsRegressed(plan, next).length) return best;
  return { ...best, plan: next, nowSec: grown.estDurationSec };
}

/** The role of the session this sport LOST — what the replacement should be.
 *  Read off the swapped-away sessions rather than guessed, so "my long bike is
 *  gone" asks for a long run and not just any run. */
function missingRole(plan: Plan, week: Week, sport: Sport): Role {
  for (const id of week.workoutIds) {
    const w = plan.workouts[id];
    if (!w?.swappedFrom) continue;
    if (w.swappedFrom.discipline !== sport) continue;
    return roleOf(w);
  }
  return "easy";
}

/** Sessions a rebalance may touch: still planned, not the one the athlete just
 *  set, not in the past, not race day, and carrying real structure. */
export function eligible(plan: Plan, week: Week, todayISO: string, exceptId?: string): Workout[] {
  return week.workoutIds
    .map((id) => plan.workouts[id])
    .filter(
      (w): w is Workout =>
        !!w &&
        w.id !== exceptId &&
        w.id !== "w-race-day" &&
        w.status === "planned" &&
        w.discipline !== "rest" &&
        w.date >= todayISO &&
        !!w.segments?.length,
    )
    .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));
}

// ---- the CREDIT contract ---------------------------------------------------

export interface Settlement {
  plan: Plan;
  /** the session that gave way */
  id: string;
  kind: "covered" | "lightened";
  ratio: number;
  /** one sentence, athlete-facing — every change explains itself or it doesn't ship */
  headline: string;
}

/**
 * Settle work the plan never asked for against the week it landed in.
 *
 * This is Ryan's Thursday-run case and his extra-bike case, and they are the same
 * arithmetic at two points on the scale. Returns null when the honest answer is
 * "nothing" — which is common and correct; a plan that visibly reshuffles on every
 * logged activity reads as chaotic rather than responsive.
 */
export function settleUnplanned(plan: Plan, todayISO: string, doneId: string): Settlement | null {
  const did = plan.workouts[doneId];
  if (!did || did.discipline === "rest" || !isUnplanned(did)) return null;
  // WORK ALREADY DONE, OR WORK YOU HAVE JUST COMMITTED TO — both settle.
  //
  // Ryan named the second case explicitly: "if I add a session and I add a bike
  // today, one of my bikes in the future for that week should be removed." An
  // added session is `planned`, not `done`, so gating on completion alone let the
  // whole ADD path out of the contract — the athlete asked for a fourth ride and
  // the week quietly carried four. The arithmetic is identical either way; a
  // planned session is simply priced at what it asks for rather than at what was
  // recorded, which is what `deliveredCredit` already does for it.
  const committed = did.status === "planned" && !!did.addedByAthlete;
  if (did.status !== "done" && !committed) return null;

  // ONE PIECE OF WORK SETTLES ONCE.
  //
  // An added session settles the moment it is committed, and then again when the
  // athlete ticks it off — two sessions taken off the week for one extra ride.
  // Every settlement stamps `absorbedBy` with the id of the work that caused it,
  // so that stamp is also the receipt: if anything in the plan already points at
  // this session, its debt is paid. Cheaper and more honest than a flag on the
  // causing session, because it cannot drift out of sync with the thing it
  // describes — and it makes repeated `respondTo` calls idempotent for free.
  if (Object.values(plan.workouts).some((w) => w.absorbedBy === doneId)) return null;

  const week = plan.weeks.find((w) => w.index === did.weekIndex);
  // Race week is never rebalanced — the taper is the point, and trimming it
  // because someone rode on Tuesday undoes the block it was built for.
  if (!week || week.isRaceWeek) return null;
  if (deliveredCredit(did) <= 0) return null;
  return spendCredit(plan, week, todayISO, did, deliveredCredit(did), { allowCover: true, source: "unplanned" });
}

/**
 * A session you took far past what it asked for is extra work too.
 *
 * Ryan's case: a 60-minute long run done as 120. Nothing in the week moved, because
 * every settlement path keyed on the session being UNPLANNED — and this one was
 * planned, you just did twice as much of it. The load ledger saw the hours, but the
 * ledger answers at block scale and its response is capped and slow; the week you
 * are standing in kept asking for everything it originally asked for.
 *
 * The excess is the honest quantity: what you produced MINUS what the session was
 * prescribed. That surplus is then spent exactly like an unplanned session, against
 * the same candidates under the same rules — so doubling your long run trims what is
 * left of your running that week, and cannot touch your intervals or another sport.
 *
 * It may only ever LIGHTEN, never cover: the sessions still standing were not done,
 * and no amount of overshooting one session is evidence that another happened.
 */
export const OVERSHOOT_MARGIN = 1.25;

export function settleOvershoot(plan: Plan, todayISO: string, doneId: string): Settlement | null {
  const did = plan.workouts[doneId];
  if (!did || did.discipline === "rest" || isUnplanned(did)) return null;
  if (did.status !== "done" && did.status !== "swapped") return null;
  if (Object.values(plan.workouts).some((w) => w.absorbedBy === doneId)) return null;

  const week = plan.weeks.find((w) => w.index === did.weekIndex);
  if (!week || week.isRaceWeek) return null;

  const asked = prescribedCredit(did);
  const got = deliveredCredit(did);
  // Inside the margin this is just a session that ran long, which is normal and not
  // worth reshaping a week over.
  if (asked <= 0 || got < asked * OVERSHOOT_MARGIN) return null;

  return spendCredit(plan, week, todayISO, did, got - asked, { allowCover: false, source: "overshoot" });
}

/**
 * Spend a quantity of credit against the sessions still standing in a week.
 *
 * Shared by both settlement paths so "you did work the plan didn't ask for" and "you
 * did far more of a session than it asked for" cannot drift into answering the same
 * question two different ways — which is the exact failure mode that produced #215,
 * #219 and #220 when absorption and sport-balance were separate systems.
 */
function spendCredit(
  plan: Plan,
  week: Week,
  todayISO: string,
  did: Workout,
  credit: number,
  opts: { allowCover: boolean; source: "unplanned" | "overshoot" },
): Settlement | null {
  const doneId = did.id;

  // WAS THE DAY ALREADY SPOKEN FOR IN THIS SPORT?
  //
  // Ryan: "if I already did a ten k run today and I had a ten k run planned for
  // Saturday, and I had nothing planned for today, then and only then should I
  // switch." If the day held no run, an unplanned 10k stands IN FOR Saturday's —
  // you did that session, early. If the day already had a run and you did it, the
  // 10k is genuinely on top, and cancelling Saturday would hand you a rest day for
  // training more. So a day that already carried this sport caps the answer at
  // LIGHTEN: the work still counts, it just reduces what's left instead of
  // cancelling it.
  const dayAlreadyHadThisSport = Object.values(plan.workouts).some(
    (w) =>
      w.id !== doneId &&
      w.date === did.date &&
      !isUnplanned(w) &&
      covers(did.discipline, w.discipline),
  );

  const candidates = eligible(plan, week, todayISO, doneId).filter((w) => covers(did.discipline, w.discipline));
  if (!candidates.length) return null;

  // Nearest in intensity first, then nearest in size. A hard unplanned ride facing
  // both an interval session and an easy long ride should take the INTERVALS off
  // the week even when the long ride is closer in minutes — matching on length
  // alone spends a quality-for-quality match on an easy session and leaves the
  // athlete doing their intervals twice.
  const didZone = deliveredZone(did);
  const ranked = [...candidates].sort((a, b) => {
    const za = Math.abs(a.primaryZone - didZone);
    const zb = Math.abs(b.primaryZone - didZone);
    if (za !== zb) return za - zb;
    const da = Math.abs(prescribedCredit(a) - credit);
    const db = Math.abs(prescribedCredit(b) - credit);
    return da === db ? a.date.localeCompare(b.date) : da - db;
  });

  for (const target of ranked) {
    const e = equivalenceOf(credit, deliveredZone(did), did.discipline, target);
    if (e.verdict === "negligible") continue;
    const base = target.prescribed?.estDurationSec ?? target.estDurationSec;
    if (base <= 0) continue;

    // --- full cover → the session comes off the week ------------------------
    if (opts.allowCover && e.verdict === "full" && e.intensityOk && !dayAlreadyHadThisSport) {
      const covered: Workout = {
        ...target,
        status: "skipped",
        absorbedBy: doneId,
        absorbedFrom: {
          status: target.status,
          note: target.note,
          segments: target.segments,
          estDurationSec: target.estDurationSec,
          estDistanceM: target.estDistanceM,
          primaryZone: target.primaryZone,
        },
        note: `Covered by the ${did.discipline} you did on ${did.date}`,
      };
      const next: Plan = { ...plan, workouts: { ...plan.workouts, [target.id]: covered } };
      if (railsRegressed(plan, next).length) continue;
      return {
        plan: next,
        id: target.id,
        kind: "covered",
        ratio: e.ratio,
        headline:
          `That ${did.discipline} wasn't on the plan, and it covers ${target.title} — ` +
          `so that one comes off this week rather than asking you to do it twice.`,
      };
    }

    // QUALITY IS PROTECTED ON THE TRIM PATH TOO, NOT ONLY ON THE COVER PATH.
    //
    // The intensity gate used to guard full cancellation only, so an easy spin could
    // not DELETE your intervals but could quietly shave them. Measured: three extra
    // 25-minute Z2 rides in one week, and the second one trimmed a `Sweet Spot 3×8`
    // from 60 to 49 minutes — `scaleWorkout` rewrites the rep count, so that is an
    // interval gone. Twenty-five easy minutes bought it. The file's own rule ("an easy
    // hour must never buy an athlete out of their intervals") was written for exactly
    // this and was only half-enforced.
    //
    // A session that is not quality may still be trimmed by easier work: shedding
    // aerobic volume you have already done is honest, and refusing it outright is how
    // an unplanned ride in a build week used to change nothing at all (#215). So the
    // protection is scoped to the sessions whose whole point is the stimulus.
    if (!e.intensityOk && roleOf(target) === "quality") continue;

    // --- partial → what's left of it ----------------------------------------
    //
    // Ryan's Thursday two-kilometre run lands here against Friday's twelve: the
    // ratio is small, so Friday keeps almost all of itself and loses only what was
    // genuinely already done. The session keeps its SHAPE and its ZONE — it asks
    // for less of the same thing, which is why work too easy to stand in for a
    // session may still shorten it.
    // CLAMPED TO THE FLOOR, NOT ABANDONED AT IT.
    //
    // What is left after the trim can land under the shortest session worth
    // prescribing, and the old answer was to give up on that candidate entirely —
    // which is the worst of the three available answers. Measured: an athlete with a
    // 35-minute easy ride left in the week rode 25 easy minutes, the remainder came
    // to 11 minutes, and the plan silently did nothing at all. Cutting the session to
    // the floor is honest (it takes 20 minutes off for 25 minutes ridden — under-
    // crediting, never over) and it is an answer. `MAX_LIGHTEN` still bounds how deep
    // any single settlement can go.
    // CREDIT ACCUMULATES ACROSS SETTLEMENTS — IT IS NOT RE-SPENT FROM SCRATCH.
    //
    // Every ratio here is measured against the session AS FIRST PRESCRIBED, which is
    // what stops repeated passes ratcheting a session towards zero. But measuring
    // each settlement from that same untouched baseline INDEPENDENTLY has the
    // opposite failure: two 25-minute rides in one week each computed "this is a
    // third of the long ride", each asked for the same third, and the second one
    // barely moved the needle. Fifty minutes of extra riding was credited as
    // twenty-five.
    //
    // So the spend is tracked on the session itself: how far it has already been cut
    // below its design IS the credit already claimed against it. Adding this
    // settlement's ratio on top makes the two rides sum to what the athlete actually
    // did, while the baseline stays the design, so the anti-ratchet property is kept.
    const alreadySpent = Math.max(0, 1 - target.estDurationSec / base);
    const keep = Math.max(1 - MAX_LIGHTEN, 1 - (alreadySpent + e.ratio));
    const keepSec = Math.max(MIN_SESSION_SEC, base * keep);
    if (keepSec >= target.estDurationSec) continue; // nothing left to give
    const scaled = scaleWorkout(target, keepSec / base);
    if (!scaled) continue;

    const trimmed: Workout = {
      ...scaled,
      absorbedBy: doneId,
      absorbedFrom: {
        status: target.status,
        note: target.note,
        segments: target.segments,
        estDurationSec: target.estDurationSec,
        estDistanceM: target.estDistanceM,
        primaryZone: target.primaryZone,
      },
    };
    const next: Plan = { ...plan, workouts: { ...plan.workouts, [target.id]: trimmed } };
    if (railsRegressed(plan, next).length) continue;
    return {
      plan: next,
      id: target.id,
      kind: "lightened",
      ratio: e.ratio,
      headline:
        opts.source === "overshoot"
          ? `You did well over what ${did.title} asked for, so ${target.title} comes down to ` +
            `${Math.round(trimmed.estDurationSec / 60)} min — that ${did.discipline} volume is already in the bank.`
          : `That ${did.discipline} wasn't on the plan, so ${target.title} comes down to ` +
            `${Math.round(trimmed.estDurationSec / 60)} min — you've already done part of it.`,
    };
  }

  return null;
}

/**
 * The per-sport session counts a week is contracted to hold.
 *
 * Exported so the frequency rail and the tests can ask the same question the
 * engine answers, rather than each re-deriving it and drifting apart.
 */
export function contractedCounts(profile: Profile): Record<Sport, number> {
  const per = profile.perSport;
  if (!per) return { swim: 0, bike: 0, run: 0 };
  return {
    swim: Math.max(0, Math.round(per.swim)),
    bike: Math.max(0, Math.round(per.bike)),
    run: Math.max(0, Math.round(per.run)),
  };
}
