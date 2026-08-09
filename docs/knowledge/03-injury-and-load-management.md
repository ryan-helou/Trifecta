# Injury & Load Management + Biomechanics
> Canonical Trifecta knowledge doc · Realm 3 of 8 · Last researched: 2026-07-22

**Purpose:** Injury-awareness is Trifecta's flagship differentiator — the thing Runna
structurally ignores and the reason a time-crunched age-grouper trusts us with their
season. This doc is the clinical and scientific backbone for that claim. It sets out what
the sports-medicine evidence actually says about how endurance athletes get hurt, how
tissue adapts and heals on different clocks, what genuinely prevents injury (strength,
not stretching), and how to reintroduce load safely — then holds our engine
([`lib/planEngine.ts`](../../lib/planEngine.ts), [`lib/adapt.ts`](../../lib/adapt.ts))
up against that evidence, honestly, including where our current model is oversimplified
or clinically risky. It also draws the liability line: an app that reshapes training
around injury is making a safety promise, and a safety promise that misfires is both a
lawsuit and a churn event. Read this before building anything in the injury/readiness
surface.

---

## TL;DR — the things that actually matter

1. **Running is where triathletes get hurt.** Roughly **50% of triathlon injuries are
   running injuries, ~43% cycling, ~7% swimming** — but swimming's per-athlete shoulder
   overuse rate is high (40–91% of competitive swimmers report shoulder pain). Injuries
   are overwhelmingly **overuse, not acute** (overuse incidence 37–91% in long-course).
   The impact sport (run) is the one that needs protecting; bike and swim are your
   offload valves. Our engine already leans on this.

2. **"Load spikes cause injury" is directionally true but the famous number (ACWR
   sweet-spot 0.8–1.3) is scientifically discredited.** Gabbett's acute:chronic
   workload ratio was retracted-in-spirit by Impellizzeri & Lolli (mathematical coupling
   → spurious correlation; the sweet-spot figure is flawed). Treat rapid load increase as
   a *risk heuristic*, never a hard rule or a threshold to hard-code.

3. **The "10% rule" has no good evidence** (Buist RCT: 10% vs ~24–50%/week ramp → same
   ~20% injury rate). What matters is avoiding *large single-session spikes*, keeping
   *total exposure* sane, and *deloading regularly*. Our 3:1 / 2:1 load:recovery cycles
   are more defensible than any percentage rule.

4. **Tissues adapt on different clocks — this is the whole game.** Muscle/cardio adapt in
   days–weeks; **tendon in weeks–months; bone is slowest.** Fitness (heart, muscle) races
   ahead of what tendons and bone can tolerate — which is *why* impact-sport overuse
   injuries appear weeks into a build that "felt fine." A plan must ramp to the slowest
   tissue, not the fittest system.

5. **Rest is the wrong prescription for tendons.** Tendinopathy wants *progressive
   tensile load* (isometrics → heavy-slow-resistance), not rest. Bone stress injury wants
   the opposite: *impact offloading* for weeks. Our engine treats every injury the same
   way by *severity*, ignoring *mechanism* — the single biggest clinical oversimplification
   in our model.

6. **Strength training is the strongest evidence-based injury reducer we have** (Lauersen
   2014: overuse injuries roughly **halved**, RR ≈ 0.34 overall, dose-dependent).
   Stretching does essentially nothing for injury. Yet in our engine strength is **opt-in
   and off by default** — the best prevention lever, left on the table.

7. **Our real moat is auto-regulation that only ever protects.** `adapt.ts` eases the plan
   when the athlete falls behind or overreaches, and *deliberately refuses to pile on load
   on good days* ("that's how people get hurt"). That asymmetry is clinically wise and
   almost unique in the market. Our gaps are: **no pain sensor, no healing timeline, no
   mechanism-awareness, no red-flag triage.**

8. **The pitch "the app that won't get you injured" raises the liability bar.** We must
   pair it with a real medical disclaimer, PAR-Q-style screening, explicit
   scope-of-practice limits, and hard-coded "see a professional" triggers for red flags
   (bone stress injury, RED-S/low energy availability, cardiac symptoms). Injury-awareness
   is a *safety feature* only if it also knows when to get out of the way.

---

## 1. Core knowledge

### 1.1 Epidemiology — who gets hurt, where, how often

**Triathlon, aggregated.** Injuries cluster in the **running leg (~50%)**, then cycling
(~43%), then swimming (~7%) — but that's *count of injuries*, not per-hour risk, and it
reflects that running is the highest-impact discipline. Short-course triathletes show
injury incidence around **15.7–24.3 per 1000 athlete-exposures**; long-course studies
report **overuse-injury incidence of 37–91%** and acute-injury incidence of **24–27%**.
The dominant pattern everywhere is **overuse, not trauma**. Most common sites across the
sport: **knee, lower leg, lower back, shoulder**. Elite athletes carry *lower* overuse
rates (~37%) — better technique, strength, and load management — while non-elite
age-groupers (our user) carry the *highest acute* rates (~27%). (Evidence quality is
mediocre: mostly retrospective cross-sectional studies, few prospective cohorts. Cite
ranges, not point values.)

**Running injuries — the ones that will define our reputation.** In rough order of
frequency and by mechanism:

| Injury | Type | Tissue | Typical time-loss | Notes for the engine |
|---|---|---|---|---|
| **Patellofemoral pain (PFP, "runner's knee")** | Overuse | Cartilage/loading | Weeks; recurrent | The single most common running injury. Load- and cadence-sensitive. |
| **Iliotibial band syndrome (ITBS)** | Overuse | Fascia/bursa | 2–6 weeks | Aggravated by downhill, high volume, hip weakness. |
| **Achilles tendinopathy** | Overuse | **Tendon** | Weeks–months | Wants *loading*, not rest. HSR/eccentric protocols. |
| **Patellar tendinopathy ("jumper's knee")** | Overuse | **Tendon** | Weeks–months | Same loading principle as Achilles. |
| **Medial tibial stress syndrome (MTSS, "shin splints")** | Overuse | Bone-periosteum | 2–6 weeks | Can be a precursor to a bone stress injury on the same spectrum. |
| **Bone stress injury / stress fracture** | Overuse (accumulated) | **Bone** | **Weeks–months; up to ~17 wk for high-grade tibia** | The dangerous one. Needs *impact offloading*, sometimes a walking boot. Red-flag territory. |
| **Plantar fasciitis** | Overuse | Fascia | Weeks–months (stubborn) | Load- and footwear-sensitive. |

**Cycling injuries — mostly positional/overuse, low impact.** The knee is the most common
site (**~40–60% of cyclists** report knee pain), driven by saddle height/cleat position.
**Lower-back pain** is very common and responds strongly to bike fit. **Pudendal
neuralgia / saddle-related genital numbness** (saddle pressure) improves markedly with
cut-out saddles and tilt adjustment (one study: 64% improved). Neck/shoulder from
sustained aero position. Crucially: cycling is **non-impact**, so it's the *safest place
to park aerobic load* when running is compromised — which is exactly what a good engine
should exploit.

**Swimming injuries — overwhelmingly the shoulder.** "**Swimmer's shoulder**" (subacromial
impingement / rotator-cuff and supraspinatus tendinopathy) affects **40–91%** of
competitive swimmers by prevalence; scapular dyskinesis is reported in **8.5–69%**.
Mechanism: tens of thousands of overhead revolutions, serratus anterior/subscapularis
fatigue degrading stroke mechanics. Swimming is low-impact for legs (great cross-training
for a runner), but it is *not* a free ride for someone with a cranky shoulder.

### 1.2 Mechanisms — how training load turns into injury

**The load–injury relationship, honestly.** The intuition is right: injuries tend to
follow *rapid increases* in load relative to what the body is prepared for. The dominant
framework was Tim **Gabbett's acute:chronic workload ratio (ACWR)** — acute load (this
week) ÷ chronic load (rolling ~4-week average), with a claimed "sweet spot" of ~0.8–1.3
and a "danger zone" above ~1.5. The IOC once recommended it.

**But the ACWR is scientifically discredited as a precise tool**, and we must not
hard-code it:

- **Mathematical coupling (Lolli et al.):** the acute load is *part of* the chronic load
  in the denominator, which manufactures a **spurious correlation** — the "relationship"
  is partly an artifact of the arithmetic.
- **Conceptual critique (Impellizzeri et al.):** ACWR reflects *training load*, not
  *biomechanical/tissue loading*; the time windows lack physiological justification; and
  the famous sweet-spot *figure* is methodologically flawed. Impellizzeri's group formally
  requested retraction/correction of the Gabbett & Blanch figure.
- **Empirical fragility:** when outliers are removed and workload is treated as
  continuous, **the ACWR-injury association often disappears.**

Takeaway for Trifecta: **"avoid sharp jumps in load" is a sound principle; any specific ACWR
threshold is not evidence.** Use ramp-rate awareness as a soft heuristic, never a
gate with a magic number.

**Monotony and strain (Foster).** Beyond total load, *how you distribute it* matters.
Foster's session-RPE method computes internal load as **RPE (0–10) × duration (min)**.
From daily loads:
- **Monotony = weekly mean daily load ÷ SD of daily load** (high when every day is the
  same).
- **Strain = weekly load × monotony.**
High **monotony combined with high load** is associated with illness and overtraining.
The practical lesson — **hard/easy variation protects you** — is baked into 80/20
polarized training and into deload weeks. Trifecta's easy-day / hard-day scheduling and
recovery weeks reduce monotony almost as a side effect.

**Sleep and energy availability are load multipliers.** Chronic short sleep and **low
energy availability** (eating too little for the training done) degrade tissue repair and
sharply raise injury (and bone stress) risk. This is why RED-S (§1.5) sits inside the
injury conversation, not next to it.

### 1.3 Tissue-specific adaptation timelines — why the plan must respect the slowest tissue

Different tissues remodel on **different clocks**, and injuries happen when load outruns
the *slowest* relevant tissue while the *fastest* systems feel great:

- **Cardiovascular / metabolic:** adapts fastest — days to a few weeks. This is the system
  that makes a beginner feel "ready for more" before their tissues are.
- **Muscle:** adapts fast — DOMS resolves in 24–72h; hypertrophy/strength over weeks.
- **Tendon:** slow — **weeks to months.** Collagen turnover and stiffness gains lag muscle
  strongly. This mismatch (strong muscle pulling on an under-adapted tendon) is a classic
  tendinopathy setup.
- **Bone:** **slowest.** Bone remodeling runs on a multi-week cycle; there's a window where
  osteoclastic resorption *precedes* osteoblastic rebuild, so bone is transiently
  *weaker* during rapid load increases — which is why bone stress injuries surface weeks
  into a build, not on day one.

**Design consequence:** ramp rate should be governed by tendon and bone tolerance, which
you cannot see in HR or pace. A plan that ramps to how the athlete's *engine* feels will
predictably hurt their *structure*. Deloads, caps on long-session growth, and conservative
progression aren't timidity — they're matching the slowest clock.

### 1.4 Safe progression and reintroduction of load

- **The 10% rule is a myth with a good heart.** Buist's RCT found a 10%/week ramp and a
  steeper (~24–50%/week) ramp produced **the same ~20% injury rate**; Nielsen found injury
  risk climbs once weekly *distance* jumps by **>30%** (HR ≈ 1.59 vs <10%). Conclusion:
  there is **no magic percentage**; steer by (a) avoiding large single-session spikes,
  (b) keeping total exposure appropriate to training age, and (c) building in regular
  recovery weeks.
- **Deload cadence:** classic **3:1** (three loading weeks : one recovery) for trained
  athletes, **2:1** for beginners/older athletes. Recovery weeks drop volume ~30–40%.
- **Minimum effective dose:** for the time-crunched age-grouper, the goal is the *least*
  load that drives adaptation, not the most they can survive — this is both a performance
  and an injury argument.
- **Return after time off is a graded reintroduction, not a jump back in.** Standard
  return-to-run uses **walk/run progressions** (e.g., alternating walk and jog intervals,
  extending run portions over sessions/weeks), gated by symptoms. **Progress volume before
  speed** — for tibial bone stress injury, slower running roughly *halves* re-injury risk;
  speed is added last.

### 1.5 Return-to-load and rehab principles

- **Relative rest, not complete rest.** Complete rest deconditions everything and (for
  tendon) is counterproductive. *Relative* rest means removing the *aggravating* load while
  maintaining fitness through unaffected pathways.
- **Cross-training substitution (offloading).** The core injury-aware move: shift aerobic
  load off the injured impact tissue onto low/zero-impact modalities.
  - **Aqua-jogging / deep-water running:** zero-impact, closely mimics the run
    neuromuscular pattern, and **maintains aerobic fitness for 4–6 weeks** in trained
    runners (studies show no significant 5K-time loss over 4 weeks of pool-only running).
    **Safe even with a stress fracture** (non-weight-bearing).
  - **Cycling / swimming:** offload running load while holding the aerobic engine — a
    triathlete's structural advantage over a pure runner.
- **Pain-monitoring model — the "0–5 rule" (Silbernagel).** For **tendinopathy**, you do
  *not* need to be pain-free to load. Pain **up to ~5/10** during and after loading is
  *acceptable* provided it (a) **settles by the next morning** and (b) **does not
  progressively worsen week to week** (morning stiffness must not increase). This turns
  "pain" from a binary stop sign into a titratable dial — the correct mental model for a
  niggle.
- **Progressive tendon loading (the ladder).** Cook & Purdam's **continuum** (reactive →
  dis-repair → degenerative) implies stage-appropriate loading:
  1. **Isometrics** (long holds) — analgesic, reduces pain, loads without lengthening.
  2. **Heavy-slow-resistance (HSR)** — now considered *equal* to classic eccentric
     protocols and often better tolerated. Alfredson's eccentric protocol (**3×15 reps,
     twice daily, ~12 weeks**) is the historical benchmark; HSR (heavy, slow tempo, 3×/wk)
     achieves comparable outcomes.
  3. **Energy-storage / plyometric loading** — reintroduce the stretch-shortening cycle.
  4. **Return to running/sport.**
  The through-line: **tendons need progressive tensile load, not rest.**

### 1.6 Prevention that actually works

- **Strength training — the headline.** Lauersen et al. (2014, BJSM; 25 RCTs, ~26,610
  participants, ~3,464 injuries): strength training reduced **overuse injuries by ~50%**
  and **acute injuries by ~30%** (overall RR ≈ 0.34), with a **dose-response** (more
  strength work → fewer injuries). **Stretching showed no protective effect.** This is the
  most robust prevention finding in the field. For runners specifically, heavy strength +
  plyometric/tendon conditioning is the intervention with real evidence.
- **Cadence / running form (modest, real, individualized).** Raising cadence ~5–10% (many
  recreational runners sit at 150–170 spm; a common *target* is ~170–180 spm but it is
  individual and speed-dependent) shortens the stride, brings foot strike closer under the
  center of mass, **reduces overstride, ground-reaction force, and vertical loading rate**
  (~20% reductions at the knee in some studies), and is linked to lower PFP, tibial stress
  fracture, and MTSS risk. Caveat: evidence is heterogeneous; "180 for everyone" is a myth.
  Vertical oscillation and overstride matter *because* of loading rate, not as vanity
  metrics.
- **Bike fit.** Individualized fitting reliably reduces lower-back pain, anterior/posterior
  knee pain, and pudendal pressure. Saddle height, setback, cleat position, and reach are
  the levers.
- **Swim technique + scapular/rotator-cuff strength** reduce shoulder overload; managing
  overhead volume and stroke mechanics matters more than "swim more."
- **Load monitoring, sleep, fueling.** Regulating ramp rate, protecting sleep, and avoiding
  low energy availability are prevention, not lifestyle garnish.
- **Mobility/stretching myths.** Static stretching does not prevent injury and does not
  reduce DOMS meaningfully. Mobility work has a role for *specific* restrictions, but it is
  not injury insurance. Don't sell it as such.

### 1.7 Red flags and scope — when the app must step back

Hard "**see a professional**" triggers — these are outside any app's competence and inside
real medical risk:

- **Bone stress injury signs:** *focal, pinpoint bony tenderness*; pain that **worsens
  through** a run rather than warming up; **night pain**; pain on single-leg hop; pain that
  persists at rest. High-risk sites (anterior tibia, femoral neck, navicular, base of 5th
  metatarsal, medial malleolus) are surgical-consult territory. Do not "train around" a
  suspected bone stress injury.
- **RED-S / low energy availability (IOC 2023 consensus, Mountjoy et al.):** a spectrum
  from *adaptable* to *problematic* LEA affecting **both sexes**, with downstream effects
  on bone (→ stress fractures), endocrine/menstrual function, immunity, and performance.
  The 2023 statement uses a **traffic-light (green/yellow/orange/red) risk stratification**
  and mandates a multidisciplinary team for real cases. Signals an app might surface:
  recurrent bone injuries, rapid unexplained weight loss, menstrual dysfunction, chronic
  fatigue with high volume. **Refer — never coach an eating/energy problem.**
- **Cardiac red flags:** exertional chest pain/pressure, syncope or near-syncope,
  unexplained/disproportionate breathlessness, palpitations. **Stop and seek medical care.**
- **Neurological / structural:** progressive numbness, weakness, or radicular pain →
  medical.

---

## 2. State of the art — what the best in the world do

- **Elite endurance programs govern ramp rate by the slowest tissue and monitor
  subjectively + objectively.** Session-RPE load, wellness questionnaires (sleep,
  soreness, stress, mood), and — where available — HRV and jump/CMJ tests. They treat
  monotony/strain as first-class, not just total load.
- **Modern sports-medicine consensus has moved from "rest it" to "load it correctly."**
  Tendinopathy management is *loading* management; return-to-run is *graded exposure*; the
  clinician's job is titrating load using the pain-monitoring model, not prescribing time
  off.
- **The IOC leads the safety-standard work:** the 2023 REDs consensus (energy availability)
  and the injury/illness surveillance consensus (how to even count injuries) are the
  reference frameworks. Serious apps align their language to these.
- **Best-in-class digital coaching** (the direction Runna gestures at but doesn't reach)
  layers **daily readiness/auto-regulation** on top of a periodized plan: sleep/stress/
  soreness (and sometimes HRV) downshift *today*, and a *pain flag* on a session escalates
  into a protective response. Crucially, the good ones make auto-regulation **asymmetric —
  quick to ease, slow to add** — because the cost of over-loading (injury) is far higher
  than the cost of a slightly-too-easy day.
- **Prevention is programmed, not suggested.** The leading run programs *bake in* strength
  and tendon conditioning (2–3×/week) as part of the plan, because they know it's the
  single biggest injury lever — not an optional side quest.
- **Scope discipline.** Reputable apps are explicit that they are **not medical devices and
  not medical advice**, screen with PAR-Q-style questionnaires, and route red flags to
  clinicians. This is table stakes for anyone whose brand touches "injury."

**Where the market is weak (our opening):** Runna and most run apps **do not model injury
at all**, **do not auto-regulate to daily readiness**, and put the onus on the user to
manually downshift when a plan feels too hard or a niggle appears
(see [runna-competitive-analysis.md](../research/runna-competitive-analysis.md)). Injury
and overtraining complaints are their most visible open flank. Trifecta's engine already
does injury-driven plan reshaping *and* protective auto-regulation — the two things the
category is missing.

---

## 3. How this maps to Trifecta

### What our engine already does (with citations)

Injury is a **first-class profile input** (`Injury` in
[`lib/types.ts:192`](../../lib/types.ts): `area`, `disciplines[]`, `severity`,
optional `note`) with severity `niggle | moderate | severe`
([`types.ts:189`](../../lib/types.ts)). The engine turns injuries into per-sport
modifiers and reshapes the whole week around them:

- **`injuryMods()`** ([`planEngine.ts:256`](../../lib/planEngine.ts)) maps each injury to
  a `{ capZone, volMult, avoid }` per affected sport:
  - **Intensity cap** ([`:260`](../../lib/planEngine.ts)): niggle → **Z3**, moderate/severe
    → **Z2**. (Clamps how hard sessions in that sport may go.)
  - **Volume multiplier** ([`:261`](../../lib/planEngine.ts)): niggle **0.85**, moderate
    **0.6**, severe **0.4**.
  - **Avoidance** ([`:262`](../../lib/planEngine.ts)): severe → `avoid = true`.
  - Multiple injuries **combine conservatively** ([`:265–268`](../../lib/planEngine.ts)):
    take the *minimum* cap, *minimum* volMult, and *OR* the avoid flags.
- **`weekSportCounts()`** ([`planEngine.ts:287`](../../lib/planEngine.ts)) applies those to
  the week's session counts:
  - Multiplies each affected sport's session count by `volMult`
    ([`:296–303`](../../lib/planEngine.ts)); `avoid` keeps at most **one gentle session**
    ("to hold feel", [`:299`](../../lib/planEngine.ts)).
  - **Substitution/offloading** ([`:305–314`](../../lib/planEngine.ts)): sessions freed by
    an injury are **shifted onto the healthy, low-impact sports** (those with
    `volMult ≥ 0.85` and not `avoid`). This is the clinically correct "move load off the
    injured tissue" instinct.
  - Recovery weeks ease all sports ×0.7 ([`:330–337`](../../lib/planEngine.ts)); taper trims
    and drops most strength ([`:338–341`](../../lib/planEngine.ts)).
- **Injury-aware key sessions** ([`planEngine.ts:448–479`](../../lib/planEngine.ts)):
  `keySwimBuild`, `bikeQualityRole`, and `runQualityRole` **read the cap and downgrade
  intensity** — e.g. run cap ≤ 2 forces easy running instead of tempo/threshold/VO2
  ([`:471`](../../lib/planEngine.ts)); bike cap ≤ 2 forces endurance instead of sweet-spot/
  threshold ([`:463`](../../lib/planEngine.ts)). When a sport is `avoid`, the role lists
  collapse to short, gentle sessions only ([`:394–396`](../../lib/planEngine.ts) bike,
  [`:403–405`](../../lib/planEngine.ts) run, [`:411–413`](../../lib/planEngine.ts) swim).
- **Brick gating** ([`planEngine.ts:381`](../../lib/planEngine.ts)): the long ride only
  becomes a bike→run **brick** if `run.capZone ≥ 3 && !run.avoid && !bike.avoid` —
  otherwise it stays a long *endurance ride*. Clinically sound: running off the bike on a
  compromised run tissue is exactly what you don't want, so we protect it by keeping the
  load on the bike. Race-pace on the long run is likewise gated on run cap ≥ 3
  ([`:401`](../../lib/planEngine.ts)).
- **Protective closed-loop auto-regulation** ([`lib/adapt.ts`](../../lib/adapt.ts)):
  `assessAdaptation()` ([`adapt.ts:314`](../../lib/adapt.ts)) looks at the trailing two
  weeks and suggests **"ease"** when the athlete missed ≥40% of sessions *or* sessions felt
  consistently overreaching (avg strain ≥ 1.5) ([`:335`](../../lib/adapt.ts));
  `applyAdaptation()` → `easeUpcoming()` ([`:250`](../../lib/adapt.ts)) downgrades hard
  sessions to endurance and trims volume. Critically, on the **"ahead"** path it
  **deliberately adds no load** — the code comment is explicit: piling on load "is how
  people get hurt" ([`:283–286`, `:344–356`](../../lib/adapt.ts)). This *asymmetric,
  protect-only* regulator is our best injury-safety mechanism.
- **Baseline injury-risk hygiene** independent of any declared injury: **3:1 / 2:1
  load:deload** cycles ([`planEngine.ts:620`](../../lib/planEngine.ts)) with ~62% recovery
  weeks ([`:654`](../../lib/planEngine.ts)); **long-session caps** so long run/ride can't
  run away ([`:51–52`](../../lib/planEngine.ts)); a taper ([`:48`](../../lib/planEngine.ts));
  and an 80/20 easy/hard bias. All of these lower injury risk before injuries are even
  entered.

### Where we're strong

- **Injury is a first-class citizen that reshapes the entire plan** — intensity, volume,
  sport mix, and session *type* all bend around it. No mainstream run/tri app does this;
  it is the exact gap Runna leaves open.
- **The offloading logic is clinically legitimate.** Moving freed load onto low-impact
  sports, suppressing the brick when running-off-the-bike is unwise, and capping intensity
  on the injured sport together implement *relative rest + cross-training substitution* —
  the textbook injury-aware move.
- **The protect-only asymmetry in `adapt.ts` is genuinely good sports medicine and a rare
  design choice.** Quick to ease, refuses to over-reach on good days. That single decision
  prevents a whole class of "felt great, blew myself up" injuries.
- **Deterministic + ~$0 regeneration** means we can rebuild an entire injury-adjusted plan
  instantly and for free — an auto-regulation loop that's economically impossible for an
  LLM-per-plan competitor to match.

### Where we're weak or risky (be honest)

1. **Injuries are static — there is no healing timeline.** `Injury`
   ([`types.ts:192`](../../lib/types.ts)) has **no start date, no expected-return, no
   status, no trajectory.** A severe injury pins that sport at **0.4× volume forever** until
   the user hand-edits their profile. Real rehab is a *progression* (offload → graded
   reload → return to full load); we model a **permanent tax, not a recovery curve.** This
   is the biggest clinical gap: we're injury-*aware* but not rehab-*aware*.

2. **Severity is mechanism-blind — the single biggest oversimplification.**
   `niggle/moderate/severe` collapses tissue type, but the *correct prescription inverts by
   mechanism*:
   - A **tendinopathy** wants **progressive tensile load** — rest and intensity-capping
     make it *worse*. Our `capZone` would *forbid* the heavy-slow-resistance loading that
     actually heals it.
   - A **bone stress injury** wants **impact/volume offloading** — capping *zone*
     (intensity) barely touches the real driver (impact volume), and keeping a "gentle
     run" can be actively harmful.
   Capping a Zone conflates **intensity** with **mechanical/impact load**; for tendon and
   bone those are different axes. The engine gives the same answer to two injuries that
   need opposite treatment.

3. **`avoid` still keeps "one gentle session"** ([`planEngine.ts:299`](../../lib/planEngine.ts))
   even for a *severe* injury. For a suspected bone stress injury or acute severe injury,
   the correct volume is often **zero impact** for weeks. A gentle run on a severe run
   injury is a plausible way to *cause harm*, which is the opposite of the promise.

4. **Substitution can manufacture a new load spike.** Freed run sessions are dumped onto
   bike/swim (up to 8 sessions, [`:305–314`](../../lib/planEngine.ts)) with **no ramp on
   the receiving sport.** An athlete not conditioned to that bike/swim volume gets an acute
   load spike (the very ACWR-style jump §1.2 warns about) and a fresh overuse risk —
   ironically, an injury-avoidance move that can injure. And a shoulder-injured swimmer's
   freed sessions could be pushed toward more of a sport their shoulder can't tolerate if
   the injury only tags one discipline.

5. **No pain sensor anywhere.** The post-session check-in captures `rpe` and `feel`
   (`great/ok/rough`, [`types.ts:33`, `:74–77`](../../lib/types.ts)) and the readiness
   check-in captures `sleep/legs/energy` ([`types.ts:112`](../../lib/types.ts)) — but
   **nothing captures pain or its location.** `sessionStrain()`
   ([`adapt.ts:292`](../../lib/adapt.ts)) reasons from effort/feel, never pain. So a
   recurring niggle can *never* escalate into a protective downshift or a referral. The
   Runna analysis explicitly flags wiring a pain flag as a to-do
   ([research §7](../research/runna-competitive-analysis.md)); it's our missing safety
   sensor.

6. **No red-flag triage and no "see a professional" path.** Nothing detects bone-stress-
   injury signs, RED-S/low energy availability, or cardiac symptoms, and nothing routes the
   user out to a clinician. For an app whose *pitch* is injury-safety, the absence of a
   triage layer is both a safety gap and a liability exposure (§4).

7. **The strongest prevention lever is off by default.** Strength is **opt-in**
   (`StrengthPref.enabled`, [`types.ts:182`](../../lib/types.ts);
   `strengthDaysOf` returns 0 when disabled, [`planEngine.ts:187`](../../lib/planEngine.ts)).
   Given strength roughly *halves* overuse injuries (§1.6), shipping it off-by-default and
   un-nudged leaves our best injury-prevention tool unused.

8. **Injury doesn't slow the overall ramp.** `volMult` trims per-sport session *counts*,
   but the phase load curve and week-over-week progression rate are unchanged — there's no
   injury-driven flattening of the ramp during reintroduction, which is exactly when ramp
   rate matters most.

9. **No liability scaffolding in the product.** No medical disclaimer, no PAR-Q-style
   pre-participation screen, no scope-of-practice framing is surfaced in the code we
   reviewed. The safety pitch raises the bar we currently don't meet (§4).

---

## 4. Principles & decision rules — READ THIS BEFORE BUILDING IN THIS REALM

**A. Model the mechanism, not just the severity.** The next iteration of the injury model
should carry *tissue/mechanism* (tendon vs bone vs muscle vs joint/PFP vs ITBS-type) or at
least a coarse **"wants load" vs "wants offload"** flag, because the correct response
*inverts*:
- **Tendon ("wants load"):** *don't* rest it to zero and *don't* just cap intensity; keep
  it loading, bias toward **strength/isometric/HSR**, titrate with the **0–5 pain rule**.
- **Bone / stress ("wants offload"):** cut **impact volume** hard, substitute to
  **aqua-jog / bike / swim**, and *do not* keep a "gentle run." Treat as **red-flag until
  cleared.**

**B. Make injuries time-aware.** Add `startDate` and a `status`/stage to `Injury`, and let
severity *decay along a recovery trajectory* rather than sitting as a permanent multiplier.
Reintroduction should be a **graded ramp** (walk/run-style for run; **volume before
speed**), not a step back to full load. This is the difference between "injury-aware" and
"rehab-aware."

**C. Auto-regulation stays asymmetric — protect fast, add slow.** ~~Preserve the `adapt.ts`
rule that good days never add load.~~ Any future readiness/pain input should be able to
*ease* the plan automatically but should require deliberate, gradual steps to *increase*
it. The cost function is asymmetric: a missed adaptation is cheap; an injury is a churn
event.

> ### ⚠️ OVERRIDDEN by product decision — 2026-08-09, Ryan
>
> **Decision:** the plan adapts automatically in BOTH directions. An athlete who is
> consistently under the load this block budgeted for now gets load added back without
> being asked, exactly as an athlete who is over it gets load removed. This is ticket
> 184's core requirement ("the plan needs to automatically and dynamically update after
> everything"), and it was put to Ryan explicitly as a choice between an *offered*
> increase that preserves this rule and an automatic one that overrides it. He chose the
> automatic version.
>
> **What this rule was protecting against, recorded so the trade is not forgotten:** the
> two errors are not symmetric. Easing when it wasn't needed costs a little training.
> Adding when it shouldn't have been added costs an injury, and an injury is a churn
> event — weeks lost, and for a health product, a liability surface. That asymmetry has
> not stopped being true; it has been *accepted*.
>
> **What still bounds the increase** (these are doc 04 §4.1 #10 and this doc's own
> injury caps, NOT rule C, so the override does not touch them):
> - `RAMP_MAX = 1.25` and `increasesAnyWeek()` in `lib/rails.ts` — an automatic increase
>   is validated by `railsRegressed()` and is refused if it would breach the week-over-week
>   ramp or push the block out of its intensity band.
> - `MAX_ADD` in `lib/prescribe.ts` caps a single automatic increase well below the 1.5×
>   an athlete may ask for by hand. The plan is less free with load than the athlete is.
> - Never in race week, never past the taper, and never for a session inside an injured
>   discipline's cap (rules A and B still stand).
> - The deadband still applies, so this only fires on a sustained trend, not one easy day.
>
> **If this is ever revisited:** the safe version that was NOT taken is an offered
> increase — surface "you have been training lighter than planned, want to put some
> back?" and apply a graded increase on acceptance. That preserves the asymmetry while
> still answering "I feel good, I could go longer".

**D. Add a pain sensor and let it escalate.** A per-session **pain flag with location and
0–10 severity** is the missing input. Wire it so that: mild, non-worsening pain → continue
with monitoring (0–5 rule); worsening or red-flag pain → protective downshift *and* a
triage prompt. This is the single highest-leverage safety feature we can add.

**E. Nudge strength on; it's prevention, not a nice-to-have.** Given the evidence, default
to *offering* 2×/week strength prominently (especially for beginners and injury-prone
users), framed as injury prevention. Don't bury the strongest lever behind an off-by-default
toggle.

**F. Never ramp the substitute sport faster than you'd ramp it fresh.** When offloading
freed sessions onto another sport, apply the *same* progression discipline to the receiving
sport — cap how many sessions can be added per week so offloading doesn't create a new
spike.

**G. Cadence/form advice: offer, don't prescribe, and individualize.** A "your cadence
looks low, a ~5% increase can reduce impact" nudge is defensible; "everyone should hit
180 spm" is not. Anchor any biomechanics guidance to *reducing loading rate/overstride*,
flag it as general education, and keep it individual and speed-aware.

**H. Liability / scope-of-practice — do's and don'ts.**

*This is not optional for an injury-positioned product. Physical injury is the single most
common source of fitness-industry liability, and negligence attaches when a program is
prescribed without knowledge of relevant medical history. Our safety pitch raises — not
lowers — the standard we're held to.*

**DO:**
- Ship a clear, prominent **medical disclaimer**: Trifecta provides **general fitness
  information, not medical advice**, is **not a medical device**, and does **not diagnose,
  treat, or rehabilitate injury.**
- Screen at onboarding with a **PAR-Q-style pre-participation questionnaire** (cardiac
  history, current injury, pregnancy, etc.) and record it — knowing the user's relevant
  history is exactly what negligence hinges on.

  > ⚠️ **Current state, 2026-08-01 — we do NOT do this, by deliberate product decision.**
  > The six-question PAR-Q step was **removed from onboarding** (it was the heaviest moment
  > in the flow and sat immediately before the payoff). The injuries free-text step is now
  > the only health screen: its prompt asks for current niggles, past history, *and* the
  > medical side, and explicitly names the cardiac symptoms so they get mentioned —
  > `detectRedFlags` (`lib/redFlags.ts`) then triages the text on-device for `cardiac`,
  > `bone-stress`, `neuro` and `acute-trauma` language and fires a referral.
  >
  > **Be honest about the trade:** this only catches what the athlete *volunteers*. A
  > questionnaire asks everyone about syncope and heart medication; a free-text box asks
  > nobody. The referral logic and the disclaimer (the other two DOs) are intact, and the
  > `healthScreen` field remains on `Profile` so screens recorded before this date are
  > preserved — but there is no longer a recorded pre-participation screen for new
  > athletes. If we ever want the record back, the cheap version is a single
  > "none of these apply" affirmation over the same items, which is how PAR-Q+ is actually
  > administered and is one tap for most people.
- Use **informed-consent / assumption-of-risk** language and, where enforceable, a
  liability waiver (validity varies by jurisdiction — get counsel; don't assume a
  click-through waiver is universally binding).
- **Hard-code red-flag triggers → "see a qualified professional"** for suspected bone
  stress injury, RED-S/low energy availability, and cardiac symptoms (§1.7). A well-placed
  referral is a *safety feature and a liability shield*.
- Frame our injury logic as **conservative and protective** ("we ease off when in doubt"),
  and log the adaptations we made so there's an audit trail of protective intent.
- Keep our claims **truthful and bounded** — "helps you train around niggles and avoid
  common overload mistakes," **not** "won't get you injured" / "prevents injury."

**DON'T:**
- **Don't diagnose.** Never label a user's pain as a specific pathology
  ("you have Achilles tendinopathy"). Offer *general* education and, when in doubt, a
  referral.
- **Don't prescribe rehab as treatment.** We can *reduce and substitute training load*;
  we do not deliver a medical rehabilitation program. That's a licensed clinician's
  scope-of-practice.
- **Don't coach energy/eating problems.** RED-S/LEA is a medical referral, full stop.
- **Don't over-claim.** Marketing that promises injury *prevention* converts an aspiration
  into a warranty you can be sued on. "Injury-*aware*" and "readiness-*adaptive*" are the
  honest, defensible framings.
- **Don't let a "gentle session" override a clear stop.** If the mechanism says zero impact,
  the plan must be able to prescribe *zero*, not "one easy run."

*The reframe that squares the circle: injury-awareness done right is a **safety feature,
not a liability.** A plan that eases off, offloads to safe modalities, and knows when to
say "see someone" is demonstrably more careful than a static plan that ignores injury
entirely — which is a defensible posture and a genuine differentiator, as long as we never
cross from "adjusting training" into "practicing medicine."*

---

## 5. Open questions, gaps & roadmap

**Near-term (highest leverage):**
1. **Per-session pain flag** (location + 0–10, "worse/same/better than last time"), wired
   into `sessionStrain`/`assessAdaptation` so pain can *ease* the plan and *trigger triage*.
   (Principle D; closes weakness #5.)
2. **Red-flag triage layer** — a small rules engine that recognizes bone-stress-injury
   signs, RED-S risk signals, and cardiac symptoms and routes to "see a professional."
   (Closes weakness #6; core liability item.)
3. **Medical disclaimer + PAR-Q screen at onboarding.** (Principle H; must-have before we
   lean on the injury pitch in marketing.)
4. **Nudge strength on by default / prominently.** (Principle E; closes weakness #7.)

**Medium-term:**
5. **Time-aware injuries** — add `startDate` + `stage`/`status` to `Injury`, and a recovery
   trajectory so severity decays and volume *ramps back* rather than sitting flat.
   (Principle B; closes weaknesses #1, #8.)
6. **Mechanism/tissue field** on `Injury` (or a "wants-load vs wants-offload" flag) so the
   engine can load a tendon and offload a bone. (Principle A; closes weakness #2.)
7. **Graded return-to-run generator** — a walk/run reintroduction protocol, volume-before-
   speed, gated by the 0–5 pain rule. Aqua-jog as an explicit prescribed modality.
8. **Ramp-guard on substituted sports** so offloading can't spike the receiving sport.
   (Principle F; closes weakness #4.)

**Longer-term / research:**
9. **Readiness + wearable integration** (HRV, sleep, resting HR) feeding the same
   protect-only auto-regulator — see [05-wearable-and-data-ecosystem.md](05-wearable-and-data-ecosystem.md).
10. **Monotony/strain (Foster) monitoring** as an internal-load overtraining guard, layered
    on top of the existing load curve — see [02-training-load-and-readiness.md](02-training-load-and-readiness.md).
11. **Cadence/form guidance** from synced run data (individualized nudges, not a fixed
    target).

**Open questions we can't answer from the evidence:**
- What ramp rate is "safe enough" per user given no valid ACWR threshold? (Probably: adapt
  to *observed* tolerance rather than a fixed rule.)
- How aggressively should we default strength for the time-crunched user who *won't* do it
  vs. adherence risk of over-prescribing?
- How do we surface red flags without crying wolf (false positives erode trust; false
  negatives are dangerous)?

---

## 6. Sources & further reading

**Triathlon / endurance injury epidemiology**
- Systematic review of long-distance triathlon musculoskeletal injuries — PMC8884864:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC8884864/
- Injury and illness in short-course triathletes: a systematic review (ScienceDirect):
  https://www.sciencedirect.com/science/article/pii/S2095254623000224
- Sports Injury Bulletin — incidence & prevalence of triathlon injuries:
  https://www.sportsinjurybulletin.com/improve/balancing-act-incidence-and-prevalence-of-triathlon-injuries

**Load–injury relationship & the ACWR critique**
- Impellizzeri et al., "Acute:Chronic Workload Ratio: Conceptual Issues and Fundamental
  Pitfalls" (Springer): https://link.springer.com/article/10.1007/s40279-020-01280-1
- "The acute-chronic workload ratio-injury figure and its 'sweet spot' are flawed" (Lolli
  et al.): https://www.researchgate.net/publication/333589357
- "Has the ACWR been debunked?" (overview):
  https://www.globalperformanceinsights.com/post/has-the-acute-chronic-workload-ratio-been-debunked

**Monotony / strain / session-RPE (Foster)**
- Foster et al., "A New Approach to Monitoring Exercise Training":
  https://paulogentil.com/pdf/A%20New%20Approach%20to%20Monitoring%20Exercise%20Training.pdf
- Session-RPE method — validity & usefulness (Frontiers):
  https://www.frontiersin.org/journals/neuroscience/articles/10.3389/fnins.2017.00612/full

**Progression / the 10% rule**
- "Is there evidence for an association between changes in training load and running-related
  injuries? A systematic review" — PMC6253751:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC6253751/
- Nielsen et al., excessive weekly-distance progression & injury (JOSPT):
  https://www.jospt.org/doi/10.2519/jospt.2014.5164

**Tendinopathy — continuum, loading, pain-monitoring**
- Cook & Purdam, revisiting the continuum model of tendon pathology (BJSM):
  https://www.fitasaphysio.com/uploads/4/3/3/4/43345381/br_j_sports_med-2016-cook-bjsports-2015-095422.pdf
- Silbernagel et al., continued sports activity using a pain-monitoring model in Achilles
  tendinopathy (RCT): https://journals.sagepub.com/doi/abs/10.1177/0363546506298279
- Achilles Tendinopathy Toolkit — exercise programs (Alfredson / HSR) (Physiopedia):
  https://www.physio-pedia.com/Achilles_Tendinopathy_Toolkit:_Section_D_-_Exercise_Programs
- Tendinopathy rehabilitation overview (Physiopedia):
  https://www.physio-pedia.com/Tendinopathy_Rehabilitation

**Bone stress injury**
- "Criteria and Guidelines for Returning to Running Following a Tibial Bone Stress Injury:
  A Scoping Review" (Sports Medicine) — PMC11393297:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC11393297/
- MRI grading of BSI & return to play (prospective, collegiate T&F):
  https://pubmed.ncbi.nlm.nih.gov/23825184/

**Strength as prevention**
- Lauersen et al., "Strength training as superior, dose-dependent and safe prevention of
  acute and overuse sports injuries" (BJSM meta-analysis):
  https://www.researchgate.net/publication/327150440
- "Do exercise-based prevention programs reduce injury in endurance runners?" — PMC11127851:
  https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11127851/

**Running biomechanics / cadence**
- "The Influence of Running Cadence on Biomechanics and Injury Prevention: A Systematic
  Review" — PMC12440572: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12440572/
- Heiderscheit et al., effects of cadence retraining on loading (context):
  https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7450991/

**Swimming & cycling injuries**
- "Biomechanical Considerations in the Competitive Swimmer's Shoulder" — PMC3438875:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC3438875/
- Swimmer's Shoulder — StatPearls (NCBI):
  https://www.ncbi.nlm.nih.gov/books/NBK470589/
- "Effects of Bike-Fitting on Lower Back Pain in Cyclists: A Systematic Review" —
  PMC12907770: https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12907770/

**Cross-training / aqua-jogging**
- Aqua jogging for injured runners — fitness maintenance evidence (RunnersConnect):
  https://runnersconnect.net/coach-corner/aqua-jogging-for-runners/

**RED-S / low energy availability**
- 2023 IOC consensus statement on Relative Energy Deficiency in Sport (REDs), Mountjoy et
  al. (BJSM, official PDF):
  https://stillmed.olympics.com/media/Documents/Athletes/Medical-Scientific/Consensus-Statements/REDs/BJSM-IOC-consensus-statement-on-Relative-Energy-Deficiency-in-Sport-REDs.pdf
- IOC announcement of the 2023 REDs consensus:
  https://www.olympics.com/ioc/news/ioc-publishes-new-consensus-statement-on-relative-energy-deficiency-in-sport-reds

**Liability / scope of practice**
- Health, fitness and medical disclaimers (FreePrivacyPolicy):
  https://www.freeprivacypolicy.com/blog/health-fitness-medical-disclaimers/
- New fitness client legalities 101 (FitLegally):
  https://www.fitlegally.com/blogs/news/new-fitness-client-legalities-101
- Legal landscape of health/weight-loss apps (Holt Law):
  https://djholtlaw.com/exploring-the-legal-landscape-of-weight-loss-apps-what-providers-should-consider/

---

## Related knowledge docs
- [01-exercise-physiology-and-periodization.md](01-exercise-physiology-and-periodization.md)
  — why tissues adapt on different clocks; the physiology the ramp must respect.
- [02-training-load-and-readiness.md](02-training-load-and-readiness.md) — session-RPE,
  monotony/strain, readiness scoring; the load side of the load↔injury coin.
- [04-planning-engine-algorithm-design.md](04-planning-engine-algorithm-design.md) — how
  `injuryMods`/`weekSportCounts`/`assignDays` fit the broader scheduler; where a
  time-aware, mechanism-aware injury model would slot in.
- [05-wearable-and-data-ecosystem.md](05-wearable-and-data-ecosystem.md) — HRV/sleep/
  resting-HR inputs that could feed the protect-only auto-regulator.
- [06-behavioral-science-and-retention.md](06-behavioral-science-and-retention.md) —
  anxiety-first micro-copy around injury/niggles; how to surface a red-flag referral
  without eroding trust.
- [07-product-and-ux-design.md](07-product-and-ux-design.md) — surfacing the pain flag,
  disclaimers, and "see a professional" triage in the UI.
- [08-software-platform-and-security.md](08-software-platform-and-security.md) — storing
  health data (injuries, PAR-Q, readiness) responsibly.
- Competitive context: [runna-competitive-analysis.md](../research/runna-competitive-analysis.md)
  — the injury/readiness gap this realm is our wedge against.
