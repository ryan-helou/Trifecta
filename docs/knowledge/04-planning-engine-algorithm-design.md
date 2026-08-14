# 04 · Planning-Engine Algorithm & Systems Design

> **What this is.** The canonical engineering doc for Trifecta's plan-generation engine — the
> single most important piece of code in the product ([`lib/planEngine.ts`](../../lib/planEngine.ts)).
> It explains *why* we generate plans with a deterministic rule/constraint engine instead of an
> LLM, *how the code actually works today* (a fast, annotated walkthrough a new engineer can
> read in ten minutes), *how our competitors build plans* (rules vs ML vs humans, concretely),
> and *the algorithmic design space* we live in (constraint satisfaction, scheduling, greedy vs
> optimization, personalization, adaptivity, testing, and unit economics). It is deliberately
> opinionated. It also catalogues the concrete weaknesses found by reading the current code, so
> we evolve the engine with eyes open.
>
> **Companion docs.** Ground the training-science claims in
> [`01-exercise-physiology-and-periodization.md`](01-exercise-physiology-and-periodization.md)
> and [`02-training-load-and-readiness.md`](02-training-load-and-readiness.md); the injury-cap
> logic in [`03-injury-and-load-management.md`](03-injury-and-load-management.md); the device
> signals that feed calibration in [`05-wearable-and-data-ecosystem.md`](05-wearable-and-data-ecosystem.md);
> the retention/adaptivity psychology in [`06-behavioral-science-and-retention.md`](06-behavioral-science-and-retention.md);
> the plan-preview UX in [`07-product-and-ux-design.md`](07-product-and-ux-design.md); and the
> runtime/security posture in [`08-software-platform-and-security.md`](08-software-platform-and-security.md).
> The strategic framing lives in [`docs/research/runna-competitive-analysis.md`](../research/runna-competitive-analysis.md).

---

## 0. TL;DR — the theses

1. **The core of a coaching product must be a deterministic rule/constraint engine, not an LLM.**
   Training plans are a *safety-relevant recommendation*: a bad prescription hurts a real body.
   You want the properties of an expert system — auditable, explainable, testable, and cheap —
   not the properties of a generative model — plausible, opaque, and occasionally dangerous. This
   is exactly the conclusion regulated fields reached: most fielded clinical decision support is
   still rule-based precisely because rules are inspectable and their failure modes are bounded. `[MDPI-XAI, PMC-CDSS]`
2. **ML earns its keep at the edges, not the center.** Use it to *infer* (readiness, FTP drift),
   to *tune parameters* (calibration nudges), and to *talk* (natural-language coaching, parsing
   free-text injuries). Never to *author the workout*. Trifecta already draws this line: the engine
   emits every session; the optional Gemini/Haiku "coach" only annotates, converses, and structures
   user text ([`lib/ai.ts`](../../lib/ai.ts), `app/api/{coach,plan-summary,intake}/route.ts`).
3. **This is a constraint-satisfaction + scheduling problem, and a greedy heuristic is the right
   first tool.** Nurse-rostering — the canonical analog — is solved in practice with greedy
   constructive heuristics for the easy 90% and metaheuristics (simulated annealing, ILP) only
   when constraints get dense. `[Springer-NRP, arXiv-GreedySwap]` Our one-pass greedy scheduler
   ([`assignDays`](../../lib/planEngine.ts)) is appropriate for ≤~14 sessions/week; it will crack
   under adversarial density, and §3 says exactly where.
4. **The moat is economic and structural.** A deterministic plan costs ~$0 in compute (pure CPU,
   sub-millisecond). A competitor generating a full multi-week plan per user with an LLM pays real
   money per plan and per rebuild, and inherits hallucination risk. Our AI budget buys *perceived*
   coaching (a 3-sentence "why this plan," a chat answer) at a fraction of a cent — the cheap,
   high-perceived-value slice — while the expensive, high-risk slice (the actual training) stays free
   and safe.
5. **Determinism is a feature we are one refactor away from fully banking.** The engine has no RNG
   and the workout content is a pure function of `(profile, paces, phase, minutes)`. But `generatePlan`
   reads the wall clock internally (`todayISO()`, `Date.now()`), so it is *not* reproducible or
   golden-testable without a clock seam. Fixing that (§4) is the highest-leverage systems change.
6. **The engine currently has zero automated tests.** For the beating heart of the product this is
   the biggest single risk. §4 gives an invariant catalogue written to be used *directly* as a
   property-test / golden-test spec.

---

## 1. Why a deterministic engine is the right core

### 1.1 The tradeoff space, honestly

Three families of "generate a plan" architecture:

| Property | Deterministic rule/constraint engine (**Trifecta**) | Per-plan LLM generation | Learned model (supervised/RL on training data) |
|---|---|---|---|
| **Explainability** | Total. Every session traces to a rule you can point at. | Post-hoc rationalization only; the real "why" is inscrutable. | Feature attributions at best; opaque in practice. |
| **Testability** | Property tests + golden files pin behaviour exactly. | You can only test *distributions* of outputs; no invariants hold. | Statistical eval; no hard guarantees. |
| **Safety / worst case** | Bounded — the engine cannot emit a session outside its rule set. | Unbounded — can hallucinate a 6h VO2 session or ignore an injury. | Bounded by training data; fails silently out-of-distribution. |
| **Marginal cost / plan** | ~$0 (CPU microseconds). | $0.001–$0.05+ depending on model & plan size, ×every rebuild. | Inference cost + a large offline training/data cost. |
| **Cold start** | Works on day one from level defaults; no data needed. | Works day one but expensively and unpredictably. | Needs a labelled corpus of good plans you do not have. |
| **Personalization ceiling** | Bounded by the parameters you expose (§5). This is the real limitation. | High in principle; unreliable in practice. | Potentially highest, if you had the data and the labels. |
| **Latency** | Sub-ms, synchronous, offline-capable. | Seconds; network-bound; fails when the provider is down. | 10s–100s of ms; infra to run. |
| **Determinism / reproducibility** | Yes (modulo the clock seam, §4). | No — temperature, model drift, silent version bumps. | No — retrains change outputs. |

The decisive column is **safety × cost**. A training plan is a physical prescription. The literature
on safety-critical recommendation is blunt: black-box models are hard to certify, their failure is
opaque, and *"most predictive systems in healthcare remain rule-based"* because rules can be curated,
inspected, and explained by a domain expert. `[MDPI-XAI, PMC-CDSS, IEEE-CDSS]` A hallucinated
workout is not a wrong movie recommendation — it is how people get injured, which is precisely the
open flank our closest analog (Runna) is criticized for (aggressive AI plans, injuries on Reddit/TikTok;
see [`runna-competitive-analysis.md`](../research/runna-competitive-analysis.md) §7). A deterministic
engine *structurally cannot* produce a session outside its designed envelope. That is the product's
safety story and it is worth protecting.

### 1.2 Where ML/LLM genuinely adds value — and where it is a liability

Draw the line at **who authors the training load.**

**Legitimate ML/LLM uses (edges):**
- **Readiness inference.** Turning noisy signals (HRV, sleep, RHR, subjective check-ins) into a
  single "how ready are you" scalar is a genuine inference problem where a model beats a hand rule.
  Today Trifecta uses a transparent scored check-in (`ReadinessInput` → 0–100; see
  [`02-training-load-and-readiness.md`](02-training-load-and-readiness.md)); an inferred readiness is
  a defensible future ML addition *as an input to* the deterministic engine.
- **Parameter calibration.** Nudging a pace anchor because sessions ran hot is a small regression
  problem. [`lib/calibrate.ts`](../../lib/calibrate.ts) does a hand-rolled, capped version today
  (±4%/week, ±15% total); a learned model could sharpen it — but it must feed `derivePaces`, not
  rewrite workouts.
- **Natural-language coaching & intake.** Converting "my left knee twinges on long runs" into a
  structured `Injury{area, disciplines, severity}` (`app/api/intake/route.ts`), or writing a warm
  3-sentence "why this plan" (`app/api/plan-summary/route.ts`), is exactly what LLMs are good at and
  where a mistake is cosmetic, not physical.

**Liabilities (center):**
- **LLM authoring the workout or the week structure.** This imports hallucination risk into the one
  place it is unacceptable, destroys reproducibility, and burns money on every rebuild. Don't.
- **A learned end-to-end "profile → plan" model.** You lack the labelled corpus (what *is* a
  "correct" plan?), and even with it you'd trade away auditability for a personalization ceiling you
  can approach more safely by *exposing more parameters* to the deterministic engine (§5).

**The engineering rule of thumb:** *the engine decides the load; models may inform the inputs and
narrate the output.* Trifecta honours this today.

### 1.3 How Trifecta's engine works today — annotated data flow

Read this section with [`lib/planEngine.ts`](../../lib/planEngine.ts) open. The whole pipeline is a
pure-ish function `generatePlan(profile: Profile): Plan`. Data flows:

```
Profile
  │
  ├─ categoryOf(p) ─────────────► Cat ∈ {olympic, half, full}     (custom races classified by run leg)
  │
  ├─ isFitnessGoal(p)? ──yes────► generateFitnessPlan()  (rolling 12-wk base→build, no peak/taper/race)
  │                     no
  ▼
  derivePaces(p) ──► PaceModel   (run threshold pace, swim CSS, bike %FTP/W, HR %max — from PRs or level)
  │
  ▼
  ── plan length & phase split ──────────────────────────────────────────────
  anchor = generatePlan's optional start date (onboarding lets the athlete pick one; default
           today, never the past); rebuilds omit it ⇒ today
  weeksUntil = weeksBetween(mondayOf(anchor), mondayOf(raceDate)) + 1
  totalWeeks = weeksUntil, starting the anchor week   (< PLAN_MIN[cat] ⇒ compressed;
              > MAX_PLAN_WEEKS(104), i.e. a mistyped date >2 yr out ⇒ delayedStart — the only delay case)
  taperWeeks = min(TAPER_WEEKS[cat], floor(totalWeeks·0.18))
  buildWeeks = bounded specific-prep block (≤ BUILD_MAX[cat], ~6–12 wk); peakWeeks ∈ {0,1,2};
              baseWeeks = the rest  ⇒ surplus lead time lengthens BASE, never the near-peak build
  cycleLen = beginner ? 3 : 4        (2:1 vs 3:1 load:deload)
  peakHours = min(PEAK_HOURS[cat][level], weeklyHoursCap)
  │
  ▼
  for each week i in 0..totalWeeks-1:
     phase   = base | build | peak | taper           (by index thresholds baseEnd/buildEnd/peakEnd)
     isRecovery = (base|build) && (i+1)%cycleLen==0 && i>0
     frac    = baseFraction(phase, idxInPhase, phaseLen, …)   (the weekly load curve, 0.32–1.0)
     targetHours = round₀.₅(peakHours · frac · (isRecovery ? 0.62 : 1))
     │
     ├─ race week? ─► buildRaceWeek()   (a few short openers on training days, rest day-before, THE RACE brick)
     └─ else ───────► buildNormalWeek():
            slots = pickWeekSlots(ctx, p, cat, phase, i, isRecovery)   ← the core
            build fixed (non-scalable) sessions first → sum their seconds
            distribute (targetHours·3600 − fixedSec) across scalable sessions by weight,
              clamped to each session's [minMin, maxMin]
            emit Workout objects with deterministic ids  w-<week>-<day>-<disc>[-<seq>]
  │
  ▼
  applyBlackouts(p, weeks, workouts)   (drop sessions inside vacation ranges; never the race)
  │
  ▼
  Plan { id, weeks[], workouts{}, paces, notice, compressed, delayedStart, … }
```

**The core is `pickWeekSlots` → `assignDays`.** Two stages:

1. **Choose the week's sessions (`pickWeekSlots`).** First, `weekSportCounts` decides *how many* of
   swim/bike/run/strength this week gets. It starts from `baseSportCounts` — either the athlete's
   explicit `perSport` counts, or `splitTotal(total, focus)` which distributes their `workoutsPerWeek`
   across sports with a bike-leaning ratio (swim 0.28 / bike 0.40 / run 0.32, +0.12 to the limiter) —
   then applies **injury modifiers** (`injuryMods`: a per-sport `capZone`, `volMult`, and `avoid`
   flag derived from `Injury.severity`), **equipment** (no pool ⇒ keep ≤1 dry-land swim, push the
   rest to bike/run), **recovery** (×0.7), and **taper** (trim strength, cap total at 8). Removed
   sessions are shifted onto the *safest healthy* sports (low-impact first) — this is the injury-aware
   substitution that differentiates us.

   Then, for each sport, an ordered **role list** is built. Roles are prioritized: the long
   *anchor* first (a `brick` in build/peak if running-off-the-bike is safe, else a long endurance
   ride), then a *quality* session (threshold / VO2 / sweet-spot / tempo, phase- and injury-gated),
   then easy aerobic *fillers*. `weekSportCounts` says how many to take: `swimList.slice(0, counts.swim)`,
   etc. Each role is a `Role` = a session spec with a `discipline`, `hard` flag, `scalable` flag,
   `weight` (share of the time budget), `[minMin, maxMin]`, a `prefDay`, and a `build(min)` closure
   that produces the actual `Draft` from [`lib/workouts.ts`](../../lib/workouts.ts).

2. **Place them on days (`assignDays`).** A one-pass greedy: for each role, score all 7 days and take
   the best. The scoring function is the whole scheduler and is worth quoting exactly:

   ```ts
   function score(d, r) {
     const cur = day[d];
     if (cur.length >= 3) return -1e6;              // hard cap: ≤3 sessions/day
     let s = -cur.length * 25;                       // prefer empty days (spread before stacking)
     if (restDay != null && d === restDay) s -= 1000;// protect the rest day
     if (r.hard && cur.some(x => x.hard)) s -= 400;  // avoid two hard sessions same day
     if (cur.some(x => x.disc === r.discipline)) s -= 30; // avoid same-sport doubles
     const dist = min(|d - prefDay|, 7 - |d - prefDay|);
     s -= dist * 6;                                  // stay near the preferred day (wraps)
     if (d === r.prefDay) s += cur.length === 0 ? 100 : 20;
     return s;
   }
   ```

**Time budgeting (`buildNormalWeek`).** Fixed (`scalable:false`) sessions — swims, strength, and the
build/peak quality sessions — are built at their intrinsic durations first; whatever weekly-hour
budget remains is split across the scalable sessions (the long anchor, easy fillers, base-phase
quality) *pro-rata by weight*, then clamped to each session's `[minMin, maxMin]`. Every session's
`estDurationSec`/`estDistanceM` is computed by [`workouts.ts:measure`](../../lib/workouts.ts) from a
per-discipline speed model, so "hours" are real, not nominal.

**Paces (`derivePaces`, [`lib/paces.ts`](../../lib/paces.ts)).** Anchors come from PRs when available
(Riegel `t2 = t1·(d2/d1)^exp` to predict a 10k → run threshold; a swim TT → CSS; user FTP → bike
zones), else level defaults. Zones are offsets/multipliers off the anchor ([`lib/zones.ts`](../../lib/zones.ts):
`ZONES`). A signed `PaceCalibration` (±15%) sharpens or eases every anchor and flows through generation,
rebuild, and display identically.

That's the whole engine. No randomness, no network, no model — a few hundred lines of arithmetic and
one greedy loop.

---

## 2. How the competition actually generates plans

Concrete, and mapped to the rules-vs-ML-vs-human axis. This is the landscape our architecture is a
bet against.

- **TrainingPeaks + WKO5 — human coaches + templates + retrospective modeling.** TrainingPeaks itself
  is not a plan *generator*; it's a coach's IDE and an athlete's calendar. Plans come from a
  **>5,000-plan template store** authored by human coaches, or a coach hand-builds an Annual Training
  Plan. WKO5 adds *analytical* modeling — the Performance Manager Chart (CTL = 42-day exponentially
  weighted TSS, ATL, TSB), the Power-Duration model, and individualized `iLevels` zones — but the
  modeling is **descriptive/retrospective** (what did the training do?), not a generative scheduler.
  `[TP-WKO4, WKO5-PMC, FasCat-PMC]` **Takeaway for us:** their CTL/ATL/TSB math is the gold-standard
  *load accounting* to eventually adopt as a validation layer over our generated plans (§4), even
  though we don't need their human-in-the-loop authoring.
- **TriDot — physiologically-driven optimization ("Optimized Training", FitLogic™, EnviroNorm®).**
  The most ML-forward triathlon product. Claims a model trained on "billions of data points" over 20+
  years that, after every logged session, adjusts intensity/volume/timing; a proprietary
  **Normalized Training Stress (NTS)** metric; and **EnviroNorm** which normalizes prescribed and
  actual intensities for heat, humidity, elevation, wind, and terrain so a session in Phoenix in
  August is comparable to one in Denver in spring. `[TriDot-Optimized, TriDot-Enviro, TriDot-Deliver]`
  This is genuinely more ML-driven than us. **But** it is opaque, subscription-gated, and its
  personalization is a black box the athlete can't audit — the exact liability §1 warns about. Our
  counter-position: *transparent, injury-aware, and free-to-run.* EnviroNorm, however, is a real and
  legitimate ML edge-feature we should copy in spirit (normalize targets to conditions) — it's an
  *input adjustment*, not workout authoring.
- **Runna — coach-designed framework, algorithm-personalized, adaptive (running only).** The closest
  business analog. Runna is explicit that paces come from a **"coach-built, rules-based training
  system,"** not an LLM: an algorithm steps your pace/volume up by *"a small, structured amount each
  week"* under a **"controlled double constraint"** — two week-over-week ceilings, whichever is more
  conservative wins. `[Runna-fitness, Runna-plans]` That is a *rules engine with a ramp-rate cap*,
  architecturally the same family as ours. Their adaptivity reshuffles around completed/missed
  sessions and post-run feedback — and it is simultaneously their headline feature and their loudest
  complaint (doesn't downshift enough; runs too hot for beginners). **Takeaway:** validation of Runna's
  approach for *running*; their injury flank is our whole wedge for *triathlon*; and their "double
  constraint" ramp cap is a pattern we should adopt as an explicit invariant (§4), which we currently
  lack.
- **Humango — adaptive AI planner across sports.** Coach "Hugo" continuously ingests workouts, HR,
  sleep, fatigue, and *calendar/life constraints* and re-plans automatically; multisport (sprint →
  full). `[Humango-site, Triathlete-AIapps]` Positioned as ML-adaptive; in practice a constraint-aware
  scheduler with heavy device integration. Their calendar-constraint handling (fit training around
  real life) is more mature than ours and is the direction our `blackouts`/`restDayPreference` should
  grow.
- **Final Surge / template libraries / spreadsheet plans (the long tail).** Final Surge and most of
  the market are **static, coach-authored templates** — pick "16-week 70.3 intermediate," get a fixed
  block, maybe with pace fields. Zero personalization beyond distance×level, zero adaptation. This is
  the incumbent our deterministic-but-personalized engine actually displaces for most amateurs.

**The synthesis:** almost nobody in endurance uses an LLM to author workouts. The credible players are
**rules engines (Runna, template stores) or physiological optimizers (TriDot, WKO modeling)**, with ML
concentrated on *adaptation and inference*, exactly where §1 says it belongs. Trifecta is squarely in the
credible camp; our differentiation is multisport-native + injury-aware + $0-to-run + auditable.

---

## 3. Plan generation as constraint satisfaction & scheduling

### 3.1 The problem, framed

Generating a week is an **assignment / scheduling problem** with hard and soft constraints — the same
shape as nurse rostering (assign shifts to nurses ↔ assign sessions to days) `[Wiki-NRP, Springer-NRP]`
and bin-packing (pack session-minutes into day-capacity and week-capacity bins).

**Hard constraints (must never be violated):**
- ≤ 3 sessions/day (`assignDays` returns `-1e6`).
- Total sessions ≤ 7 days × 3 = 21 (`capTotal(c, MAX_WORKOUTS)`).
- No sessions on/after race day; rest the day before the race (`buildRaceWeek`).
- No sessions on blackout dates (`applyBlackouts`, except the race itself).
- Severe injury ⇒ that discipline is limited to ≤1 gentle, capped-zone session.

**Soft constraints (penalized, tradable):**
- Keep the athlete's preferred rest day clear (−1000).
- Avoid two *hard* sessions the same day (−400).
- Avoid same-sport doubles the same day (−30).
- Keep each session near its preferred day (−6·distance).
- Spread across days before stacking (−25·existing).
- Respect the weekly hour target and per-session min/max durations.
- Bias time toward the focus discipline (×1.18 weight; ×1.18 on counts elsewhere).

**Objective:** produce a physiologically sound week — ~80/20 easy:hard intensity distribution
`[PMC-TID]`, a bounded week-over-week ramp `[Outside-ACWR]`, a long session per endurance sport, hard
days separated, honoring the athlete's life. Note two of those objective properties (80/20 and ramp
rate) are **not encoded as constraints at all today** — they're emergent (§3.4).

### 3.2 Greedy vs optimization — the right tool at each scale

The solution space, cheapest to most powerful:

1. **Greedy constructive heuristic (what we do).** Order the sessions, place each in its locally-best
   slot, never reconsider. O(sessions × 7). For nurse rostering, greedy constructive heuristics are
   the standard way to get a good feasible solution fast, and are often *all* you need for
   lightly-constrained instances. `[arXiv-GreedySwap, Springer-NRP]` For ≤~14 sessions/week with our
   constraint density, greedy is genuinely sufficient and has the priceless property of being trivial
   to explain to a user ("your long ride is Saturday because that's your preferred long day and it
   keeps two hard days apart").
2. **Local search / metaheuristics (simulated annealing, tabu).** When constraints get dense (many
   sessions, tight rest-day + hard-spacing + equipment + injury interactions), greedy paints itself
   into corners because it can't undo an early bad placement. SA is the workhorse fix in the
   rostering literature — start from the greedy solution, then propose swaps and accept worse states
   probabilistically to escape local minima. `[Springer-NRP, ScienceDirect-NRP]` This is the natural
   *next* step for Trifecta and would be a drop-in around `assignDays` (greedy seed → SA polish against
   a penalty function that includes cross-day hard spacing and 80/20).
3. **Exact optimization (ILP / CP-SAT).** Model days×sessions as binary vars with linear
   hard-constraints and a weighted-penalty objective; hand it to a solver (OR-Tools CP-SAT). Gives
   provably optimal weeks — but the literature is clear that exact methods only scale to *small*
   instances and are overkill here. `[Springer-NRP]` A weekly triathlon schedule (≤21 sessions, 7
   days) is tiny enough that CP-SAT would solve it in milliseconds, so this is *viable*; the cost is
   a heavy dependency, loss of the "explain in one sentence" property, and determinism caveats (solver
   tie-breaking). **Verdict:** not worth it until soft-constraint interactions demonstrably produce
   bad weeks that SA can't fix.

**The honest engineering call:** greedy now, SA when we observe real failures, ILP essentially never.

### 3.3 Our greedy scheduler, dissected

`assignDays` is a clean implementation of family (1). Strengths: deterministic, explainable,
O(n)-fast, and the score terms map 1:1 to constraints a user understands. But greedy-single-pass has
characteristic fragilities, and ours has several:

- **Order-dependence with no backtracking.** Roles are placed in a fixed order (swim → bike → run →
  strength, long/quality before fillers within each sport). The first session of each sport claims its
  preferred day; later high-value sessions can get shoved far from their `prefDay` because earlier
  placements already loaded the good days. There is no re-evaluation. Under low density this is fine;
  under high density it degrades silently.
- **Hand-tuned magic numbers.** The weights (25, 1000, 400, 30, 6, 100, 20) are unexplained constants
  with load-bearing *relative* ordering. Example interaction: because `restDay` (−1000) dominates
  `two-hard-same-day` (−400), under high density the scheduler will **stack two hard sessions on a
  loaded day rather than use the rest day** — i.e. it protects the rest day *by sacrificing* hard-day
  separation. That may or may not be the intended priority, but nothing documents or tests it.
- **"No two hard days back-to-back" is not implemented.** The score only penalizes two hard sessions
  on the *same* day. There is **no term for hard sessions on *consecutive* days.** Today, hard days
  end up separated only because the default `prefDay`s happen to fall Tue/Thu/Sat — an *accident of
  constants*, not a guarantee. Change the rest day, the session count, or a `prefDay`, and you can get
  a hard threshold run Wednesday followed by a hard threshold ride Thursday with nothing stopping it.
  This is the clearest missing constraint. (Note also that swim quality sessions carry `hard:false`,
  so a hard CSS/VO2 swim doesn't even participate in the same-day hard penalty.)
- **`capTotal` interaction can stack.** At the extreme (21 sessions) every day is forced to 3 and the
  rest-day guard is overridden — by construction, since 21 = 7×3 leaves no free day. Intended, but
  worth a golden test at the boundary.
- **`splitTotal` can zero out a sport at low frequency.** `total = 1` → a single bike; `total = 2` →
  bike + run, **no swim**. The "make sure all three show up" repair only triggers at `total ≥ 3`.
  Fine by design (you can't do three sports in two sessions), but a documented edge, not a bug.

### 3.4 Time-budgeting as constrained proportional-share (a soft knapsack)

`buildNormalWeek`'s budget split is a proportional-share allocation with per-item clamps — a relaxed
knapsack. It has a subtle, important property: **`targetHours` is a soft target that can be
*overshot*.** Fixed sessions are built first at full duration; the *remaining* budget is split across
scalables — but each scalable is then clamped *up* to its `minMin`. So when a week has many fixed
sessions (several swims + strength + build/peak quality) and/or many scalable fillers, the sum of
`fixedSec + Σ minMin` can exceed `targetHours·3600`. Consequences:

- **`weeklyHoursCap` is aspirational, not enforced.** The cap flows into `peakHours` → `targetHours`,
  but the emitted week can exceed it. An athlete who sets a hard 6h/week ceiling and also asks for 10
  sessions may receive >6h. There is no post-assembly check that Σ session durations ≤ cap.
- **Low-volume, high-frequency weeks inflate.** The `minMin` floors dominate when the budget is small
  relative to session count.

This is fixable (a final normalization pass that scales durations down to meet the cap, respecting a
floor and dropping the lowest-weight session if even the floors bust the cap), and it should be, because
"respect my time cap" is a promise users will hold us to.

---

## 4. Invariants the engine must always satisfy (test spec) + validation strategy

**Context:** there are currently **no tests** in the repo (no test runner in `package.json`, no
`*.test.ts`). This section is written to be adopted verbatim as a property-test + golden-test suite.
Property-based testing is the right primary tool here: the engine is a pure-ish function over a large
structured input space, and PBT is exactly "generate many valid inputs, assert invariants that must
hold for all of them, shrink counterexamples." `[ZetCode-PBT, arXiv-PBT]`

### 4.1 Invariant catalogue (assert for *every* generated plan)

**Structural / scheduling (hard — a violation is a bug):**
1. **≤ 3 sessions on any calendar day.**
2. **Total sessions in any week ≤ 21.**
3. **Every `workout.date` lies within `[startDateISO, lastWeekStart+6]`** and maps to the week whose
   Monday matches (`reindexWeeks` consistency).
4. **Workout ids are unique**; the `w-<week>-<day>-<disc>[-<seq>]` scheme never collides (the `-seq`
   disambiguator covers same-day same-discipline doubles).
5. **No session on or after race day; the day before the race is rest.**
6. **No non-`race_prep` session falls inside any blackout range.**
7. **The last week contains race day** (`isRaceWeek`), and only the last week does.
8. **Phase order is monotone:** all `base` weeks precede all `build`, precede `peak`, precede `taper`;
   phase counts sum to `totalWeeks`.

**Physiological / load (the safety invariants — these are the *point* of the product):**
9. **Monotone taper.** `targetHours` must be non-increasing across every taper week and strictly below
   the peak week. **✅ Now holds for all distances** — the 3-week full taper was fixed (`baseFraction`
   now indexes the descent by weeks-to-race: 10.5 → 8.5 → 5.0 h); see 4.2.
10. **Bounded week-over-week ramp.** Non-recovery `targetHours` should not jump more than a bounded
    fraction (the field heuristic is ~10%/week, superseded by keeping the acute:chronic load ratio in
    ~0.8–1.3 `[Outside-ACWR]`). **Not currently enforced** — a Runna-style "controlled double
    constraint" `[Runna-fitness]` belongs here.
11. **Recovery weeks are genuinely lighter.** Every `isRecovery` week's `targetHours` < the
    surrounding non-recovery weeks (the ×0.62 multiplier should always net out lower).
12. **Intensity distribution ≈ 80/20.** Across a normal (non-taper, non-recovery) week, the share of
    time in Z4–Z5 should sit ~15–25% `[PMC-TID]`. **Currently emergent, unchecked** — injury
    downshifts and low session counts can skew it with nothing noticing.
13. **Long-session caps respected.** No run > `LONG_RUN_CAP[cat]`, no ride > `LONG_RIDE_CAP[cat]`.
14. **Injury caps respected.** For any injured discipline, no emitted session's `primaryZone` exceeds
    that discipline's `capZone`; a `severe`/`avoid` discipline yields ≤1 session that week.
15. **Equipment respected.** `pool:false` ⇒ ≤1 swim slot and it's dry-land; `gym:false` ⇒ strength is
    the bodyweight home circuit.
16. **Hours honored.** Σ session durations in a week ≤ `weeklyHoursCap` (when set). **Currently
    violable** — see §3.4.

**The athlete's own decisions (added 2026-08-13 — `test/decisions.test.ts`):**
20. **The per-sport frequency contract holds in EVERY week** except the taper and the week
    carrying the day before race day. `perSport: {3,3,3}` means three of each, every week.
    Recovery weeks deload by cutting **volume** (`targetHours × 0.62`), never by deleting
    sessions — the old `× 0.7` on the counts handed a 3/3/3 athlete a 2/2/2 deload *and*
    double-applied the deload. A **brick occupies a bike slot** (`countsAs` in
    [`lib/equilibrium.ts`](../../lib/equilibrium.ts)), so a build week reading
    `bike 2, run 3, brick 1` satisfies a 3/3/3 contract.
21. **Athlete decisions survive every regeneration, indefinitely.** A skip, swap, resize,
    re-pace or move is recorded in an append-only, **date-anchored** ledger on the plan
    (`Plan.decisions`, [`lib/decisions.ts`](../../lib/decisions.ts)) and REPLAYED over each
    fresh generation:

    ```
    generate(profile) → replay(decisions) → rebalance → validate
    ```

    This replaced a hand-maintained carry-over inside `rebuildFromToday` that matched on
    `date + discipline` and therefore *structurally could not* carry a swap (a swap changes
    the discipline) — the code said so itself: *"Moved and swapped are deliberately NOT
    carried."* Since rebuilds fire **automatically** (3 missed sessions, any settings save,
    an engine upgrade), decisions were being erased on a schedule the athlete never asked
    for. Reported as: *"the worst thing is for one of the users to do something and have it
    redo all the work it's done."*
    - Anchors are `date · designed-discipline · ordinal`, never ids — a rebuild re-anchors
      week indices (`w-3-1-bike` → `w-0-1-bike`), and the *designed* discipline (recovered
      through `swappedFrom`) is stable exactly where the current one is not.
    - Replay is **chronological**, not by kind: a skip made after a swap must see the
      swapped session.
    - Undo (`unswapDiscipline`, un-skip) must reach the ledger, or the next rebuild replays
      the decision the athlete just reversed.
    - `backfillDecisions` reconstructs a ledger from workout state for plans that predate
      it, so the migration costs no one their existing decisions.
    - **Regression-test by rebuilding REPEATEDLY.** One rebuild was never the bug; the fifth
      was.

**Determinism (systems invariants):**
17. **`generatePlan(profile)` is a pure function of `(profile, today)`** — identical inputs ⇒
    byte-identical `weeks`/`workouts` (ignoring the `id`/`generatedAtISO` metadata fields). No RNG is
    used, so this holds *content-wise* today; the obstruction is only the clock seam (4.3).
18. **Rebuild preserves history.** `rebuildFromToday` never drops or overwrites a completed past
    session (the `kept-` id namespacing must hold; regression-test the "same relative index" collision
    the code comments call out).
19. **Rebuild preserves PERIODIZATION.** — **ENFORCED (2026-08-11)**, `test/realign.test.ts`
    "rebuild keeps the athlete's place in the arc". `generatePlan` only ever saw the runway
    *remaining*, so it laid base first: an athlete ten weeks into a twenty-week block who realigned
    (or saved a setting, or received an engine upgrade) was handed a fresh base week one, and
    `baseQualityOk` then withheld quality for its first two weeks. Reported from the field as "i
    dont see any high intensity workouts now its the same plan just aerobic and endurance
    runs/bikes". The arc is now computed over the **whole** block — `GenerateOpts.weeksBanked` plus
    the weeks remaining — and only the remainder is emitted.
    - Banked weeks are **discounted by adherence** (`weeksBanked` in `lib/adapt.ts`): elapsed time
      alone is the wrong credit, because an athlete who missed the block hasn't banked that base and
      fast-forwarding them into build is the ramp §4 of doc 03 forbids.
    - The elapsed span is read from the **earliest session on record**, not `weeks[0].startDate` — a
      rebuild rewrites the week grid to start today, so reading the grid makes rebuilding
      non-idempotent and silently restarts base on the *next* rebuild. Asserted as a fixed point.
    - The taper is sized off the full block, since it is measured back from race day and must not
      depend on when a rebuild happened to fire.
    - **Assert on emitted sessions, never on phase labels.** A week can be labelled `build` while
      prescribing nothing above Z2; that gap is exactly how this shipped past review and a green
      suite. Count sessions with `primaryZone >= 3`.

### 4.2 Concrete bug found by tracing: the 3-week taper was non-monotone — **FIXED (2026-07-22)**

> **Resolution.** `baseFraction`'s taper branch now indexes the descent by *weeks-to-race*, so the
> earliest taper week carries the most load and every taper is strictly non-increasing at any length:
> ```ts
> const weeksToRace = taperLen - 1 - taperPos; // 0 = race week
> if (weeksToRace <= 0) return 0.32;           // race week — the lightest
> const ladder = [0.55, 0.7];                  // 1 week out, then ≥2 weeks out (clamped)
> return ladder[Math.min(ladder.length - 1, weeksToRace - 1)];
> ```
> A full Ironman now tapers **0.7 → 0.55 → 0.32** (target hours **10.5 → 8.5 → 5.0**); 2-week and
> 1-week tapers are unchanged. Verified against invariant #9 for all distances. The original bug, for
> the record:

The old `baseFraction` taper branch:

```ts
const ladder = [0.7, 0.55, 0.42];
const isRaceWeek = taperPos === taperLen - 1;
if (isRaceWeek) return 0.32;
const remainingBeforeRace = taperLen - 1 - taperPos;
const li = Math.min(ladder.length - 1, remainingBeforeRace);
return ladder[Math.max(0, li)];
```

Trace a full Ironman (`TAPER_WEEKS.full = 3`, so `taperLen = 3`, positions 0,1,2):
- `taperPos = 0` → `remainingBeforeRace = 2` → `li = 2` → `ladder[2] = 0.42`
- `taperPos = 1` → `remainingBeforeRace = 1` → `li = 1` → `ladder[1] = 0.55`
- `taperPos = 2` → race week → `0.32`

So the taper load fractions run **0.42 → 0.55 → 0.32**: the *first* taper week dips *below* the second,
then it drops for race week. That is a non-monotone taper (peak 1.0 → 0.42 → **0.55** → 0.32) — it
eases off, then loads *back up*, then eases again. The intended shape is clearly a smooth descent
(0.7 → 0.55 → 0.42 → race), i.e. `ladder[0]` should map to the *earliest* taper week. The indexing is
inverted: `li` should count *from the start* of the taper, not from the race. (2-week and 1-week tapers
happen to come out monotone, which is why this hides.) This is invariant #9 failing, and it's exactly
the kind of defect a single property test — *"taper `targetHours` is non-increasing"* — catches
instantly. **Fix:** map the earliest taper week to the largest ladder value, e.g. index by `taperPos`
directly (`ladder[min(taperPos, ladder.length-1)]`) so it reads 0.7 → 0.55 → 0.42.

### 4.3 The determinism / reproducibility story (and the `Date.now()` risk)

The engine uses **no randomness** — every branch (`even = weekIndex % 2`, phase math, greedy scoring)
is deterministic. That's a genuine strength: unlike an LLM plan, ours is reproducible *in principle*.
Three wall-clock dependencies stand between us and reproducible-*in-practice*:

- **`generatePlan` reads `todayISO()` internally** (via `mondayOf(todayISO())`) with **no injectable
  clock**. The plan's start Monday, `weeksUntil`, `totalWeeks`, and phase split all depend on the day
  it was generated. So a plan is only reproducible if you also know the wall-clock day it was built —
  which we don't persist. Notably, the *pure* siblings (`predict.ts`, `calibrate.ts`, `adapt.ts`) all
  take an explicit `todayISO` parameter for exactly this reason; `generatePlan` is the inconsistent
  one. **Highest-leverage fix:** thread an optional `todayISO` (or a `clock`) into `generatePlan` and
  `generateFitnessPlan`. This single seam unlocks golden tests and true reproducibility.
- **`id: \`plan-${Date.now()}\``** is a non-deterministic identifier. Harmless for content, but it
  means two builds a millisecond apart differ; `rebuildFromToday` deliberately carries the old `id`
  across to avoid churning it, which is the right instinct — generalize it.
- **`generatedAtISO: new Date().toISOString()`** — pure metadata, fine, but exclude it (and `id`) from
  any content-equality assertion.

**Idempotency of adaptation.** `adapt.ts` functions are pure (`clonePlan` → mutate copy → return),
which is correct. `moveWorkout`/`rebuildFromToday` call `reindexWeeks`, whose comment documents a real
subtlety (bucket by *calendar Monday*, not `start + 7·86400000 ms`, to survive DST) — good, and a
prime target for a property test across a DST boundary.

### 4.4 The rest of the validation pyramid

- **Golden/snapshot tests.** Freeze a handful of canonical profiles (beginner Olympic 12wk; advanced
  70.3 with a knee niggle and no pool; elite full with an 18h cap) at a fixed injected `today` and
  snapshot the emitted plan. Any diff is a deliberate, reviewed change. Requires the clock seam (4.3).
- **Property-based tests.** Generate thousands of random valid `Profile`s (fuzz every field: distance,
  level, session counts, injuries, blackouts, equipment, caps) and assert the §4.1 invariants for
  each; let the framework *shrink* any counterexample to a minimal failing profile. `[ZetCode-PBT,
  arXiv-PBT]` This is where the taper bug and the hours-overshoot would have surfaced on day one.
- **Metamorphic tests.** Relations that must hold between *related* inputs `[MarkTechPost-PBT]`:
  raising `weeklyHoursCap` never *decreases* total planned hours; adding an injury never *increases*
  load on the injured discipline; moving the race later never *shortens* the base phase; enabling a
  focus discipline never reduces its share.
- **Simulation / backtesting.** Replay a season week-by-week feeding synthetic "actuals" (completed /
  missed / RPE / HR) into `calibratePaces` and `assessAdaptation`, and assert the closed loop stays
  stable — calibration converges within ±15% and never oscillates; adaptation eases but never spirals.
- **Coach-in-the-loop review.** The irreplaceable top of the pyramid. A qualified coach spot-checks
  generated plans for the 20% of judgment no invariant captures. This is also how you *discover* new
  invariants to encode — the same virtuous loop TrainingPeaks' template authors and Runna's coaches
  provide, but pointed at auto-generated output.

---

## 5. Personalization parameters — the knobs that matter

### 5.1 Which knobs earn their place

Ranked by leverage-per-unit-complexity (all live on `Profile`):

1. **Distance × level** (`raceType`, `level`). Set `PEAK_HOURS`, `PLAN_MIN`, `TAPER_WEEKS`, long
   caps, and the pace defaults. The two highest-signal inputs; you could ship a defensible plan on
   these alone.
2. **Race date** (`raceDateISO`). Sets plan length and the whole phase countdown; its absence flips to
   the rolling fitness block.
3. **Volume: `workoutsPerWeek` / `perSport` and `weeklyHoursCap`.** The single biggest determinant of
   whether a plan fits a real life. `perSport` (explicit swim/bike/run counts) is the power-user
   override; `workoutsPerWeek` + `splitTotal` is the sensible default.
4. **Paces: PRs and FTP** (`runPR`, `swimPR`, `bikePR`, `ftp`, `maxHR`). Move zones from
   level-generic to individual. Riegel for run/swim; %FTP for bike (`derivePaces`).
5. **Limiter / rest day** (`focusDiscipline`, `restDayPreference`). Cheap, high perceived
   personalization; the focus bias shifts both counts (+0.12 in `splitTotal`) and time (×1.18 weight).
6. **Injuries** (`injuries[]`). The differentiator. `capZone` + `volMult` + `avoid` + substitution
   onto low-impact sports. This is what Runna structurally lacks.
7. **Equipment / blackouts / strength** (`equipment`, `blackouts[]`, `strength`). Reality-fitting:
   pool/gym/trainer access, vacation dropouts, resistance split.
8. **Calibration** (`calibration`) — not a user knob but an *auto-tuned* one; see §5.3.

### 5.2 Deriving zones & paces (the math worth knowing)

- **Run threshold pace** — Riegel-project the PR to a 10k, then threshold ≈ 10k pace + 7 s/km
  (`riegel(d1,t1,10000,1.06)`). Zones are multipliers on threshold pace (`ZONES[z].paceMult`,
  Friel/Daniels-style).
- **Swim CSS** — Riegel-project the swim PR to 1000 m with a flatter fatigue exponent (1.02), CSS =
  that /10; zones are seconds-offsets vs CSS (`ZONES[z].cssOffset`).
- **Bike** — %FTP (Coggan) when FTP is known, emitting both `%` and watts; else level speed. The
  race-time estimate scales bike speed by `cbrt(FTP / typicalFTP)` because on the flat aerodynamic
  drag dominates and `P ∝ v³` (`estimateRaceSeconds`).
- **HR** — %HRmax fallback so a target is never blank.

Every zone always carries an RPE and a color (`ZONES`), so a session can render a concrete,
athlete-specific target even with zero performance data — the cold-start property §1 prizes.

### 5.3 Calibration — the disciplined way to close the loop

[`lib/calibrate.ts`](../../lib/calibrate.ts) is a small, *bounded* controller — the honest fix for "the
plan runs too spicy." Per discipline over a 28-day window it computes a **strain delta** (RPE vs the
zone's prescribed RPE, "feel," and — when `maxHR` is known — actual avg-HR vs the zone band), and if
the average drift exceeds a 1-RPE deadband, nudges the pace anchor: capped at **±4% per weekly
recalibration** and **±15% total** (`CAL_MAX`), applied by `derivePaces` so one signed number flows
through generation, rebuild, *and* display. This is the textbook safe-controller shape: deadband
(ignore noise), rate limit (±4%/wk), and saturation (±15%). It is the right place — and essentially the
only place — for "learning" in the current engine, and it's done conservatively.

### 5.4 The danger of too many knobs

More parameters raise the personalization ceiling but three costs compound:
- **Combinatorial test surface.** Every knob multiplies the input space property tests must cover;
  interactions (no pool + shoulder injury + 3h cap + focus=swim) are where bugs hide.
- **Constraint infeasibility.** Enough hard constraints (rest day + blackouts + injuries + a low
  session cap + equipment) can make a satisfying week impossible; a greedy scheduler won't tell you it
  gave up — it silently produces a degraded week. An optimizer at least reports infeasibility.
- **Onboarding drop-off.** Every question is a chance to abandon (see
  [`06-behavioral-science-and-retention.md`](06-behavioral-science-and-retention.md) and
  [`07-product-and-ux-design.md`](07-product-and-ux-design.md)). Runna's ~30-screen onboarding works
  because each screen visibly *earns* its place in the plan preview.

The design rule: **add a knob only when it changes a real constraint or a real target**, keep it
optional with a sane default, and make its effect *visible* in the plan so the athlete feels the
personalization they paid for in attention.

---

## 6. Adaptivity architecture — regenerate vs patch

The central adaptivity question is **regenerate the whole plan, or patch it in place?** Trifecta
deliberately does *both*, at different scopes ([`lib/adapt.ts`](../../lib/adapt.ts)):

- **Patch (local, in-place, undoable).** `setStatus`, `logInstead`, `logCheckin`, `moveWorkout`,
  `swapDiscipline`/`unswapDiscipline`, `easeUpcoming`. These preserve ids and dates (so the UI is
  stable and swaps are reversible) and touch only the affected sessions. This is the right default:
  **a single missed or moved session must never destabilize the plan.** The design philosophy in the
  file header is exactly right — *"a single miss is absorbed, not crammed"* — and matches the
  best-practice critique of Runna (don't cram makeups; don't let one bad day cascade).
- **Regenerate (global, structural).** `rebuildFromToday` — when the athlete has fallen behind, throw
  away the future and re-periodize from today so the plan still lands on race day, **while preserving
  the past and replaying the athlete's decisions** (invariant 21 above; the replay runs before
  anything else reads the plan, so a skipped session cannot reappear and a swapped day cannot
  revert). The hard part is history preservation, and the code handles the two traps its comments
  call out: (a) fresh future sessions reuse the same `w-<week>-<day>-<disc>` ids as kept past ones, so
  past sessions are namespaced `kept-` to avoid silent overwrite of banked hours/streaks; (b) a
  session *already completed today* is retained (not reset to "planned") and de-duplicated against the
  fresh plan. Readiness history carries across the rebuild; weeks/easedWeeks regenerate.

**Settling work against the week — the two contracts.** Adaptivity also has to answer "you did
something the plan didn't ask for" and "you changed which sport a session is", and those are
*different questions* that were previously answered by two systems that overwrote each other
(`absorb.ts` and `replan.ts`; bug reports #215, #219 and #220 were all versions of that collision).
They are now one ordered pass in [`lib/equilibrium.ts`](../../lib/equilibrium.ts):

- **CREDIT** (settles first, because it decides which sessions are still standing). Unplanned or
  athlete-added work is priced as `duration × intensity` in the load model's own sRPE units and
  compared with the target session **as first prescribed**:
  `e = credit(did) / credit(prescribed)`. Then `e ≥ 0.85` covers the session outright,
  `0.25–0.85` lightens it to `(1 − e)` of its design, `< 0.25` changes nothing. A 2 km jog scores
  ~0.17 against a 12 km long run and therefore does *not* discharge it — head-counting sessions
  ("he did three runs, done") is precisely the failure this replaces. Both sides are priced in
  **zones**, not raw RPE: landing inside the band you were prescribed *is* hitting the
  prescription, and pricing the delivered side at literal RPE punished accurate reporting.
  Settlement is idempotent — the `absorbedBy` stamp doubles as the receipt, so committing an added
  session and later completing it settles once, not twice.
- **COUNT** (runs second, on what remains). A swap leaves the sport mix wrong, so one session of
  the surplus sport is converted back, **role-matched** (`long ↔ long`, `quality ↔ quality`) rather
  than cheapest-first — sorting by "easiest available" is how a 75-minute long ride came back as a
  20-minute jog. A restoration must be a *relocation*: it may not grow the week beyond
  `RESTORE_GROWTH_TOLERANCE_SEC` (10 min, which covers builder granularity — the swim rounds to
  whole 100 m blocks, the bike will not build under 40 min) and may not shrink the session below
  70% of what it replaced. A **skip does not** count as a lost session: it is a decision about one
  session, answered by leaving the week lighter and saying so, not by silently rewriting a session
  the athlete never touched.

**Folding in completed/missed sessions and readiness without destabilizing.** `assessAdaptation` looks
at a *trailing two-week* window and decides one of three things: **ease** (missed ≥40%, or ≥3 sessions
averaging ≥1.5 RPE over prescribed → soften the *upcoming* week and record it in `easedWeeks` so we
don't re-nag), **ahead** (missed ≤10% and averaging ≤−1.0 → *encouragement only, deliberately no extra
load* — "that's how people get hurt"), or nothing. This asymmetry is the injury-safe thesis in code:
**the system readily protects but refuses to pile on.** It also never touches race week. This is a
markedly more conservative — and safer — adaptation policy than the "runs too aggressive" complaint
leveled at Runna.

**Idempotency & determinism of adaptation.** All adapt functions are pure and clone-before-mutate, so
they're safe to re-run. The one caution is that `rebuildFromToday` calls `generatePlan`, which inherits
the clock-seam non-reproducibility of §4.3 — a rebuild's *structure* depends on the day it runs. Once
`generatePlan` takes an injectable clock, adaptation becomes fully replayable, which is what makes the
§4.4 simulation/backtest harness possible.

**Where to grow it.** The trailing-window heuristic is coarse (two weeks, fixed thresholds). The
natural evolution — still deterministic — is a proper **acute:chronic load ratio** gate `[Outside-ACWR]`
computed from credited session load, easing when ACWR climbs above ~1.3 and green-lighting progression
only in the 0.8–1.3 sweet spot. That's a rules upgrade, not an ML one, and it's the single most
valuable adaptivity investment.

---

## 7. Economics — quantifying the ~$0 moat

### 7.1 The deterministic plan costs approximately nothing

`generatePlan` is pure CPU: a few hundred lines of arithmetic and one O(sessions×7) greedy loop over
~8 weeks to ~2 years. Runtime is sub-millisecond; it runs client-side in onboarding
(`components/onboarding/Onboarding.tsx`) and on rebuild with no server round-trip and no per-plan
variable cost. **Marginal cost per plan ≈ $0.** Every rebuild, every "what-if" in settings, every
adaptation re-run is also free. At 10k or 10M users the plan-generation line item is the same: zero.

### 7.2 What an LLM-per-plan competitor pays

A full multisport plan is large: 12+ weeks (up to ~2 years) × ~6–12 sessions × structured segments with cues. To
*author* that with an LLM you're emitting well north of 15–30k output tokens per plan (structured
workouts are token-heavy), plus a few thousand input tokens of context. Concrete rates (2025–26):

- **Claude 3.5 Haiku:** $0.80 / 1M input, $4.00 / 1M output. `[Anthropic-pricing, CloudZero]`
- **Gemini 2.5 Flash-Lite** (our configured default): $0.10 / 1M input, $0.40 / 1M output. `[Gemini-pricing, DevTK]`

Even at Flash-Lite's floor, authoring a ~25k-output-token plan is ≈ **$0.01 per plan**; on Haiku, ≈
**$0.10**. Cheap in isolation — but multiply by *every rebuild* (fall-behind realigns, settings
what-ifs, weekly re-plans). A single active athlete rebuilding weekly for a 6-month build is
20–30 generations; a serious LLM-authoring competitor is looking at **~$0.20–$3.00 per athlete-season
just to keep the plan current**, plus latency (seconds not milliseconds), plus provider-outage
fragility, plus the unbounded-worst-case safety liability of §1. Our number for all of that is still
**zero**, and it's *safe by construction*. That is the structural margin advantage — the same "software
scale beats human-coach cost" wedge Runna exploited against £100–300/mo coaches, taken one step further
against LLM-compute cost.

### 7.3 Where to spend the AI budget for maximum perceived value

Spend it on the **cheap, high-perceived-value, low-risk** slice — narration and inference — never on
authoring load. Trifecta's three touch points are exactly right, all default-off and degrading to a
working app with no key ([`lib/ai.ts`](../../lib/ai.ts) `aiEnabled()` gates everything):

1. **`/api/plan-summary`** — one JSON-mode call at plan creation: a 3–5 sentence "why this plan" +
   one line per phase. ~700 output tokens ≈ **$0.0003 on Flash-Lite.** This is the highest ROI AI in
   the product: it makes a free deterministic plan *feel* coached, right at the moment of activation.
2. **`/api/coach`** — on-demand chat, 400-token cap, rate-limited to 40/user/hr. ≈ **$0.0002/answer.**
   Perceived as a coach in your pocket; costs a rounding error.
3. **`/api/intake`** — parse free-text injuries into structured `Injury[]` that feed the *deterministic*
   injury caps. The model *reads*, the engine *decides* — the §1 line drawn perfectly.

All three carry crude per-user hourly limiters (`__coachHits`, `__planSumHits`, `__intakeHits`) so a
runaway or abusive client can't run up spend, and all three catch-and-degrade on provider error. The
whole AI layer could be disabled tomorrow and the product still fully works. That is the correct
posture: **AI is a garnish on a complete meal, not an ingredient the dish fails without.**

---

## 8. Opinionated roadmap — fix these, in this order

1. **Add a clock seam to `generatePlan`/`generateFitnessPlan`** (optional `todayISO`). Unlocks golden
   tests, true reproducibility, and the simulation harness. (§4.3)
2. **Stand up a property-test suite** over the §4.1 invariants with input fuzzing + shrinking. This is
   the single biggest risk-reduction for the beating heart of the product. (§4)
3. ~~**Fix the 3-week taper monotonicity bug**~~ **✅ done (2026-07-22, §4.2)** — still owed: add
   invariant #9 (and the §4.1 catalogue) as an automated regression test so it can't silently return.
4. **Enforce `weeklyHoursCap`** with a final normalization pass so the hours promise is real. (§3.4)
5. **Add explicit constraints for cross-day hard-session spacing and an ACWR/ramp-rate ceiling** —
   the two physiological objectives currently left emergent. (§3.4, §6)
6. **Then, and only if property tests show greedy producing bad dense weeks,** wrap `assignDays` in a
   simulated-annealing polish (greedy seed → SA against a richer penalty function). (§3.2)

Everything above keeps the engine deterministic, auditable, and free-to-run — evolving the moat rather
than trading it away for a model.

---

## Sources

- Nurse rostering as CSP; greedy vs SA vs ILP: [Wikipedia — Nurse rostering problem](https://en.wikipedia.org/wiki/Nurse_rostering_problem); [Springer — SA for nurse rostering](https://link.springer.com/article/10.1007/s10479-017-2546-8); [arXiv — A Greedy Double-Swap Heuristic for Nurse Scheduling](https://arxiv.org/pdf/1205.2200); [ScienceDirect — hybrid fix-and-optimize + SA](https://www.sciencedirect.com/science/article/abs/pii/S0360835220302655); [PMC — Healthcare scheduling optimization review](https://pmc.ncbi.nlm.nih.gov/articles/PMC8035616/).
- Property-based / metamorphic testing: [ZetCode — PBT tutorial](https://zetcode.com/terms-testing/property-based-testing/); [arXiv — Programmable Property-Based Testing](https://arxiv.org/html/2602.18545); [MarkTechPost — Hypothesis stateful/differential/metamorphic](https://www.marktechpost.com/2026/04/18/a-coding-guide-for-property-based-testing-using-hypothesis-with-stateful-differential-and-metamorphic-test-design/).
- Rules vs ML for safety-critical recommendation: [MDPI — Explainable ML in Critical Decision Systems](https://www.mdpi.com/2673-2688/5/4/138); [PMC — Explainability in AI-based clinical decision support](https://pmc.ncbi.nlm.nih.gov/articles/PMC9527344/); [IEEE — Explainable ML for CDSS](https://ieeexplore.ieee.org/document/10725028/).
- TrainingPeaks / WKO: [How to use WKO to construct training plans](https://www.trainingpeaks.com/blog/how-to-use-wko4-to-construct-training-plans/); [Performance Manager Chart in WKO5](https://wko5.zendesk.com/hc/en-us/articles/8043999135885-The-Performance-Manager-Chart-PMC-In-WKO); [FasCat — PMC](https://fascatcoaching.com/blogs/training-tips/performance-manager-chart/).
- TriDot: [Optimized Training (predictive.fit)](https://www.predictive.fit/optimized-training); [What TriDot delivers](https://www.tridot.com/what-tridot-delivers); [EnviroNorm — Consider the Conditions podcast](https://www.tridot.com/podcasts/consider-the-conditions-adjusting-intensities-to-your-training-environment).
- Runna: [How Runna builds your plan around current fitness](https://support.runna.com/en/articles/15231838-how-does-runna-build-your-training-plan-around-your-current-fitness); [Runna training plans](https://www.runna.com/training/training-plans).
- Humango: [HumanGO site](https://humango.ai/); [Triathlete — hands-on review of 8 AI triathlon apps](https://www.triathlete.com/gear/tech-wearables/ai-triathlon-training-apps/).
- Training-science invariants: [PMC — Training intensity distribution in elite endurance athletes (80/20)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4621419/); [Outside — Acute:Chronic Workload Ratio & the 10% rule](https://www.outsideonline.com/health/training-performance/injury-prevention-acute-chronic-workload-ratio-research/).
- LLM pricing: [Anthropic/Claude pricing docs](https://platform.claude.com/docs/en/about-claude/pricing); [CloudZero — Claude API pricing](https://www.cloudzero.com/blog/claude-api-pricing/); [Google Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing); [DevTK — Gemini 2.5 Flash-Lite pricing](https://devtk.ai/en/models/gemini-2-5-flash-lite/).
- Internal: [`lib/planEngine.ts`](../../lib/planEngine.ts), [`lib/decisions.ts`](../../lib/decisions.ts), [`lib/equilibrium.ts`](../../lib/equilibrium.ts), [`lib/workouts.ts`](../../lib/workouts.ts), [`lib/paces.ts`](../../lib/paces.ts), [`lib/zones.ts`](../../lib/zones.ts), [`lib/adapt.ts`](../../lib/adapt.ts), [`lib/calibrate.ts`](../../lib/calibrate.ts), [`lib/predict.ts`](../../lib/predict.ts), [`lib/ai.ts`](../../lib/ai.ts), [`lib/types.ts`](../../lib/types.ts), `app/api/{coach,plan-summary,intake}/route.ts`, [`docs/research/runna-competitive-analysis.md`](../research/runna-competitive-analysis.md).
