// ---------------------------------------------------------------------------
// The athlete's decisions about their own plan, kept somewhere a rebuild can't
// reach.
//
// Ryan, 2026-08-13, after a fortnight of this: "if I skip my swim on August
// twelfth, there should never be a swim on August twelfth ever… if I swap my
// Saturday long bike for a Saturday long run, it should always stay Saturday
// long run regardless. The worst thing is for one of the users to do something
// and have it redo all the work it's done."
//
// WHY THE OLD SHAPE COULD NOT DELIVER THAT
//
// Every decision used to live on the WORKOUT OBJECT — `status: "skipped"`,
// `swappedFrom`, a shorter `estDurationSec`. `rebuildFromToday` regenerates every
// future workout from scratch, so all of it was thrown away, and the code tried to
// win it back afterwards by hunting the fresh plan for a session with the same
// `date + discipline`. That hunt cannot work for the two cases Ryan names:
//
//   • A SWAP CHANGES THE DISCIPLINE. The Saturday session is now a run; the fresh
//     plan puts a bike there; `date+discipline` matches nothing. adapt.ts said so
//     outright — "Moved and swapped are deliberately NOT carried" — which is the
//     bug written down as a policy.
//   • A REBUILD RE-ANCHORS THE WEEK GRID, so ids (`w-3-1-bike` → `w-0-1-bike`)
//     cannot be compared across it either.
//
// And rebuilds are not rare or manual: they fire automatically at three missed
// sessions, on any settings save, and on every engine upgrade. So the plan was
// erasing the athlete's decisions on a schedule they never asked for.
//
// WHAT THIS IS INSTEAD
//
// An append-only, date-anchored ledger on the PLAN. Generation stays pure and
// stateless; the decisions are replayed over its output, chronologically, every
// single time:
//
//     generate(profile) → replay(decisions) → rebalance → validate
//
// A skipped swim cannot come back, because the replay that runs after generation
// skips it again. A swapped Saturday cannot revert, because the replay swaps it
// again. This is a structural guarantee rather than a carry-over heuristic, which
// is the whole difference: there is no list of "decisions we remembered to carry"
// to fall out of date.
//
// ANCHORING, AND WHY IT IS NOT AN ID
//
// A decision points at `date · designed-discipline · ordinal`. Ids are useless
// across a rebuild (they re-anchor). The DESIGNED discipline — what the engine
// asked for, recovered through `swappedFrom` — is stable precisely where the
// current discipline is not, so a chain of swaps on one session keeps pointing at
// the same slot. The ordinal separates two sessions of the same sport on one day
// (doubles) so skipping one never silently skips both.
//
// Pure — no clock, no I/O. The caller supplies today and the sequence number.
// ---------------------------------------------------------------------------

import type { Discipline, Plan, Workout } from "./types";

/** What the ENGINE asked this slot to be, seen through any number of swaps.
 *
 *  `swappedFrom` always holds the EARLIEST session (swapDiscipline keeps the
 *  original rather than the previous one), so this is the engine's own answer
 *  however many times the athlete has changed their mind. */
export function designedDiscipline(w: Workout): Discipline {
  return w.swappedFrom?.discipline ?? w.discipline;
}

/**
 * The stable address of a session: which day, which sport the engine put there,
 * and which one of them if there are several.
 *
 * Computed from the plan rather than parsed out of the id, so it does not depend
 * on the `w-<week>-<day>-<disc>-<seq>` format holding still. Recording and replay
 * both call this, so they agree by construction.
 */
export function anchorOf(plan: Plan, w: Workout): string {
  const designed = designedDiscipline(w);
  const sameSlot = Object.values(plan.workouts)
    .filter((x) => x.date === w.date && designedDiscipline(x) === designed)
    .sort((a, b) => a.id.localeCompare(b.id));
  const ordinal = Math.max(0, sameSlot.findIndex((x) => x.id === w.id));
  return `${w.date}·${designed}·${ordinal}`;
}

/** Find the session a decision points at, in whatever plan we're replaying onto. */
export function findByAnchor(plan: Plan, anchor: string): Workout | undefined {
  return Object.values(plan.workouts).find((w) => anchorOf(plan, w) === anchor);
}

export type DecisionKind = "skip" | "swap" | "resize" | "repace" | "move";

interface DecisionBase {
  /** Monotonic, so replay runs in the order the athlete actually decided things.
   *  A skip made AFTER a swap has to see the swapped session, not the original. */
  seq: number;
  atISO: string;
  anchor: string;
  /** The date the decision was about. Kept alongside the anchor (which encodes it)
   *  so pruning and display never have to parse the anchor apart. */
  dateISO: string;
}

export type Decision =
  | (DecisionBase & { kind: "skip" })
  | (DecisionBase & { kind: "swap"; to: Discipline })
  | (DecisionBase & { kind: "resize"; sec: number; distanceM?: number })
  | (DecisionBase & { kind: "repace"; pacedAt: NonNullable<Workout["pacedAt"]> })
  | (DecisionBase & { kind: "move"; toISO: string });

/** A decision as a caller states it — the bookkeeping (seq, anchor, dates) is
 *  filled in by `recordDecision` so no call site can get it wrong. */
export type DecisionInput =
  | { kind: "skip" }
  | { kind: "swap"; to: Discipline }
  | { kind: "resize"; sec: number; distanceM?: number }
  | { kind: "repace"; pacedAt: NonNullable<Workout["pacedAt"]> }
  | { kind: "move"; toISO: string };

/** The next sequence number for a plan's ledger. */
export function nextSeq(plan: Plan): number {
  return (plan.decisions ?? []).reduce((m, d) => Math.max(m, d.seq), 0) + 1;
}

/**
 * Which earlier decisions a new one makes meaningless.
 *
 * Without this the ledger grows without bound and, worse, contradicts itself: an
 * athlete who resizes a session three times would have three resizes replayed in
 * order, and one who skips a session they had already shortened would replay a
 * resize onto a session that is about to be skipped anyway. Both are harmless
 * today and both are the kind of thing that rots.
 *
 * The rule is per-anchor and per-kind: a decision REPLACES the previous decision
 * of its own kind on the same session, and a SKIP additionally clears the
 * shaping decisions (resize / repace) beneath it, which no longer describe
 * anything. A skip does NOT clear a swap: "the Saturday session is a run, and I
 * am not doing it this week" is two true facts, and the plan needs both — the
 * swap is what stops next week's Saturday reverting to a ride.
 */
function supersededBy(d: Decision): (prior: Decision) => boolean {
  return (prior) => {
    if (prior.anchor !== d.anchor) return false;
    if (prior.kind === d.kind) return true;
    if (d.kind === "skip") return prior.kind === "resize" || prior.kind === "repace";
    return false;
  };
}

/**
 * Write a decision into the plan's ledger.
 *
 * Takes the workout rather than an anchor so callers can't compute one against
 * the wrong plan — the single most likely way to file a decision that then points
 * at nothing.
 */
export function recordDecision(plan: Plan, w: Workout, input: DecisionInput, atISO?: string): Plan {
  const anchor = anchorOf(plan, w);
  const entry = {
    ...input,
    seq: nextSeq(plan),
    atISO: atISO ?? w.date,
    anchor,
    dateISO: w.date,
  } as Decision;
  const kept = (plan.decisions ?? []).filter((prior) => !supersededBy(entry)(prior));
  return { ...plan, decisions: [...kept, entry] };
}

/**
 * Forget decisions about one session — the undo path.
 *
 * Un-skipping or un-swapping has to reach the ledger, not just the workout.
 * Otherwise the athlete puts a session back, the next automatic rebuild replays
 * the decision they just reversed, and it disappears again — an undo button that
 * works until you look away.
 */
export function forgetDecisions(plan: Plan, w: Workout, kinds: DecisionKind[]): Plan {
  const anchor = anchorOf(plan, w);
  return {
    ...plan,
    decisions: (plan.decisions ?? []).filter(
      (d) => !(d.anchor === anchor && kinds.includes(d.kind)),
    ),
  };
}

/**
 * Decisions still worth replaying.
 *
 * A decision about a day that has already happened is history — the session it
 * refers to is preserved verbatim as `kept-` history and is never regenerated, so
 * replaying it would find nothing and, on a plan with a long past, we would walk
 * hundreds of dead entries on every rebuild. The floor is the rebuild's own
 * cutoff, so nothing that can still be regenerated is ever dropped.
 *
 * A MOVE is judged on its destination, not its source, because that is the half
 * still in the future. The case it cannot serve is a move whose SOURCE has since
 * passed: the fresh plan has no session there to pick up, so the move orphans and
 * the destination day is re-planned normally. That is the pre-existing behaviour
 * for moves across a rebuild and it is the honest one — a re-laid calendar may
 * have no equivalent of "this session belongs on Thursday instead", and inventing
 * one silently is worse than planning the day afresh.
 */
export function liveDecisions(decisions: Decision[] | undefined, fromISO: string): Decision[] {
  return (decisions ?? [])
    .filter((d) => (d.kind === "move" ? d.toISO >= fromISO : d.dateISO >= fromISO))
    .sort((a, b) => a.seq - b.seq);
}

/**
 * Reconstruct a ledger for a plan that predates it.
 *
 * Every athlete already training has a plan whose decisions live only on the
 * workout objects. Switching to replay without this would do exactly the thing
 * this whole change exists to stop — their next automatic rebuild would drop the
 * skips and swaps they had already made, one final time, as the parting gift of
 * the fix.
 *
 * Reads the same evidence the old carry-over read, plus the two it could not:
 * `swappedFrom` (a swap) and `movedFrom` (a move). Only future sessions are
 * scanned; the past is preserved verbatim as history and is never regenerated,
 * so it has nothing to replay.
 *
 * Ordering is by date, then by kind, so a session that was both swapped and then
 * shortened replays in the order that produces it. Real sequence numbers aren't
 * recoverable from the workout — this is the best available reconstruction, and
 * from the first recorded decision onwards the true order is kept.
 */
export function backfillDecisions(plan: Plan, fromISO: string): Decision[] {
  const out: Decision[] = [];
  let seq = 0;
  const future = Object.values(plan.workouts)
    .filter((w) => w.date >= fromISO && w.discipline !== "rest" && !w.id.startsWith("kept-"))
    .sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));

  for (const w of future) {
    const anchor = anchorOf(plan, w);
    const base = { anchor, dateISO: w.date, atISO: w.date };
    // A swap first: everything else describes the session as it is NOW, which is
    // the swapped one.
    if (w.swappedFrom && w.discipline !== w.swappedFrom.discipline) {
      out.push({ ...base, seq: ++seq, kind: "swap", to: w.discipline });
    }
    if (w.movedFrom && w.movedFrom !== w.date) {
      out.push({ ...base, seq: ++seq, dateISO: w.movedFrom, anchor: `${w.movedFrom}·${designedDiscipline(w)}·0`, kind: "move", toISO: w.date });
    }
    if (w.pacedAt) {
      out.push({ ...base, seq: ++seq, kind: "repace", pacedAt: w.pacedAt });
    }
    // An athlete resize — a length that differs from the design and that no ease
    // accounts for. `easedCause` sessions are the plan protecting the athlete, not
    // the athlete choosing, and they are carried separately.
    const designedSec = w.prescribed?.estDurationSec;
    if (!w.easedCause && designedSec && Math.abs(w.estDurationSec - designedSec) > 60) {
      out.push({ ...base, seq: ++seq, kind: "resize", sec: w.estDurationSec, distanceM: w.estDistanceM });
    }
    // …and a skip last, because it is a statement about the finished article.
    // `absorbedBy` is excluded: that session was taken off the week by work the
    // athlete actually did, not by a decision to miss it, and replaying it as a
    // skip would make an absorption permanent.
    if (w.status === "skipped" && !w.absorbedBy) {
      out.push({ ...base, seq: ++seq, kind: "skip" });
    }
  }
  return out;
}

/** The ledger to replay for a plan: its own if it has one, otherwise one
 *  reconstructed from the workouts. Once an array exists it is authoritative —
 *  merging the two would double-apply every decision made since the upgrade. */
export function ledgerOf(plan: Plan, fromISO: string): Decision[] {
  return plan.decisions ?? backfillDecisions(plan, fromISO);
}

/**
 * The plan mutations replay needs, injected rather than imported.
 *
 * `swapDiscipline` and friends live in adapt.ts, which is the module that calls
 * replay — importing them here would be a cycle that survives only on function
 * hoisting (the exact trap credit.ts was carved out to escape). Injecting them
 * also means this module can be tested with fakes, and it keeps the ledger free
 * of any opinion about HOW a swap is performed.
 */
export interface ReplayOps {
  swap(plan: Plan, id: string, to: Discipline): Plan;
  resize(plan: Plan, id: string, sec: number): Plan;
  repace(plan: Plan, id: string, pacedAt: NonNullable<Workout["pacedAt"]>): Plan;
  move(plan: Plan, id: string, toISO: string): Plan;
  skip(plan: Plan, id: string): Plan;
}

export interface ReplayResult {
  plan: Plan;
  /** how many decisions found their session — the rest had nothing to apply to */
  applied: number;
  /** decisions whose session no longer exists in the regenerated plan. Not an
   *  error: an athlete who drops from 3 runs to 2 legitimately has a skipped run
   *  that the engine no longer schedules. Surfaced so it can be asserted on. */
  orphaned: Decision[];
}

/**
 * Re-apply the athlete's decisions to a freshly generated plan.
 *
 * Chronological, because the decisions compose: swap Saturday's ride to a run,
 * then shorten it, and the resize must land on the run. Running by KIND instead
 * (all skips, then all swaps…) reverses that and quietly shortens the wrong
 * session.
 *
 * Every step re-reads the session by anchor from the WORKING plan, never from a
 * cached lookup — `swap` and `move` both rewrite the workout, and a stale
 * reference would apply the next decision to a session that no longer exists.
 */
export function replayDecisions(
  fresh: Plan,
  decisions: Decision[] | undefined,
  fromISO: string,
  ops: ReplayOps,
): ReplayResult {
  let working = fresh;
  let applied = 0;
  const orphaned: Decision[] = [];

  for (const d of liveDecisions(decisions, fromISO)) {
    const target = findByAnchor(working, d.anchor);
    if (!target) {
      orphaned.push(d);
      continue;
    }
    switch (d.kind) {
      case "skip":
        working = ops.skip(working, target.id);
        break;
      case "swap":
        // Already this sport (the engine changed its mind and now schedules what
        // the athlete asked for) — nothing to do, and re-swapping would stamp a
        // misleading "Swapped from run" onto a run.
        if (target.discipline !== d.to) working = ops.swap(working, target.id, d.to);
        break;
      case "resize":
        working = ops.resize(working, target.id, d.sec);
        break;
      case "repace":
        working = ops.repace(working, target.id, d.pacedAt);
        break;
      case "move":
        working = ops.move(working, target.id, d.toISO);
        break;
    }
    applied++;
  }

  // The ledger travels with the plan it describes. `fresh` came straight out of
  // `generatePlan`, which knows nothing about decisions, so without this the very
  // act of replaying them would drop them — and the NEXT rebuild would have
  // nothing to replay.
  return { plan: { ...working, decisions: decisions ?? [] }, applied, orphaned };
}
