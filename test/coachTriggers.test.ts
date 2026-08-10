// ---------------------------------------------------------------------------
// The proactive coach (lib/coachTriggers.ts) — ticket #42.
//
// The interesting properties here are not "does it produce a message" but
// "does it SHUT UP". A proactive channel that talks too much doesn't just annoy
// — it trains the athlete to ignore the one message that mattered, which is
// worse than having no channel at all. So most of this file tests silence:
//
//   - an on-track athlete on an ordinary day hears nothing
//   - at most one message a day, ever
//   - a message is never repeated
//   - when several fire, SAFETY wins and celebration waits
//
// And one business property: no LLM anywhere in the path. The engine is
// deterministic, which is the ~$0/athlete cost moat (doc 01 §4 #14).
//
// Clock-safe by construction — "today" is derived from the plan's own weeks, so
// this can't rot at midnight the way #49 rotted three other suites.
//
// Pure, no I/O. Run: npx tsx test/coachTriggers.test.ts
// ---------------------------------------------------------------------------

import { generatePlan } from "../lib/planEngine";
import { setStatus } from "../lib/adapt";
import { addDays, dayIndexOf } from "../lib/dates";
import {
  coachMessagesFor,
  deliveryKey,
  messageKeyOf,
  nextCoachMessage,
  spokenToday,
} from "../lib/coachTriggers";
import type { Plan, Profile } from "../lib/types";

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
function planFor(over: Partial<Profile> = {}): Plan {
  return generatePlan(
    {
      username: "t", raceType: "half", raceDateISO: d(140), level: "intermediate",
      workoutsPerWeek: 8, createdAtISO: ANCHOR, perSport: { swim: 2, bike: 3, run: 3 }, ...over,
    } as unknown as Profile,
    ANCHOR,
  );
}
const none = new Set<string>();

/** An athlete who has actually been training. Without this every past session is
 *  still `planned`, which `assessAdaptation` correctly reads as "missed" — so a
 *  freshly generated plan inspected at week 8 is not an on-track athlete, it's
 *  someone who has done nothing for two months, and the coach is right to speak. */
function onTrack(p: Plan, throughISO: string): Plan {
  const workouts = Object.fromEntries(
    Object.entries(p.workouts).map(([id, w]) => [
      id,
      w.date < throughISO && w.discipline !== "rest"
        ? { ...w, status: "done" as const, rpe: w.primaryZone >= 4 ? 6 : 4, actualDurationSec: w.estDurationSec }
        : w,
    ]),
  );
  return { ...p, workouts };
}

const raw = planFor();
/** A mid-block build week, found from the plan rather than assumed. */
const buildWeek = raw.weeks.find((w) => w.phase === "build" && !w.isRecovery)!;
const MONDAY = buildWeek.startDate;
const WEDNESDAY = addDays(MONDAY, 2);
const plan = onTrack(raw, MONDAY);

// --- 1. SILENCE IS THE DEFAULT --------------------------------------------
section("an on-track athlete on an ordinary day hears nothing");
{
  ok(dayIndexOf(MONDAY) === 0, "the plan's weeks start on Monday, as the briefing assumes");
  const msg = nextCoachMessage({ plan, todayISO: WEDNESDAY, sent: none });
  ok(msg === null, `mid-week, on plan, nothing to say (got ${msg ? `"${msg.title}"` : "null"})`);

  // ...on most days of most weeks, across the whole block
  let spoke = 0;
  let days = 0;
  for (const wk of raw.weeks) {
    for (let i = 0; i < 7; i++) {
      const today = addDays(wk.startDate, i);
      days++;
      // on track AS OF that day, not as of one fixed day
      if (nextCoachMessage({ plan: onTrack(raw, today), todayISO: today, sent: none })) spoke++;
    }
  }
  ok(spoke < days * 0.35, `the coach stays quiet on most days (${spoke}/${days} = ${Math.round((100 * spoke) / days)}%)`);
  ok(spoke > 0, "but it does speak sometimes");
}

// --- 2. AT MOST ONE A DAY, AND NEVER TWICE --------------------------------
section("one message a day, never repeated");
{
  // Walk the whole block the way the app would: deliver at most one, remember it.
  const sent = new Set<string>();
  const perDay: Record<string, number> = {};
  const keysSeen: string[] = [];
  for (const wk of raw.weeks) {
    for (let i = 0; i < 7; i++) {
      const today = addDays(wk.startDate, i);
      if (spokenToday(sent, today)) continue;
      const m = nextCoachMessage({ plan: onTrack(raw, today), todayISO: today, sent: new Set([...sent].map(messageKeyOf)) });
      if (!m) continue;
      perDay[today] = (perDay[today] ?? 0) + 1;
      keysSeen.push(m.key);
      sent.add(deliveryKey(m, today));
    }
  }
  ok(Object.values(perDay).every((n) => n <= 1), "never more than one message on any day");
  ok(new Set(keysSeen).size === keysSeen.length, `no message is ever repeated (${keysSeen.length} sent, ${new Set(keysSeen).size} distinct)`);

  // the dedup ledger round-trips
  const m = { kind: "milestone" as const, key: "perfect:3", title: "t", body: "b", priority: 20 };
  ok(messageKeyOf(deliveryKey(m, WEDNESDAY)) === "perfect:3", "a delivery key recovers its message identity");
  ok(spokenToday([deliveryKey(m, WEDNESDAY)], WEDNESDAY), "and reports the day it went out");
  ok(!spokenToday([deliveryKey(m, WEDNESDAY)], addDays(WEDNESDAY, 1)), "...only for that day");
}

// --- 3. THE MONDAY BRIEFING ------------------------------------------------
section("the weekly briefing lands on Monday, and names the session that matters");
{
  const m = nextCoachMessage({ plan, todayISO: MONDAY, sent: none });
  ok(m?.kind === "weekly-briefing", `Monday produces a briefing (got ${m?.kind})`);
  ok(!!m && /session/i.test(m.body), "it says how many sessions");
  ok(!!m && /matters/i.test(m.body), "and names the one that matters");
  ok(!!m && m.action?.tab === "plan", "and opens the plan");

  for (let i = 1; i < 7; i++) {
    const other = coachMessagesFor({ plan, todayISO: addDays(MONDAY, i), sent: none });
    ok(!other.some((x) => x.kind === "weekly-briefing"), `no briefing on day ${i} of the week`);
  }
  // the same week never briefs twice
  const again = coachMessagesFor({ plan, todayISO: MONDAY, sent: new Set([m!.key]) });
  ok(!again.some((x) => x.kind === "weekly-briefing"), "a briefing already sent is not re-emitted");
}

// --- 4. SAFETY OUTRANKS EVERYTHING ELSE -----------------------------------
section("when several fire at once, the warning wins");
{
  // An athlete who has missed a lot: ease-today and the Monday briefing both fire.
  let behind: Plan = raw;
  const past = Object.values(raw.workouts)
    .filter((w) => w.date < MONDAY && w.discipline !== "rest")
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 14);
  for (const w of past) behind = setStatus(behind, w.id, "skipped");

  const all = coachMessagesFor({ plan: behind, todayISO: MONDAY, sent: none });
  if (all.length > 1) {
    ok(all[0].priority >= all[1].priority, "messages come back best-first");
    ok(all[0].kind !== "milestone", "a celebration never outranks a warning");
  }
  const top = nextCoachMessage({ plan: behind, todayISO: MONDAY, sent: none });
  ok(top !== null, "a badly behind athlete hears something");
  if (all.some((m) => m.kind === "ease-today")) {
    ok(top?.kind === "ease-today", `the ease warning is what gets said (got ${top?.kind})`);
  }
}

// --- 5. RACE WEEK ----------------------------------------------------------
section("race week reassures, advances, and never fires without a race");
{
  const race = plan.raceDateISO;
  const seen = new Set<string>();
  for (let out = 10; out >= 0; out--) {
    const today = addDays(race, -out);
    const msgs = coachMessagesFor({ plan: onTrack(raw, today), todayISO: today, sent: none });
    const rw = msgs.find((m) => m.kind === "race-week");
    ok(!!rw, `${out} days out produces a race-week message`);
    if (rw) {
      ok(!seen.has(rw.key), `${out} days out is a NEW message, not a repeat`);
      seen.add(rw.key);
      ok(rw.body.length > 30, `${out} days out actually says something`);
    }
  }
  // outside the window, silence
  ok(
    !coachMessagesFor({ plan, todayISO: addDays(race, -20), sent: none }).some((m) => m.kind === "race-week"),
    "20 days out is not race week",
  );
  ok(
    !coachMessagesFor({ plan, todayISO: addDays(race, 3), sent: none }).some((m) => m.kind === "race-week"),
    "and it stops after the race",
  );

  // a fitness-goal plan has no race day to count down to
  const fitness = planFor({ raceType: "fitness", raceDateISO: "" } as Partial<Profile>);
  const wk0 = fitness.weeks[1];
  for (let i = 0; i < 7; i++) {
    ok(
      !coachMessagesFor({ plan: fitness, todayISO: addDays(wk0.startDate, i), sent: none }).some((m) => m.kind === "race-week"),
      "no race-week message on a plan with no race",
    );
  }

  // race week suppresses the routine briefing — it has its own voice
  const raceWk = plan.weeks.find((w) => w.isRaceWeek);
  if (raceWk) {
    ok(
      !coachMessagesFor({ plan, todayISO: raceWk.startDate, sent: none }).some((m) => m.kind === "weekly-briefing"),
      "no ordinary briefing during race week",
    );
  }
}

// --- 6. determinism (the cost moat depends on it) -------------------------
section("deterministic — the same day always produces the same message");
{
  for (const iso of [MONDAY, WEDNESDAY, addDays(plan.raceDateISO, -2)]) {
    const a = JSON.stringify(coachMessagesFor({ plan, todayISO: iso, sent: none }));
    const b = JSON.stringify(coachMessagesFor({ plan, todayISO: iso, sent: none }));
    ok(a === b, `${iso}: identical output for identical input`);
  }
  // and every message is fully formed — a proactive channel that ships an empty
  // body is worse than one that stays quiet
  for (const wk of plan.weeks) {
    for (let i = 0; i < 7; i++) {
      const day = addDays(wk.startDate, i);
      for (const m of coachMessagesFor({ plan: onTrack(raw, day), todayISO: day, sent: none })) {
        ok(m.title.trim().length > 0, `${m.kind}: has a title`);
        ok(m.body.trim().length > 10, `${m.kind}: has a real body`);
        ok(m.key.trim().length > 0, `${m.kind}: has a dedup key`);
      }
    }
  }
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures) {
  console.error(`\n❌ ${failures} coach-trigger invariant(s) FAILED`);
  process.exit(1);
}
console.log("\n✅ all coach-trigger invariants passed");
