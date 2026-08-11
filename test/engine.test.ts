/**
 * Trifecta plan-engine invariant tests — the "is the plan actually correct/safe" gate.
 *
 * Pure + deterministic (no simulator, no network). Run: `npm test`.
 *
 * These assert the safety + physiology properties a human coach eyeballs when they glance
 * at a plan and go "yeah, that's sane": plans are non-degenerate, honor the requested
 * frequency, ramp load safely (with deloads), taper before the race, progress through the
 * phases in order, and keep intensity polarized (mostly easy). Thresholds are calibrated
 * to the engine's real output with margin, so a correct plan never false-fails.
 */
import { generatePlan, MAX_WORKOUTS, MIN_WORKOUTS, clampWorkouts, injuryMods, restDayFor } from "../lib/planEngine";
import type { Profile, Plan, Injury, Workout, Segment } from "../lib/types";
import { ZONES } from "../lib/zones";
import { targetView } from "../lib/targets";
import { addDays, mondayOf, todayISO } from "../lib/dates";

let checks = 0;
let failures = 0;
function ok(cond: boolean, msg: string) {
  checks++;
  if (!cond) {
    failures++;
    console.error("  ✗ " + msg);
  }
}
function section(name: string) {
  console.log("\n• " + name);
}

// A Monday in the FUTURE, not a fixed date.
//
// `generatePlan` reads the wall clock and clamps an anchor that has already passed to
// today, so a pinned Monday rots the instant it slips into the past — and it did. From
// 2026-08-04 the "race in 6 days" case below resolved to a race that had already happened,
// which yields a ZERO-week plan, and `p.weeks[p.weeks.length - 1].isRaceWeek` threw. That
// crashed the file outright, and because `npm test` chains with `&&` it took every suite
// after it down too: the engine's own gate has been dead for a week for reasons that have
// nothing to do with the engine.
//
// Rolling the anchor forward keeps every relative offset (`weeksFrom`, `plusDays`) meaning
// what it says. The real cure is injecting the clock into `generatePlan` (doc 04 §4.3);
// until then, don't pin dates in a suite that calls it.
const ANCHOR = mondayOf(addDays(todayISO(), 7));
function weeksFrom(w: number): string {
  const d = new Date(ANCHOR + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + w * 7);
  return d.toISOString().slice(0, 10);
}
function profile(over: Partial<Profile>): Profile {
  return {
    username: "test",
    raceType: "olympic",
    raceDateISO: weeksFrom(16),
    level: "intermediate",
    workoutsPerWeek: 6,
    createdAtISO: ANCHOR,
    ...over,
  };
}
const totalSec = (p: Plan) => Object.values(p.workouts).reduce((s, w) => s + (w.estDurationSec || 0), 0);
const PHASE_ORDER: Record<string, number> = { base: 0, build: 1, peak: 2, taper: 3 };

const CASES: { name: string; p: Profile; race: boolean }[] = [
  { name: "fitness/intermediate/6", p: profile({ raceType: "fitness", raceDateISO: "" }), race: false },
  { name: "olympic/beginner/5", p: profile({ raceType: "olympic", level: "beginner", workoutsPerWeek: 5, raceDateISO: weeksFrom(14) }), race: true },
  { name: "half/intermediate/6", p: profile({ raceType: "half", workoutsPerWeek: 6, raceDateISO: weeksFrom(20) }), race: true },
  { name: "full/advanced/10", p: profile({ raceType: "full", level: "advanced", workoutsPerWeek: 10, raceDateISO: weeksFrom(24) }), race: true },
];

// ---- 1. determinism ----
section("deterministic: identical input → identical plan");
{
  const a = generatePlan(profile({}), ANCHOR);
  const b = generatePlan(profile({}), ANCHOR);
  ok(Object.keys(a.workouts).length === Object.keys(b.workouts).length, "same workout count");
  ok(totalSec(a) === totalSec(b), "same total duration");
  ok(JSON.stringify(a.weeks.map((w) => w.targetHours)) === JSON.stringify(b.weeks.map((w) => w.targetHours)), "same weekly hours");
}

// ---- 2. non-degenerate + frequency + polarized, every case ----
for (const c of CASES) {
  section("case: " + c.name);
  const plan = generatePlan(c.p, ANCHOR);
  const ws = Object.values(plan.workouts);
  ok(plan.weeks.length >= 1, "has ≥1 week");
  ok(ws.length >= 1, "has ≥1 workout");
  ok(ws.every((w) => w.estDurationSec > 0), "every workout has positive duration");
  ok(ws.every((w) => (w.estDistanceM ?? 0) >= 0), "no negative distances");
  ok(ws.every((w) => [1, 2, 3, 4, 5].includes(w.primaryZone)), "every workout has a valid zone (1–5)");

  // frequency: never over-schedule the requested count; and actually deliver it some weeks
  const counts = plan.weeks.map((w) => w.workoutIds.length);
  ok(counts.every((n) => n <= c.p.workoutsPerWeek), `never exceeds requested ${c.p.workoutsPerWeek}/wk`);
  ok(counts.every((n) => n <= MAX_WORKOUTS), "never exceeds MAX_WORKOUTS");
  ok(counts.some((n) => n === c.p.workoutsPerWeek), `hits the requested ${c.p.workoutsPerWeek}/wk on some week`);

  // polarized intensity: most real (non-rest/strength) sessions are easy (Z1–Z2)
  const endurance = ws.filter((w) => w.discipline !== "rest" && w.discipline !== "strength");
  if (endurance.length) {
    const easy = endurance.filter((w) => w.primaryZone <= 2).length;
    ok(easy / endurance.length >= 0.5, `≥50% easy (Z1–Z2); got ${((100 * easy) / endurance.length).toFixed(0)}%`);
  }
}

// ---- 3. safe load ramp + deloads (race plans, which periodize) ----
for (const c of CASES.filter((x) => x.race)) {
  section("safe ramp + deloads: " + c.name);
  const plan = generatePlan(c.p, ANCHOR);
  // walk only NON-recovery weeks so a deload-then-rebuild bounce isn't mistaken for a spike
  const build = plan.weeks.filter((w) => !w.isRecovery && !w.isRaceWeek).map((w) => w.targetHours);
  let maxJump = 1;
  for (let i = 1; i < build.length; i++) if (build[i - 1] > 0) maxJump = Math.max(maxJump, build[i] / build[i - 1]);
  ok(maxJump <= 1.35, `no >35% week-over-week volume spike between load weeks (max ${((maxJump - 1) * 100).toFixed(0)}%)`);
  ok(plan.weeks.some((w) => w.isRecovery), "includes recovery/deload weeks");
}

// ---- 4. taper + race week + phase order (race plans) ----
for (const c of CASES.filter((x) => x.race)) {
  section("taper + periodization: " + c.name);
  const plan = generatePlan(c.p, ANCHOR);
  const last = plan.weeks[plan.weeks.length - 1];
  const raceWeek = plan.weeks.find((w) => w.isRaceWeek);
  const peak = Math.max(...plan.weeks.map((w) => w.targetHours));
  ok(!!raceWeek, "has a race week");
  ok(last.isRaceWeek, "race week is the LAST week");
  ok(!!raceWeek && raceWeek.targetHours < peak, "race-week volume is below peak (taper)");
  ok(plan.weeks.some((w) => w.phase === "taper"), "has a taper phase");
  // phases only ever advance base → build → peak → taper (never regress)
  const idxs = plan.weeks.map((w) => PHASE_ORDER[w.phase]);
  ok(idxs.every((v, i) => i === 0 || v >= idxs[i - 1]), "phases progress in order, never regress");
}

// ---- 5. injuries reduce load on the affected sport ----
section("injuries: a run niggle reduces run volume vs the same athlete uninjured");
{
  const kneeInjury: Injury = { id: "inj1", area: "left knee", disciplines: ["run"], severity: "moderate" };
  const base = generatePlan(profile({ raceType: "half", raceDateISO: weeksFrom(20) }), ANCHOR);
  const hurt = generatePlan(profile({ raceType: "half", raceDateISO: weeksFrom(20), injuries: [kneeInjury] }), ANCHOR);
  const runSec = (p: Plan) => Object.values(p.workouts).filter((w) => w.discipline === "run").reduce((s, w) => s + w.estDurationSec, 0);
  ok(runSec(hurt) < runSec(base), `injured run volume (${Math.round(runSec(hurt) / 60)}m) < healthy (${Math.round(runSec(base) / 60)}m)`);
}

// ---- 6. clampWorkouts edge cases (regression: clampWorkouts(0) returned 6) ----
section("clampWorkouts edge cases");
{
  ok(clampWorkouts(0) === MIN_WORKOUTS, `clampWorkouts(0) clamps to ${MIN_WORKOUTS}, not 6`);
  ok(clampWorkouts(undefined) === 6, "clampWorkouts(undefined) defaults to 6");
  ok(clampWorkouts(-3) === MIN_WORKOUTS, "clampWorkouts(-3) clamps to MIN");
  ok(clampWorkouts(100) === MAX_WORKOUTS, "clampWorkouts(100) clamps to MAX");
  ok(clampWorkouts(6) === 6, "clampWorkouts(6) stays 6");
}

// ---- 7. a race sooner than the minimum span never back-dates the start ----
section("compressed plan: start is never back-dated into the past");
{
  const soon = generatePlan(profile({ raceType: "olympic", raceDateISO: weeksFrom(2) }), ANCHOR); // race ~2 wk out
  ok(soon.weeks[0].startDate >= weeksFrom(-1), `first week not back-dated (start ${soon.weeks[0].startDate}, anchor ${ANCHOR})`);
  ok(soon.weeks[soon.weeks.length - 1].isRaceWeek, "race still lands in the last week");
}

// ---- 9. weeklyHoursCap is a HARD ceiling on emitted work ----
// Regression: the cap only limited the notional target. Fixed sessions were built at
// their intrinsic durations and the minMin floor re-inflated the scalables, so a 3 h
// cap with 8 sessions emitted a 6 h week — double what the athlete asked for, while
// the AI coach prompt asserted the cap was being honoured.
section("weeklyHoursCap: no week ever exceeds an explicit cap");
{
  const sweep: { sessions: number; cap: number; over?: Partial<Profile> }[] = [
    { sessions: 6, cap: 6 },
    { sessions: 10, cap: 6 },
    { sessions: 12, cap: 6 },
    { sessions: 10, cap: 4 },
    { sessions: 8, cap: 3 },
    { sessions: 14, cap: 8, over: { raceType: "full", level: "advanced", raceDateISO: weeksFrom(24) } },
  ];
  for (const { sessions, cap, over } of sweep) {
    const p = generatePlan(profile({ workoutsPerWeek: sessions, weeklyHoursCap: cap, ...over }), ANCHOR);
    let worst = 0;
    for (const w of p.weeks) {
      if (w.isRaceWeek) continue; // the race itself is not "training hours"
      const hrs = w.workoutIds.reduce((a, id) => a + (p.workouts[id]?.estDurationSec ?? 0), 0) / 3600;
      worst = Math.max(worst, hrs);
    }
    ok(worst <= cap + 0.01, `${sessions} sessions @ ${cap}h cap → worst week ${worst.toFixed(2)}h`);
  }
  // and with no cap set, nothing changes (the enforcement must be opt-in)
  const uncapped = generatePlan(profile({ workoutsPerWeek: 10 }), ANCHOR);
  ok(Object.keys(uncapped.workouts).length > 0, "no cap set → plan still generates normally");
}

// ---- 10. a niggling sport never ABSORBS freed volume ----
// Regression: the "healthy" filter was `volMult >= 0.85`, but a niggle sets volMult to
// exactly 0.85 — so a complaining sport qualified as healthy and soaked up the sessions
// freed from worse-injured sports. A shin niggle DOUBLED that athlete's runs.
section("injuries: a niggling sport never absorbs volume freed from other sports");
{
  const runCount = (p: Plan) =>
    Object.values(p.workouts).filter((w) => w.discipline === "run").length;
  const healthy = generatePlan(profile({ raceType: "half", raceDateISO: weeksFrom(20), workoutsPerWeek: 9 }), ANCHOR);
  const multi = generatePlan(
    profile({
      raceType: "half",
      raceDateISO: weeksFrom(20),
      workoutsPerWeek: 9,
      injuries: [
        { id: "i1", area: "left shoulder", disciplines: ["swim"], severity: "severe" },
        { id: "i2", area: "left knee", disciplines: ["bike"], severity: "moderate" },
        { id: "i3", area: "right shin", disciplines: ["run"], severity: "niggle" },
      ],
    }),
    ANCHOR,
  );
  ok(
    runCount(multi) <= runCount(healthy),
    `niggling run volume (${runCount(multi)} sessions) never exceeds uninjured (${runCount(healthy)})`,
  );
}

// ---- 11. race week honours injuries + equipment ----
// Regression: buildRaceWeek consulted neither, so an athlete whose plan had avoided
// running all block was handed a Z4 threshold run six days out, and a pool-less
// athlete was given a swim.
section("race week respects injury caps and equipment");
{
  // ANCHOR is a Monday, so a race on weeksFrom(n) is ALSO a Monday — raceDayIndex 0,
  // which skips every opener and would make these assertions pass vacuously. Race on
  // the Sunday so the Tue/Wed/Thu openers genuinely exist.
  const sunday = (n: number) => {
    const d = new Date(weeksFrom(n) + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 6);
    return d.toISOString().slice(0, 10);
  };
  const openersOf = (p: Plan) => {
    const rw = p.weeks[p.weeks.length - 1];
    return rw.workoutIds.map((id) => p.workouts[id]).filter((w) => w.type === "race_prep");
  };

  const healthy = generatePlan(profile({ raceType: "olympic", raceDateISO: sunday(12) }), ANCHOR);
  ok(openersOf(healthy).length > 0, `healthy athlete still gets race-week openers (${openersOf(healthy).length})`);

  const hurt = generatePlan(
    profile({
      raceType: "olympic",
      raceDateISO: sunday(12),
      injuries: [{ id: "i1", area: "right achilles", disciplines: ["run"], severity: "severe" }],
      equipment: { pool: false, trainer: true, gym: true },
    }),
    ANCHOR,
  );
  const o = openersOf(hurt);
  ok(!o.some((w) => w.discipline === "run"), "no run opener for a severe run injury (avoid)");
  ok(!o.some((w) => w.discipline === "swim"), "no swim opener when the athlete has no pool");
  // This used to assert `every(w => w.primaryZone <= 3)` on a profile whose BIKE is
  // perfectly healthy — a broader claim than the name makes, and it only held because
  // sweet spot was mislabeled Z3. A healthy sport SHOULD get a sharp opener in race
  // week; that's what openers are for. Assert the invariant the name describes: every
  // opener respects ITS OWN sport's cap.
  const capOf = injuryMods(
    profile({
      raceType: "olympic",
      raceDateISO: sunday(12),
      injuries: [{ id: "i1", area: "right achilles", disciplines: ["run"], severity: "severe" }],
      equipment: { pool: false, trainer: true, gym: true },
    }),
  );
  ok(
    o.every((w) => {
      const sport = w.discipline as "swim" | "bike" | "run";
      const cap = capOf[sport]?.capZone;
      return cap == null || w.primaryZone <= cap;
    }),
    "every race-week opener respects its own sport's injury zone cap",
  );
  ok(
    openersOf(healthy).some((w) => w.primaryZone >= 4),
    "a healthy athlete still gets a genuinely sharp opener (that's the point of openers)",
  );
}

// ---- 11b. an injury cap is a cap on INTENSITY, not just on the zone label ----
// The niggle path used to route to bikeSweetSpot, which prescribes 88–94% FTP. Because
// it was tagged Z3, `capZone: 3` looked satisfied while the athlete was handed
// near-threshold work — the guard reduced the label, not the load. Assert against the
// real prescribed %FTP, not the zone number, so a future relabel can't hide it again.
section("injury caps bound real intensity, not just the zone label");
{
  // The hardest intensity this session actually ASKS FOR. Reading the zone alone is
  // useless here: the zone label is the thing that was lying (sweet spot claimed Z3 while
  // instructing 88–94% FTP), so a zone-based check passes on the buggy engine. Prefer, in
  // order: the %FTP the description states out loud, then an explicit ftpPct band, then
  // the zone. Parent segments count too — the repeat wrapper is where "3 × (8 min @
  // 88–94% FTP …)" lives, while its children just say "8 min sweet spot".
  const ftpOf = (w: Workout): number => {
    let hi = 0;
    const walk = (segs: Segment[]) => {
      for (const s of segs) {
        if ((s.discipline ?? w.discipline) === "bike" && s.kind !== "rest") {
          const said = s.description.match(/(\d{2,3})[–-](\d{2,3})%\s*FTP/);
          if (said) hi = Math.max(hi, Number(said[2]));
          else if (s.ftpPct) hi = Math.max(hi, s.ftpPct[1]);
          else if (s.zone && !s.children?.length) hi = Math.max(hi, ZONES[s.zone].ftpPct[1]);
        }
        if (s.children?.length) walk(s.children);
      }
    };
    walk(w.segments ?? []);
    return hi;
  };

  for (const severity of ["niggle", "moderate"] as const) {
    const p = profile({
      raceType: "half",
      raceDateISO: weeksFrom(20),
      injuries: [{ id: "b1", area: "left knee", disciplines: ["bike"], severity }],
    });
    const plan = generatePlan(p, ANCHOR);
    const cap = injuryMods(p).bike.capZone;
    const capPct = ZONES[cap].ftpPct[1];
    const over = Object.values(plan.workouts).filter(
      (w) => w.discipline === "bike" && w.type !== "race_prep" && ftpOf(w) > capPct,
    );
    ok(
      over.length === 0,
      `${severity} bike injury (cap Z${cap} = ≤${capPct}% FTP): no bike session exceeds it` +
        (over.length ? ` — worst: ${over[0].title} @ ${ftpOf(over[0])}%` : ""),
    );
  }

  // The label must not lie. A description may name a NARROWER range than its band
  // (prescribing the top of Z4 is ordinary coaching) but never one that escapes it —
  // that's the sweet-spot bug: "88–94% FTP" while the target rendered Z3's 76–90%.
  let escapes = 0;
  const worst: string[] = [];
  for (const c of CASES) {
    const plan = generatePlan(c.p, ANCHOR);
    for (const w of Object.values(plan.workouts)) {
      const walk = (segs: Segment[]) => {
        for (const s of segs) {
          if (s.children?.length) { walk(s.children); continue; }
          if (!s.zone || (s.discipline ?? w.discipline) !== "bike") continue;
          const m = s.description.match(/(\d{2,3})[–-](\d{2,3})%\s*FTP/);
          if (!m) continue;
          const [lo, hi] = [Number(m[1]), Number(m[2])];
          const band = s.ftpPct ?? ZONES[s.zone].ftpPct;
          if (lo < band[0] || hi > band[1]) {
            escapes++;
            if (worst.length < 3) worst.push(`${w.title}: says ${lo}–${hi}%, target shows ${band[0]}–${band[1]}%`);
          }
        }
      };
      walk(w.segments ?? []);
    }
  }
  ok(escapes === 0, `no bike segment names a %FTP range outside its own target (${escapes})${worst.length ? " — " + worst.join(" | ") : ""}`);
}

// ---- 12. the taper is monotonically easier ----
// The historical non-monotone full-IM taper (0.42 → 0.55 → 0.32) slipped past the ramp
// check by 2 points. Assert the property directly so it can never regress.
section("taper target hours never rise week over week");
{
  for (const c of CASES.filter((c) => c.race)) {
    const p = generatePlan(c.p, ANCHOR);
    const taper = p.weeks.filter((w) => w.phase === "taper");
    let monotone = true;
    for (let i = 1; i < taper.length; i++) if (taper[i].targetHours > taper[i - 1].targetHours) monotone = false;
    ok(monotone, `${c.name}: taper hours non-increasing (${taper.map((w) => w.targetHours).join(" → ")})`);
  }
}

// ---- 13. short runways still taper ----
// Regression: the phase counts didn't sum to totalWeeks on a short runway, so the week
// loop never reached the taper branch. A race ≤13 days out got NO taper phase and race
// week was labelled "Build" carrying the HIGHEST targetHours in the plan — the plan told
// someone racing in 13 days that this was their biggest week.
section("short runways: race week is always a taper, and always the lightest week");
{
  const plusDays = (n: number) => {
    const d = new Date(ANCHOR + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  for (const days of [6, 10, 13, 14, 20, 27, 45]) {
    const p = generatePlan(profile({ raceType: "olympic", raceDateISO: plusDays(days) }), ANCHOR);
    const raceWeek = p.weeks[p.weeks.length - 1];
    const maxHours = Math.max(...p.weeks.map((w) => w.targetHours));
    ok(raceWeek.isRaceWeek && raceWeek.phase === "taper", `race in ${days}d → race week is taper (got ${raceWeek.phase})`);
    ok(
      p.weeks.length === 1 || raceWeek.targetHours < maxHours,
      `race in ${days}d → race week (${raceWeek.targetHours}h) is lighter than the peak (${maxHours}h)`,
    );
  }
}

// ---- 14. every athlete gets a full day off, every week ----
// A rest day used to be OPT-IN: the -1000 guard sat behind `restDayPreference != null`,
// so an athlete who skipped the optional onboarding chip got no protected day at all.
// Measured on the unfixed engine: a 70.3 at 8 sessions/week gave 14 off days in 147 and a
// 30-day unbroken training streak; a full-IM build gave 6 off days in 224 and a 203-day
// streak. Assert the floor directly, across the profile space, with NO preference set.
section("rest-day floor: nobody trains seven days a week");
{
  const DAY = 86400000;
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
  const dayCount = (p: Plan) => {
    const on = new Set(
      Object.values(p.workouts).filter((w) => w.discipline !== "rest").map((w) => w.date),
    );
    const start = Date.parse(p.weeks[0].startDate + "T00:00:00Z");
    const end = Date.parse(p.weeks[p.weeks.length - 1].startDate + "T00:00:00Z") + 6 * DAY;
    let streak = 0, maxStreak = 0, off = 0, total = 0;
    for (let t = start; t <= end; t += DAY) {
      total++;
      if (on.has(iso(t))) { streak++; maxStreak = Math.max(maxStreak, streak); }
      else { streak = 0; off++; }
    }
    return { maxStreak, off, total };
  };

  const heavy: { name: string; p: Profile }[] = [
    { name: "70.3 @ 8/wk", p: profile({ raceType: "half", raceDateISO: weeksFrom(20), perSport: { swim: 2, bike: 3, run: 3 } }) },
    { name: "70.3 @ 8/wk + strength", p: profile({ raceType: "half", raceDateISO: weeksFrom(20), perSport: { swim: 2, bike: 3, run: 3 }, strength: { enabled: true, daysPerWeek: 2, split: "full" } }) },
    { name: "full @ 11/wk", p: profile({ raceType: "full", level: "advanced", workoutsPerWeek: 11, raceDateISO: weeksFrom(30) }) },
    { name: "fitness @ 8/wk", p: profile({ raceType: "fitness", raceDateISO: "", workoutsPerWeek: 8 }) },
  ];
  for (const h of heavy) {
    const { maxStreak, off, total } = dayCount(generatePlan(h.p, ANCHOR));
    // one day off per 7 means a streak can never exceed 6
    ok(maxStreak <= 6, `${h.name}: never more than 6 consecutive training days (got ${maxStreak})`);
    ok(off >= Math.floor(total / 7), `${h.name}: at least one day off per week (${off} off in ${total}d)`);
  }

  // the athlete's stated preference still decides WHICH day
  for (const pref of [0, 3, 6]) {
    const p = profile({ raceType: "half", raceDateISO: weeksFrom(20), perSport: { swim: 2, bike: 3, run: 3 }, restDayPreference: pref });
    ok(restDayFor(p) === pref, `restDayPreference ${pref} is honoured`);
    const plan = generatePlan(p, ANCHOR);
    const onPref = Object.values(plan.workouts).filter(
      (w) => w.discipline !== "rest" && w.type !== "race_prep" && new Date(w.date + "T00:00:00Z").getUTCDay() === (pref + 1) % 7,
    );
    ok(onPref.length === 0, `no ordinary session lands on the chosen rest day (pref ${pref}, found ${onPref.length})`);
  }

  // and with NO preference it's still a real, STABLE day — one that doesn't drift week to
  // week, because a rest day that moves silently reintroduces long streaks (resting Monday
  // one week and Friday the next leaves nine days on in between).
  const noPref = profile({ raceType: "half", raceDateISO: weeksFrom(20), perSport: { swim: 2, bike: 3, run: 3 } });
  ok(restDayFor(noPref) >= 0 && restDayFor(noPref) < 7, "a rest day is chosen even with no preference");
  const stable = generatePlan(noPref, ANCHOR);
  const restDow = restDayFor(noPref);
  const strays = Object.values(stable.workouts).filter(
    (w) => w.discipline !== "rest" && w.type !== "race_prep" && new Date(w.date + "T00:00:00Z").getUTCDay() === (restDow + 1) % 7,
  );
  ok(strays.length === 0, `the default rest day is the same day every week (${strays.length} strays)`);
}

// ---- 15. hard weight-bearing work is never on back-to-back days ----
// assignDays only ever penalised two hard sessions on the SAME day; there was no
// cross-day term at all, so hard days were separated only by an accident of the default
// prefDays. Swim is deliberately exempt: it's non-weight-bearing, so hard run Tue /
// hard swim Wed / hard ride Thu is a well-spaced week, not three hard days in a row.
section("hard-day spacing: 48h between hard run/bike/brick work");
{
  const loadsMsk = (d: string) => d === "run" || d === "bike" || d === "brick";
  const hardImpact = (w: Workout) => loadsMsk(w.discipline) && (w.primaryZone >= 4 || w.type === "brick");
  const DAY = 86400000;

  // The DEFAULT profile is not a real test of this: with prefDays at Tue/Thu/Sat the
  // hard days fall apart naturally, so a plan with no spacing constraint at all still
  // passes. Doc 04 named the trigger — "change the rest day, the session count, or a
  // prefDay and you can get a hard threshold run followed by a hard ride" — so these
  // cases deliberately move `longSessionDay` and `restDayPreference` off the lucky
  // defaults. Each one below produces adjacency on an engine without the cross-day term.
  const base = { raceType: "half" as const, raceDateISO: weeksFrom(20), perSport: { swim: 2, bike: 3, run: 3 } };
  const cases: { name: string; p: Profile }[] = [
    { name: "olympic/beginner", p: profile({ raceType: "olympic", level: "beginner", workoutsPerWeek: 5, raceDateISO: weeksFrom(14) }) },
    { name: "olympic/elite 12", p: profile({ raceType: "olympic", level: "elite", workoutsPerWeek: 12, raceDateISO: weeksFrom(18) }) },
    { name: "70.3 @ 8/wk (default days)", p: profile(base) },
    { name: "full/advanced 11", p: profile({ raceType: "full", level: "advanced", workoutsPerWeek: 11, raceDateISO: weeksFrom(30) }) },
    { name: "run niggle", p: profile({ ...base, injuries: [{ id: "n1", area: "shin", disciplines: ["run"], severity: "niggle" }] }) },
    // --- the cases that actually exercise the constraint ---
    { name: "long day = Sunday", p: profile({ ...base, longSessionDay: 6 }) },
    { name: "long day = Wednesday", p: profile({ ...base, longSessionDay: 2 }) },
    { name: "rest day = Thursday", p: profile({ ...base, restDayPreference: 3 }) },
    { name: "rest day = Wednesday", p: profile({ ...base, restDayPreference: 2 }) },
    { name: "rest Thu + long Sun", p: profile({ ...base, restDayPreference: 3, longSessionDay: 6 }) },
    { name: "rest Wed + long Wed + run focus", p: profile({ ...base, restDayPreference: 2, longSessionDay: 2, focusDiscipline: "run" }) },
  ];

  for (const c of cases) {
    const plan = generatePlan(c.p, ANCHOR);
    const byDate = new Map<string, Workout[]>();
    for (const w of Object.values(plan.workouts)) {
      if (w.discipline === "rest") continue;
      if (!byDate.has(w.date)) byDate.set(w.date, []);
      byDate.get(w.date)!.push(w);
    }
    const start = Date.parse(plan.weeks[0].startDate + "T00:00:00Z");
    const end = Date.parse(plan.weeks[plan.weeks.length - 1].startDate + "T00:00:00Z") + 6 * DAY;
    let adjacent = 0;
    let example = "";
    for (let t = start + DAY; t <= end; t += DAY) {
      const today = byDate.get(new Date(t).toISOString().slice(0, 10)) ?? [];
      const yest = byDate.get(new Date(t - DAY).toISOString().slice(0, 10)) ?? [];
      // race week is exempt: openers + the race itself are deliberately clustered
      if (today.some((w) => w.type === "race_prep") || yest.some((w) => w.type === "race_prep")) continue;
      if (yest.some(hardImpact) && today.some(hardImpact)) {
        adjacent++;
        if (!example) {
          example = `${yest.filter(hardImpact).map((w) => w.title).join(",")} → ${today.filter(hardImpact).map((w) => w.title).join(",")}`;
        }
      }
    }
    ok(adjacent === 0, `${c.name}: no back-to-back hard run/bike/brick days (${adjacent})${example ? ` — e.g. ${example}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// Bike targets stay executable without a power meter.
//
// Onboarding tells an athlete with no meter to leave FTP blank and promises we'll
// pace their rides by heart rate and feel instead. The bike branch headlined
// "56–75% FTP" regardless — a percentage of a number they were just told they
// didn't need, and cannot measure. Run and swim degrade to real pace targets, so
// only the bike broke the promise; a persona tester's single most important
// question was exactly this, and the honest answer was "no".
//
// The invariant: whatever the athlete has or hasn't entered, the HEADLINE target
// must be something they can act on out on the road.
{
  const base: Profile = {
    username: "t",
    raceType: "half",
    raceDateISO: "2026-11-14",
    level: "intermediate",
    workoutsPerWeek: 6,
    perSport: { swim: 2, bike: 2, run: 2 },
    strength: { enabled: false, daysPerWeek: 0, split: "full" },
    longSessionDay: 5,
    restDayPreference: 0,
    unitPreference: "metric",
    equipment: { pool: true, trainer: true, gym: true },
    blackouts: [],
    createdAtISO: "2026-07-29T00:00:00.000Z",
  };

  const cases: { name: string; profile: Profile; expect: RegExp }[] = [
    // no meter, no HR data → RPE plus plain words
    { name: "no FTP, no HR", profile: base, expect: /^RPE \d+(–\d+)? · \D+$/ },
    // no meter but a max HR → heart rate, which their watch shows
    { name: "no FTP, maxHR", profile: { ...base, maxHR: 188 }, expect: /^\d+–\d+ bpm$/ },
    // has a meter → watts, as before
    { name: "FTP set", profile: { ...base, ftp: 240 }, expect: /^\d+–\d+ W$/ },
  ];

  for (const c of cases) {
    const plan = generatePlan(c.profile, "2026-07-29");
    for (const z of [1, 2, 3, 4, 5] as const) {
      const view = targetView("bike", z, plan.paces, "metric");
      ok(
        c.expect.test(view.primary),
        `${c.name}: bike Z${z} headline is actionable — got "${view.primary}"`,
      );
      ok(
        !/% FTP/.test(view.primary) || !!plan.paces.bike.ftp,
        `${c.name}: bike Z${z} never headlines %FTP without an FTP — got "${view.primary}"`,
      );
    }
  }

  // and the %FTP prescription is never simply lost — it stays as supporting detail
  const noFtp = generatePlan(base, ANCHOR); // never a pinned date — see the ANCHOR note
  const v = targetView("bike", 2, noFtp.paces, "metric");
  ok(
    v.secondary.some((s) => /% FTP/.test(s)),
    `no FTP: the %FTP band survives in secondary — got [${v.secondary.join(" | ")}]`,
  );
}

// ---- 17. a week's stated target is what it actually prescribes ----
// `targetHours` was the notional budget a week was SLICED from, not what came out of the
// slicing. Each session's share is clamped to its own [minMin, maxMin], and whatever the
// clamp shaved off was dropped rather than offered to anyone else — so the gap grew with
// volume, exactly backwards. Measured before the fix: -22.7% at 70.3 intermediate, -35.6%
// at full/advanced, and **-42.9%** for an elite Ironman, i.e. a week advertised as 22 h
// that prescribed 12.5 h. Progress, the Today ring and the coach's prompt all read this
// number, so it was one wrong figure repeated on four screens.
section("targetHours tells the truth about the week");
{
  const cases: { name: string; p: Profile }[] = [
    { name: "70.3/intermediate/6", p: profile({ raceType: "half", raceDateISO: weeksFrom(20) }) },
    { name: "70.3/beginner/5", p: profile({ raceType: "half", level: "beginner", workoutsPerWeek: 5, raceDateISO: weeksFrom(16) }) },
    { name: "full/advanced/10", p: profile({ raceType: "full", level: "advanced", workoutsPerWeek: 10, raceDateISO: weeksFrom(30) }) },
    { name: "full/elite/14", p: profile({ raceType: "full", level: "elite", workoutsPerWeek: 14, raceDateISO: weeksFrom(40) }) },
    { name: "olympic/intermediate/7", p: profile({ raceType: "olympic", workoutsPerWeek: 7, raceDateISO: weeksFrom(16) }) },
    { name: "fitness/intermediate/6", p: profile({ raceType: "fitness", raceDateISO: "" }) },
    // the paths that DELETE sessions after the weeks are built — reconciliation has to
    // run after them, or any week they touch goes back to overstating itself
    { name: "with blackouts", p: profile({ raceType: "half", raceDateISO: weeksFrom(20), blackouts: [{ startISO: weeksFrom(4), endISO: weeksFrom(5), label: "away" }] }) },
    { name: "with an hours cap", p: profile({ raceType: "full", level: "advanced", workoutsPerWeek: 12, weeklyHoursCap: 8, raceDateISO: weeksFrom(24) }) },
  ];
  for (const c of cases) {
    const plan = generatePlan(c.p, ANCHOR);
    let worst = 0;
    let worstWk = -1;
    for (const wk of plan.weeks) {
      if (wk.isRaceWeek || wk.targetHours <= 0) continue;
      const sec = wk.workoutIds.reduce((a, id) => a + (plan.workouts[id]?.estDurationSec ?? 0), 0);
      const gap = Math.abs(sec / 3600 - wk.targetHours) / wk.targetHours;
      if (gap > worst) { worst = gap; worstWk = wk.index + 1; }
    }
    // targetHours is rounded to the nearest half hour, so a small week is out by up to 6%
    // from rounding alone. 8% is that floor plus margin — and a world away from 43%.
    ok(worst <= 0.08, `${c.name}: worst week is ${(worst * 100).toFixed(1)}% off its stated target (week ${worstWk})`);
  }

  // The surplus is REDISTRIBUTED, not just re-reported. Reconciling alone would make the
  // number honest by quietly shrinking the week; the minutes the caps refuse have to go
  // to sessions that can still take them.
  const big = generatePlan(profile({ raceType: "full", level: "elite", workoutsPerWeek: 14, raceDateISO: weeksFrom(40) }), ANCHOR);
  const peak = big.weeks.filter((w) => !w.isRaceWeek).reduce((m, w) => (w.targetHours > m.targetHours ? w : m));
  const peakSec = peak.workoutIds.reduce((a, id) => a + (big.workouts[id]?.estDurationSec ?? 0), 0);
  ok(peakSec / 3600 >= 18, `an elite Ironman peak week still prescribes real volume (${(peakSec / 3600).toFixed(1)} h)`);
}

console.log(`\n${checks - failures}/${checks} invariants passed`);
if (failures > 0) {
  console.error(`\n❌ ${failures} engine invariant(s) FAILED`);
  process.exit(1);
}
console.log("\n✅ all engine invariants passed");
