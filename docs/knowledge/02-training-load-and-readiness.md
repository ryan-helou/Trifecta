# Training-Load Quantification & Readiness Modeling
> Canonical AmaTri knowledge doc · Realm 2 of 8 · Last researched: 2026-07-22

**Purpose:** This is the reference for the math that turns "a plan" into "a plan that adapts." It covers how you quantify what a workout costs (load models: TRIMP, TSS and its family, session-RPE, power/critical-power), how you track fitness and fatigue over time (the Performance Management Chart, ACWR — and the serious scientific fight over ACWR), and how you read whether an athlete is actually recovering (HRV, resting HR, sleep, subjective wellness) and convert that into a daily readiness score and a plan adjustment. It ends by grounding all of this in AmaTri's actual code — what `lib/stats.ts`, `lib/readiness.ts`, `lib/adapt.ts`, `lib/calibrate.ts`, and `lib/predict.ts` really do today, where they are sound, and where they are naive or missing. Read this before you build anything that measures load, computes readiness, or lets the plan react to how training is going.

---

## TL;DR — the things that actually matter

- **There is no such thing as one "true" training load.** Every model is a proxy. The honest question is: proxy for *what* — cardiovascular/metabolic strain (TRIMP, TSS, HR) or mechanical/musculoskeletal strain (distance, elevation, ground-contact)? These diverge, and the divergence is exactly where injuries hide. AmaTri currently models only the cardio/metabolic side (duration × zone weight).
- **The single most robust, cheapest, best-validated load metric is session-RPE (Foster): `sRPE = RPE(0–10) × duration_min`.** It correlates with HR-based TRIMP (r ≈ 0.75–0.90), needs zero hardware, works identically across swim/bike/run/strength, and is what actually solves the multisport-comparability problem. It is *underrated*; treat it as a first-class input, not a fallback.
- **The multisport crux:** to make swim + bike + run + strength comparable you need one intensity-weighted "cost per minute." Two credible routes: (a) **session-RPE** (subjective, universal, hardware-free) or (b) **a TRIMP/TSS-style zone weighting** anchored to threshold in each sport. AmaTri uses route (b) with hand-set zone weights `{Z1 0.6, Z2 1.0, Z3 1.6, Z4 2.2, Z5 3.0}` — a reasonable TRIMP-like curve, but the *weights are asserted, not calibrated*, and load is computed off *planned* zone, not *actual* effort.
- **The Performance Management Chart (Banister/Coggan) is the industry backbone:** `CTL` = ~42-day EWMA of daily load (≈ "fitness"), `ATL` = ~7-day EWMA (≈ "fatigue"), `TSB = CTL − ATL` (≈ "form/freshness"). It is a two-timescale filter on the *same* load signal. AmaTri computes a *weekly*, single-timescale EWMA (α = 0.35) it calls "fitness" — it has **no ATL, no TSB, no daily resolution**. This is the biggest single gap in the realm.
- **"CTL is fitness" is a known misnomer.** CTL is just smoothed load; it says nothing about whether that load produced adaptation. Garbage in (bad TSS from a wrong FTP/threshold) → confident garbage out. Never present a fitness curve as physiological truth.
- **ACWR (acute:chronic workload ratio) — use with extreme caution.** The famous "sweet spot 0.8–1.3, danger > 1.5" (Gabbett) has been substantially discredited: Lolli et al. showed the ratio is **mathematically coupled** (spurious self-correlation), and Impellizzeri et al. showed **randomised chronic loads predict injury as well as real ones** and called to *dismiss ACWR and its underlying theory*. Do not build injury prediction on ACWR. If you show a ratio at all, use the uncoupled EWMA variant and frame it as a *rate-of-change guardrail*, not a risk score.
- **Ramp rate is the safer, simpler cousin of ACWR:** week-over-week CTL rise. Practitioner rule of thumb: keep CTL ramp ≲ 5–8 TSS/week during build; larger jumps flag rising injury/illness risk. This is what AmaTri's deterministic weekly-load curve already enforces implicitly via periodization.
- **Subjective beats objective for monitoring.** Saw et al. (2016, *BJSM*) systematic review: self-reported wellness (sleep, soreness, mood, stress) tracks training response with *superior sensitivity and consistency* than objective markers, and the two often don't even correlate. AmaTri's 3-item morning check-in (sleep · legs · energy) is directly on the evidence — this is a genuine strength, not a shortcut.
- **HRV is powerful but treacherous.** Use **ln(rMSSD)** (log-transform tames the skew), measured *every morning, same posture, before caffeine*. What matters is not today's number but today vs. **your rolling 7-day baseline** and the **coefficient of variation (CV)**. A suppressed baseline *or* a spiking CV = the body isn't coping. Single-day HRV is noise; baselines and trends are signal (Altini / HRV4Training).
- **HRV-guided training beats fixed periodization in RCTs** (Vesterinen, Javaloyes, Nuuttila): athletes whose hard days are gated by morning HRV improve VO₂max/performance *at least as much with fewer hard sessions*. The mechanism is simply "do the quality work only when recovered." AmaTri's readiness-gating of hard sessions is the same idea, done with subjective inputs instead of HRV.
- **Most users will never have complete data.** No power on the bike, no HRV daily, no swim CSS test. The entire realm must **degrade gracefully**: power → HR → pace → RPE → duration×zone. Design every metric with a defined fallback ladder. This is a product requirement, not an edge case.
- **Overreaching is a feature, not only a bug.** Functional overreaching (FOR: short dip → supercompensation) is how fitness is built; non-functional overreaching (NFOR: weeks-to-months) and overtraining syndrome (OTS: months) are the failures. A monitoring system must distinguish *intended* fatigue (planned build, low TSB) from *maladaptive* fatigue (suppressed HRV + rising sRPE for equal work + poor wellness). AmaTri detects the latter only crudely (miss-rate + felt-hard strain over 2 weeks).
- **Prediction is a hook, not a promise.** Riegel (`T2 = T1·(D2/D1)^1.06`), critical power/speed, and VO₂-based models each have real error bars. AmaTri uses Riegel for paces and a heuristic level-gain model for the "what the plan buys you" projection. Fine for motivation; do not present as a guaranteed finish time.
- **Feed the model what actually happened, not what you planned.** AmaTri computes load from `primaryZone` and estimated duration of the *planned* session. The moment a device sync (Strava `actuals`) or a post-session check-in (RPE/feel/actual duration) exists, load should be recomputed from *that*. Today calibration uses actuals but the load/fitness curve does not — a fixable inconsistency.

---

## 1. Core knowledge

### 1.0 The framing: internal vs. external, metabolic vs. mechanical

Two orthogonal distinctions organize the whole field.

- **External load** = what the athlete *did*: distance, duration, elevation, watts, reps × kg. Objective, device-measured, athlete-independent.
- **Internal load** = the *biological cost* of doing it: HR response, lactate, RPE, HRV suppression. Athlete-specific — the same 10 km costs a beginner far more than an elite.

Adaptation is driven by **internal** load; injury (especially bone/tendon) is driven substantially by **external/mechanical** load. A system that models only one is blind to half the risk. Second axis:

- **Metabolic/cardiovascular strain** — captured by HR, RPE, TSS, TRIMP.
- **Mechanical/musculoskeletal strain** — captured by distance, ground-contact, impact, tonnage.

An easy 2-hour run and a hard 40-minute bike session can carry *identical* TRIMP yet wildly different mechanical cost. **This gap is where most overuse injury lives**, and it is the single most important conceptual point connecting this realm to Realm 3 (injury & load management).

### 1.1 TRIMP — Training Impulse (Banister, 1975/1991)

The original attempt to reduce a session to one number: **duration × intensity × a weighting factor**.

**Banister's TRIMP (HR-reserve weighted):**

```
TRIMP = D × ΔHR_ratio × Y
  D          = duration in minutes
  ΔHR_ratio  = (HR_ex − HR_rest) / (HR_max − HR_rest)   [fraction of HR reserve, Karvonen]
  Y          = weighting factor, gender-specific:
                 men:   Y = 0.64 · e^(1.92 · ΔHR_ratio)
                 women: Y = 0.86 · e^(1.67 · ΔHR_ratio)
```

The exponential term `e^(1.92x)` is a stand-in for the blood-lactate curve — it up-weights high intensity so a hard hour scores far more than an easy hour. The two constants (0.64/1.92 men, 0.86/1.67 women) are fitted to typical lactate-vs-%HRR responses. The **catch:** using a *session-average* HR flattens intervals — 4×4 min at VO₂max with recoveries and a steady tempo can land on the same average HR and thus the same Banister TRIMP, badly under-counting the intervals.

**Variants (fix the averaging problem by binning intensity):**

- **Edwards' TRIMP (1993):** split the session into 5 HR zones (50–60, 60–70, 70–80, 80–90, 90–100 % HRmax); multiply minutes-in-zone by 1, 2, 3, 4, 5 respectively; sum. Simple, popular, hardware-light. **AmaTri's `ZONE_WEIGHT` is a direct cousin of Edwards' TRIMP** (see §3).
- **Lucia's TRIMP (2003):** 3 zones set by *ventilatory thresholds* (below VT1 = 1, VT1–VT2 = 2, above VT2 = 3). More physiological but needs a lab test to place the thresholds.
- **Stagno / team-sport TRIMP:** re-fits the zone multipliers to a lactate curve for intermittent sports.
- **iTRIMP (individualized):** derives the exponential weighting from *that athlete's own* lactate–HR profile rather than a population constant. Most accurate, least practical.

TRIMP's enduring value: **it only needs HR and time**, both nearly universal. Its weakness: HR lags, is blunted by heat/fatigue/dehydration/cardiac drift, is useless for strength/sprint/very-short work, and average-HR variants under-count intervals.

### 1.2 The TSS family (Coggan, *Training and Racing with a Power Meter*)

Coggan's system anchors everything to **Functional Threshold Power (FTP)** — the ~1-hour max sustainable power — and expresses a session as a percentage of "one hour at threshold."

**Normalized Power (NP):** a physiologically weighted average that punishes variability.
1. 30-second rolling average of power.
2. Raise each value to the **4th power**.
3. Average those.
4. Take the **4th root**.

The 4th-power weighting reflects that metabolic cost (lactate, glycogen) rises roughly with the 4th power of intensity — so surges cost far more than their arithmetic-mean power suggests. NP ≈ the steady power that would have cost the same.

**Intensity Factor (IF):** `IF = NP / FTP`. 1.0 = riding right at threshold; a 70.3 bike leg is ~0.75–0.85, an Ironman ~0.65–0.75.

**Training Stress Score (TSS):**

```
TSS = (duration_sec × NP × IF) / (FTP × 3600) × 100
    = IF² × duration_hours × 100
```

**One hour at FTP = 100 TSS by definition.** This is the reference unit the whole PMC is denominated in. TSS elegantly combines intensity (squared, so it dominates) and duration (linear).

**Non-power extensions (the multisport bridge — all normalize to a per-sport threshold):**

- **rTSS (running):** uses **Normalized Graded Pace (NGP)** — pace adjusted for gradient — against threshold run pace. `IF = NGP / threshold_pace`.
- **hrTSS (heart-rate):** time-in-HR-zone weighted by each zone's IF; the universal fallback when there's no power/pace. Accurate to ~10–15 % of power-TSS for trained athletes, worse on short/high-intensity efforts.
- **sTSS (swimming):** swim pace vs. threshold swim pace (CSS — Critical Swim Speed).
- **TrainingPeaks' unified "hrTSS/tTSS"** lets HR stand in across all sports so one PMC spans the triathlete's whole week.

**The key insight for AmaTri:** TSS's whole trick is *normalizing intensity to a per-sport threshold* (FTP, threshold pace, CSS). AmaTri *already derives* those anchors in `lib/paces.ts` (threshold pace, CSS, FTP, %HRmax zones). So a proper per-sport TSS-style number is *within reach* — the ingredients exist; they're just not assembled into a load metric yet.

### 1.3 Session-RPE (Foster, 2001) — the underrated one

```
sRPE_load = RPE(CR-10 scale, 0–10) × session_duration_min      [arbitrary units, AU]
```

Collected ~30 min post-session (so it reflects the *whole* session, not the last hard bit). That's it. Why it punches far above its simplicity:

- **Validated against HR-TRIMP across cycling, running, swimming, team sports** (r ≈ 0.75–0.90); a full *Frontiers in Neuroscience* (2017) review confirms validity, reliability, internal consistency.
- **Sport-agnostic and hardware-free** — the *only* metric that natively compares a swim, a bike, a run, a lift, and a yoga session on one axis. This is the cleanest solution to the multisport-comparability problem.
- **Captures internal load holistically** — heat, altitude, life stress, sleep debt all show up in RPE when they'd be invisible to pace/power.

Derived microcycle metrics (Foster):
- **Monotony** = mean(daily load) / SD(daily load) over the week. High monotony (every day the same) + high load → overtraining risk.
- **Strain** = weekly load × monotony. Foster's original overtraining-warning composite.

Weaknesses: needs athlete honesty/education; can be gamed or biased by mood; a single scalar hides the interval structure. But for a time-crunched age-grouper with no power meter, **sRPE is the highest signal-per-effort metric that exists.** AmaTri collects RPE and "feel" in the post-session check-in (`logCheckin`, `Workout.rpe/feel`) but **does not yet compute sRPE load from them** — a low-effort, high-value gap.

### 1.4 Power/critical-intensity models (the frontier of "objective")

- **Critical Power / Critical Speed (2-parameter hyperbolic, Monod & Scherrer; Hill):** power–duration follows `t = W' / (P − CP)`. **CP** = the asymptote, the highest *sustainable* (steady-state) intensity — boundary of the heavy/severe domains. **W'** ("W-prime") = a finite work capacity (joules) usable *above* CP, like a battery. Running analogue: **Critical Speed (CS)** + **D'** (distance above CS). Estimable from 2–3 max efforts (e.g. 3, 9, 12 min) — no lab.
- **W'BAL (Skiba, 2012):** models W' depletion and *reconstitution* in real time; W' recharges exponentially below CP with a time constant τ ≈ 300–600 s. Powers "how much matchbook is left" during interval sessions.
- **GOVSS (Gravity Ordered Velocity Stress Score, Skiba):** a running-specific stress score built from *modelled metabolic power* (accounting for pace, grade, body mass, efficiency) — the running-power answer to cycling TSS. **Stryd** commercializes running power and its own stress/CP model.
- **Why it matters for AmaTri:** CP/CS gives a *test-derivable, threshold-anchored* intensity model that's more principled than %HRmax or level-defaults — a natural future upgrade to `lib/paces.ts`. But it demands maximal testing most age-groupers won't do, so it stays an *optional enrichment*, never a requirement.

### 1.5 The Performance Management Chart (PMC)

The industry-standard dashboard, from Banister's impulse-response model, popularized by Coggan/TrainingPeaks. Three curves off the **same daily-load series**:

```
CTL_today = CTL_yesterday + (Load_today − CTL_yesterday) × (1 / τ_CTL)     τ_CTL ≈ 42 days
ATL_today = ATL_yesterday + (Load_today − ATL_yesterday) × (1 / τ_ATL)     τ_ATL ≈ 7 days
TSB_today = CTL_yesterday − ATL_yesterday
```

(A more exact EWMA uses `α = 1 − e^(−1/τ)` instead of `1/τ`; both are used in the wild. Intervals.icu and TrainingPeaks both default to 42/7.)

- **CTL — "Fitness":** long EWMA. Rises slowly with sustained load, decays slowly with rest. Reflects accumulated training. A trained age-grouper sits ~50–80; a pro peaks 120–150 (in cycling-TSS terms).
- **ATL — "Fatigue":** short EWMA. Spikes fast, clears in days.
- **TSB — "Form/Freshness" = CTL − ATL:** the money metric.
  - **TSB roughly −10 to −30:** productive training (fatigued but building). You *want* to live here in a build block.
  - **TSB ≈ −10 to +5:** balanced.
  - **TSB ≈ +5 to +25:** fresh/tapered — **race here.** (TrainingPeaks' oft-cited race window: +5 to +15/+20.)
  - **TSB > +25 for long:** detraining / lost fitness.
- **Ramp rate:** ΔCTL per week. The build-safety governor — keep it modest (practitioner heuristic ~3–8 TSS/wk; aggressive > 8–10) to avoid the fatigue and injury of ramping too hard.

**Pitfalls, stated plainly:**
1. **"Fitness" is a misnomer** — CTL is *smoothed load*, not measured fitness. Two athletes with CTL 70 can have very different VO₂max/threshold. It ignores whether load produced adaptation.
2. **Garbage in, garbage out** — every number is only as good as the FTP/threshold/HRmax it's normalized to. A stale FTP inflates or deflates the whole chart.
3. **Time constants are conventions, not laws.** 42/7 fit cycling data; they're not sacred and individuals differ (some coaches run 42/7 → longer for ultra athletes).
4. **Cross-sport TSS is only comparable if each sport's threshold is right** — the hardest part for a triathlete, especially swim CSS.
5. **The PMC is descriptive, not predictive** — it tells you where you've been, not what tomorrow's session should be. That's the job of the plan + readiness layer.

### 1.6 ACWR — and the reckoning

**The claim (Gabbett, Hulin, ~2014–2016):** compute the ratio of **acute load (~7-day)** to **chronic load (~28-day)**. A "sweet spot" of **0.8–1.3** minimizes injury; **> 1.5** ("danger zone") is where spikes hurt you. Two flavors:
- **Rolling-average (RA) coupled:** acute = mean last 7 d; chronic = mean last 28 d (which *includes* the last 7). `ACWR = acute / chronic`.
- **EWMA (Williams et al., 2017):** exponentially-weighted versions, more sensitive to recent load, and *uncoupled* (chronic excludes the acute window).

It swept sports science and every wearable (WHOOP, Garmin, Polar). **Then the critique landed, and it is damning:**

- **Mathematical coupling (Lolli et al., 2019, *J Sports Sci*):** because the acute window is *inside* the chronic window (RA version), the numerator and denominator share data → the ratio **correlates with itself by construction**. Simulations with *random* numbers reproduce the "injury-risk" pattern. The relationship is a statistical artifact.
- **Conceptual/causal failure (Impellizzeri et al., 2020–2021, *Sports Med* / *IJSPP*):** ACWR lacks a coherent causal model; it conditions on the chronic load in a way that biases the estimate. Their 2021 study titled *"…Time to Dismiss ACWR and Its Underlying Theory"* showed **randomised (fake) chronic loads predicted injury as well as real ones** — i.e., the "chronic protects you" story doesn't hold up.
- **Inconsistent meta-analytic evidence**, sensitivity to arbitrary choices (7:28 vs 7:21, coupled vs uncoupled, RA vs EWMA), and regression-to-the-mean confounds.

**The honest position for a builder:**
- **Do not build injury *prediction* on ACWR.** The literature does not support it as a risk classifier.
- **A rate-of-change guardrail is still reasonable** — "don't spike acute load far above your recent norm" is common-sense progressive overload, and the *uncoupled EWMA* form is the least-broken way to express it. Frame it as a **coaching heuristic**, not a probability.
- **Prefer ramp-rate on CTL** (§1.5) and **individualized deviation from the athlete's own trend** over a universal magic ratio.
- **AmaTri's stance should be:** we bake progressive-overload safety into the *deterministic plan* (bounded weekly ramp, deload cycles) rather than reacting to a discredited ratio after the fact. That is a defensible, differentiated position — say so.

### 1.7 Readiness & recovery monitoring

The daily question: *is the athlete absorbing training, or drowning in it?* Signals, best→most-practical:

**HRV (heart-rate variability):**
- **Metric:** **rMSSD** (root-mean-square of successive R-R interval differences) is the field standard — it indexes *parasympathetic (vagal, recovery)* tone and is robust to short recordings (~1 min). Skewed, so use **ln(rMSSD)** (HRV4Training scales it as `ln(rMSSD) × 20` for a friendlier 0–100-ish number).
- **Protocol is everything:** same time each **morning**, same posture (seated or supine — pick one), *before* caffeine/food, spontaneous breathing. Altini's data: morning is more actionable than night; orthostatic (lying→standing) tests add sensitivity but hurt compliance.
- **Interpret against a baseline, never in isolation:** the signal is **today vs. your 7-day rolling baseline**, and whether you're inside your **normal range** (baseline ± ~0.5 × between-day SD = the *smallest worthwhile change*). One low day is noise; a *baseline that drops and stays down*, or a **coefficient of variation (CV) that spikes**, means the body isn't coping. Altini's key finding: athletes who keep a **stable baseline with low CV** through a hard block adapt best.
- **Direction is nuanced:** normal training suppresses HRV acutely then rebounds (FOR). *Chronically* suppressed HRV = accumulating fatigue. Paradoxically, in deep non-functional overreaching HRV can appear *artificially high/"parasympathetic saturation"* — another reason to read trend + context, not a single reading.

**Resting HR (RHR):** cheap, ubiquitous, lower-resolution than HRV. A **morning RHR elevated ~5–7 bpm above baseline** flags fatigue, illness, dehydration, or under-recovery. Best as a *confirming* signal alongside HRV/subjective. (AmaTri's `ReadinessInput.restingHr` exists but is currently **unused** — see §3.)

**Sleep:** duration *and* quality/regularity. The strongest single physiological lever on recovery and injury risk; chronic short sleep degrades everything downstream. Subjective sleep rating is well-validated and is one of AmaTri's three readiness dimensions.

**Subjective wellness questionnaires:** the **Hooper index** (sleep, fatigue, stress, muscle soreness — each ~1–7) is the classic. **Saw et al. (2016, *BJSM*)** systematic review is the headline result: **subjective self-report tracks training load with *superior* sensitivity and consistency vs. objective markers**, and the two frequently don't correlate. Wellness worsens with acute load spikes and chronic load; improves with taper. **The practical punchline: a 4-item morning questionnaire can out-monitor a $300 wearable.** This is the evidentiary backbone under AmaTri's check-in.

**Turning signals into an actionable score + adjustment (the recipe):**
1. Establish a **rolling baseline** per signal (e.g. 7-day mean + SD).
2. Express today as **z-score / deviation from baseline** (not absolute value) so it's individualized.
3. Combine into a **composite readiness** (weighted; subjective inputs deserve real weight given Saw). Keep it interpretable — an athlete should know *why* today is red.
4. **Gate intensity, not just volume:** low readiness → convert quality (VO₂/threshold) to aerobic/easy, or cut duration; *don't* just delete the session (that costs consistency). High readiness → *green-light* the planned hard work; **do not add load beyond plan** (that's how people get hurt — see AmaTri's explicit "ahead → encouragement only" rule).
5. **Hysteresis / debounce:** one bad night shouldn't rewrite the block; require a trend or a hard threshold before large changes.

**Why HRV-*guided* training works (the RCT evidence):** Vesterinen (2016), Javaloyes (2019, cyclists), Nuuttila (2017, runners) and the Granero-Gallegos meta-analysis all show that prescribing hard sessions **only when morning HRV is within normal** matches or *beats* fixed periodization for VO₂max and performance — often with **fewer moderate/hard sessions**. The mechanism is simply "do quality work when you can absorb it." **AmaTri's readiness gate is the same idea implemented with subjective inputs** — cheaper, more compliant, evidence-aligned per Saw.

### 1.8 Prediction: race time, plateau, overreaching

- **Riegel endurance model:** `T2 = T1 × (D2/D1)^1.06`. The 1.06 "fatigue factor" captures that pace decays with distance. Accurate over ~2–4× distance extrapolation for trained runners; degrades at the marathon end (fueling/durability dominate). **AmaTri uses Riegel** in `lib/paces.ts` (`riegel()`, default exp 1.06) to turn a run PR into threshold pace.
- **VO₂-based (Daniels VDOT, ACSM equations):** map a race result → VO₂max/velocity-at-VO₂max → predicted times and training paces. Robust, widely used for run.
- **Critical Power/Speed:** the 2-parameter model *is* a predictor — finish time = `W'/(P−CP)`-style for the severe domain. Strong for TT-style efforts.
- **Stryd / running-power models:** proprietary CP + durability models on run power.
- **Performance/plateau/overreaching detection:**
  - **Plateau:** flat performance despite maintained load — reassess stimulus (more intensity, more recovery, or a new limiter).
  - **Functional overreaching (FOR):** short (days–~2 wk) performance dip → **supercompensation** above baseline. *Intended.* Signature: planned load spike, transient fatigue/wellness dip that rebounds on taper.
  - **Non-functional overreaching (NFOR):** weeks–months to recover, no supercompensation. Maladaptive.
  - **Overtraining syndrome (OTS):** months–years; a diagnosis of exclusion (Meeusen et al., 2013 ECSS/ACSM consensus).
  - **Distinguishing intended vs. maladaptive fatigue** is the whole art: low TSB *with* stable HRV/wellness and expected paces = productive; low TSB *with* suppressed HRV, rising sRPE for the *same* work, poor wellness, elevated RHR = warning. **"More RPE for the same external load" is one of the earliest, cheapest overreaching signals** and AmaTri already has the raw materials (planned zone vs. logged RPE) to detect it.

### 1.9 Missing-data reality (a first-class design constraint)

Real age-groupers arrive with: no bike power, no swim CSS test, HRV maybe 2 days/week, RPE only when they remember. A robust system **degrades down a fallback ladder** and stays useful at every rung:

```
Intensity/load source, best → always-available:
  power (bike) / running-power ── pace (run/swim) ── HR ── RPE ── duration × planned-zone
Readiness source, best → always-available:
  HRV (baseline-relative) ── RHR ── sleep ── subjective wellness (sleep·legs·energy)
```

Principles: **never block a feature on a signal most users lack**; **weight by availability/confidence** (a device-measured actual should outrank a plan estimate); **make the subjective path a peer, not a consolation prize** (Saw says it's often better anyway). AmaTri's architecture is *already* built on the always-available rungs (duration×zone load, subjective readiness) — the opportunity is to *layer richer signals on top when present*, not to rebuild on signals users don't have.

---

## 2. State of the art — what the best in the world do

- **TrainingPeaks / WKO5:** the reference implementation of the PMC (CTL/ATL/TSB, TSS family). WKO5 adds modeled FTP/CP, "Pmax," fatigue-resistance and durability curves, per-athlete time constants, and Banister-style modeled performance. This is the gold standard for *serious* endurance athletes and coaches — and it's *complex*, which is exactly the opening for a simpler multisport product.
- **Intervals.icu:** free, beloved by data nerds; PMC with selectable load models (**power / HR / pace / RPE**), 42/7 EWMA defaults, per-sport Fitness, HRV & wellness logging, and honest documentation ("hrTSS is approximate, within 10–15 %"). A great north star for *transparent, multi-source* load with graceful fallback.
- **WHOOP:** recovery-first. Nightly HRV (during sleep) + RHR + sleep + respiratory rate → a **0–100 % Recovery** score, plus a **Strain (0–21, Borg-scaled)** cardiovascular load and a "Strain Coach." Slick, but a **black box**, HRV-during-sleep (not morning-standardized), and criticized for over-reliance on wearable HRV that Saw's review says subjective can match.
- **Garmin / Firstbeat:** Training Load (EPOC-based), Training Status, Load Focus (aerobic/anaerobic balance), Training Readiness (HRV + sleep + recovery time + load), Body Battery, Race Predictor, Acute:Chronic load. Firstbeat's EPOC model is a genuinely different (and clever) internal-load estimate. Also largely black-box.
- **Oura / Ultrahuman / Whoop-likes:** nightly HRV + temperature + sleep readiness; strong on recovery, weak on *sport* load — the mirror image of TrainingPeaks.
- **HRV4Training / Marco Altini:** the research-honest voice in consumer HRV — camera-based morning rMSSD, baseline ± normal range, CV emphasis, "don't over-react to one day." The methodology to emulate if AmaTri adds HRV.
- **Athletes/coaches in practice:** elite endurance programs run a *dashboard*, not a single number: sRPE load + monotony/strain, morning HRV trend, wellness questionnaire, body mass, and lab thresholds — triangulated by a human coach. The frontier research direction is **multivariate, individualized models** (distributed-lag / state-space / Bayesian impulse-response, e.g. the Kalman-filtered fitness-fatigue and "distributed lag wellness" work) that fuse subjective + objective signals per-athlete rather than one universal formula. **AmaTri's deterministic-engine + cheap-signal philosophy can lead here precisely by being individualized and transparent where the incumbents are generic and opaque.**

---

## 3. How this maps to AmaTri

### What our code already does (cite file:line)

**Load quantification — `lib/stats.ts`:**
- `ZONE_WEIGHT = {1: 0.6, 2: 1, 3: 1.6, 4: 2.2, 5: 3}` (`lib/stats.ts:16`) — an **Edwards-TRIMP-style intensity multiplier** by zone.
- `workoutLoad(w)` (`lib/stats.ts:19–22`): `= (creditedSeconds/60) × ZONE_WEIGHT[primaryZone]` — **duration-in-minutes × zone weight = "weighted minutes."** This *is* AmaTri's single cross-sport load number, and it's a legitimate TRIMP-family choice: sport-agnostic, hardware-free, one axis for swim/bike/run/strength. Zero for sessions that aren't done/swapped.
- `trainingStats()` (`lib/stats.ts:88–124`): `weekLoad[]` = sum of workoutLoad per plan week; **`fitness[]`** = an EWMA over *weeks*: `f = f + (l − f) × 0.35` (`lib/stats.ts:96–99`) — a single-timescale smoothed load curve labeled "fitness." Also `doneHrsByWeek`, banked seconds/count, longest session, biggest week.
- `computeStreak()` / `dayState()` (`lib/stats.ts:29–75`): consistency tracking (rest days count as kept; today stays "pending"). Consistency *is* a load-adjacent behavioral metric and it's handled thoughtfully.

**Readiness — `lib/readiness.ts` + `lib/types.ts`:**
- `readinessScore(input)` (`lib/readiness.ts:14–17`): `= ((sleep + legs + energy − 3) / 6) × 100` — three subjective 1–3 dimensions, **equal-weighted**, mapped 3→0, 9→100. This is a compact **Hooper-style subjective wellness index**, squarely on the Saw et al. evidence.
- `READY_LOW = 45` (`lib/readiness.ts:11`), `readinessBand()` (`:20–24`): low `< 45`, high `≥ 75`, ok between.
- `logReadiness()` (`:28–38`): records the entry and, **if `score < 45`, calls `easeUpcoming(plan, date, 0)`** — softens *today's* hard sessions and marks the day `eased`. This is the readiness → plan-adjustment loop, and it correctly **gates intensity for the day** rather than deleting the session.
- `ReadinessInput` (`lib/types.ts:112–118`): `sleep|legs|energy: 1|2|3`, plus an **optional `restingHr` that is captured but never used** in scoring.

**Adaptation — `lib/adapt.ts`:**
- `easeUpcoming()` (`:249–276`): downgrades `threshold|vo2|tempo|brick` sessions to an easy endurance draft at ~80 % duration. The core protective move.
- `sessionStrain(w)` (`:292–298`): `(rpe − zoneRpeMid(primaryZone))` averaged with `FEEL_STRAIN {rough:+2, ok:0, great:−1.5}` — **"how much harder did it feel than prescribed."** This is effectively an **RPE-vs-expected-zone residual — a real overreaching signal** (§1.8).
- `assessAdaptation()` (`:314–357`): over the **trailing 14 days**, computes miss-rate and average strain; **EASE** the next week if `missRate ≥ 0.4` OR (`≥3 signals` and `avgStrain ≥ 1.5`); **AHEAD** (encourage, no load added) if `missRate ≤ 0.1` and `avgStrain ≤ −1.0`. Never touches race week.
- `applyAdaptation()` (`:361–372`): eases the target week and multiplies `targetHours × 0.9`; records `easedWeeks` so it won't re-nag. **The "ahead" branch deliberately adds no load** (`:344–355`, and the header comment at `:278–286`) — this is the correct, injury-aware choice and a genuine differentiator vs. apps that pile on.

**Calibration — `lib/calibrate.ts`:** the most sophisticated closed loop in the codebase.
- `strainDelta(w, maxHR)` (`:34–45`): blends **RPE residual + feel + (HR-vs-zone)** into one RPE-equivalent number; uses `actuals.avgHr` when `maxHR` known (`~4 % HRmax ≈ 1 RPE`, `:41`). This is a **legitimate internal-load-vs-prescription comparison across subjective + objective signals.**
- `calibratePaces()` (`:69–119`): over `WINDOW_DAYS = 28`, per discipline with `≥ MIN_SIGNALS = 3`, if `|avgStrain| ≥ DEADBAND (1.0 RPE)` nudge the pace anchor by `clamp(−avg × 0.02, ±MAX_STEP 0.04)` — "ran hot → ease targets; comfortable → sharpen." Bounded by `CAL_MAX ±0.15` in `lib/paces.ts:33`. Weekly cadence (`calibrationDue`, `:122–126`). Flows through `derivePaces()` so one number moves generation, rebuild, and display.

**Prediction — `lib/predict.ts` + `lib/paces.ts` + `lib/planEngine.ts`:**
- `projectRace()` (`lib/predict.ts:62–83`): current vs. post-plan finish. Gain = `LEVEL_GAIN {beginner 0.10, intermediate 0.06, advanced 0.04, elite 0.025}` × `min(weeksToRace, 16)/16` (`:18–23, 73`); `sharpen()` scales paces/FTP by that fraction. A **motivational heuristic**, not a physiological model — and honestly commented as such.
- `riegel()` (`lib/paces.ts:11–13`, exp 1.06) → threshold pace; `estimateRaceSeconds()` (`lib/planEngine.ts:84–110`) uses **`v ∝ FTP^(1/3)`** aero scaling for the bike (`:99–101`) and zone-by-distance run pacing — a tidy, defensible race-time estimate.

### Where we're strong

1. **The philosophy is right and evidence-backed.** A subjective morning check-in that gates *today's* intensity is exactly what Saw (2016) and the HRV-guided-training RCTs endorse — and it's cheaper and more compliant than wearables. AmaTri does the *high-signal, low-hardware* thing on purpose.
2. **A single cross-sport load number exists and is sensibly shaped.** `duration × zone-weight` is a real TRIMP-family metric; the weights `{0.6,1,1.6,2.2,3}` form a plausible lactate-like curve. Swim/bike/run/strength are already comparable.
3. **Injury-aware by construction.** "Ease, don't cram," "ahead → encouragement, never extra load," bounded calibration steps (`±4 %/week`, `±15 %` cap), never touching race week — these encode the *right* asymmetry (protect > push). This is the moat, in code.
4. **A working closed loop.** `calibratePaces` genuinely fuses subjective (RPE/feel) + objective (HR) internal-load signals vs. prescription and adjusts targets with deadbands, caps, and minimum-sample gates — sober engineering, no over-reaction.
5. **Honest self-labeling.** Comments call "fitness" a proxy and the race projection "evidence-shaped estimate," not truth. Good epistemics.

### Where we're weak / naive / missing

1. **No true PMC — no ATL, no TSB, no daily resolution.** `trainingStats.fitness` is a *weekly* single-EWMA (α = 0.35 ≈ a ~5-week time constant) and there is **no fatigue (ATL) or form (TSB) curve at all.** We therefore can't answer "am I fresh enough to race?" or "is fatigue outrunning fitness?" — the two questions the PMC exists to answer. **Highest-value gap in this realm.** (Note: TSB needs *daily* load, so this depends on #2.)
2. **Load is computed from the *plan*, not from *reality*.** `workoutLoad` uses `primaryZone` (the *prescribed* dominant zone) and estimated/credited duration — it ignores logged **RPE**, **feel**, and device **`actuals`** (avgHr/avgWatts) that we already store. A hard-feeling threshold session and an easy one score identically. **We collect the actuals (`Workout.rpe/feel/actuals`) and use them for *calibration* but not for the *load/fitness* curve** — an inconsistency worth closing.
3. **Session-RPE load is left on the table.** We have `rpe` and duration per session (`logCheckin`) but never compute Foster's `RPE × duration` — the single best-validated, most multisport-honest load metric, and nearly free to add.
4. **Readiness ignores signals it already collects and known best-practice.** `restingHr` is captured (`ReadinessInput.restingHr`) but unused; there's **no baseline/rolling-CV logic** anywhere (readiness is an absolute 3→0/9→100 map, not a deviation-from-*your*-normal). Best practice (Altini) is emphatic that *baseline-relative* beats *absolute*. No HRV path exists yet.
5. **Readiness → adjustment is coarse and one-directional.** `logReadiness` only reacts to `score < 45` and only for *today*; a *high* readiness day does nothing (no green-light to hit the key session harder/with confidence), and there's no multi-day trend (two bad mornings in a row = same as one).
6. **`assessAdaptation` mixes compliance with physiology.** `missRate ≥ 0.4` (a *behavioral/life* signal) and `avgStrain ≥ 1.5` (a *physiological* signal) both trigger "ease," but they mean different things — missing sessions because life is busy is not the same as sessions feeling too hard, and arguably warrant different responses (reschedule vs. reduce intensity).
7. **No monotony/strain, no ramp-rate guardrail as an explicit metric.** Progressive-overload safety is *implicit* in the deterministic weekly curve (good), but there's no surfaced "you're ramping too fast" signal and no Foster monotony/strain despite having daily load available.
8. **No overreaching/NFOR detector beyond the 2-week ease trigger.** We have the ingredients for the cheapest early-warning signal — *rising RPE for the same prescribed zone over time* (a trend on `sessionStrain`) — but only use a static threshold over 14 days, not a trend.
9. **Zone weights and calibration constants are asserted, not validated.** `{0.6,1,1.6,2.2,3}`, `α = 0.35`, `4 % HRmax ≈ 1 RPE`, `−avg × 0.02`, deadband 1.0 — all reasonable, all unvalidated against any dataset. Fine for v1; flag as "tune when we have data."

---

## 4. Principles & decision rules — READ THIS BEFORE BUILDING IN THIS REALM

1. **Compute load from what happened, then fall back.** Resolve each session's load down the ladder: `device actuals (power/HR) → logged RPE×duration → planned zone × est. duration`. A logged actual must always outrank a plan estimate. (Today `workoutLoad` skips straight to the last rung — fix that first.)
2. **Adopt Foster session-RPE as the canonical internal-load unit.** `sRPE = RPE(0–10) × duration_min`. It's the cheapest, most-validated, most multisport-honest number we can compute, and we already collect both inputs. Make it the backbone; keep zone-weighted minutes as the fallback when no RPE exists.
3. **Build a proper daily PMC before adding fancier signals.** Daily load → `CTL (τ≈42d)`, `ATL (τ≈7d)`, `TSB = CTL−ATL`, all EWMA. This unlocks freshness/taper guidance, ramp-rate safety, and the "am I ready to race?" answer — more value than any single new sensor.
4. **Never present CTL/fitness as measured fitness.** Label it "training load trend / fitness proxy." State that it's only as good as the thresholds it's normalized to. Epistemic honesty is part of the brand.
5. **Do NOT build injury prediction on ACWR.** It's mathematically coupled and causally unsupported (Lolli; Impellizzeri). If you must show a ratio, use the **uncoupled EWMA** form and frame it as a *don't-spike-your-load* heuristic, not a risk score. Prefer **CTL ramp-rate** and **deviation-from-your-own-trend**.
6. **Readiness must be baseline-relative, not absolute.** Score each signal as deviation from the athlete's *own* rolling baseline (± smallest-worthwhile-change). "Low for you" beats "low on a fixed scale." Retrofit the 3-item score toward this as history accumulates.
7. **Weight subjective signals heavily — the evidence says they win.** Per Saw (2016), sleep/soreness/mood/stress out-monitor most wearable metrics. Never treat the check-in as a poor cousin to a future HRV feature.
8. **Gate intensity, don't delete sessions.** Low readiness → downgrade quality to aerobic and/or trim duration (as `easeUpcoming` does). Deleting sessions wrecks the consistency that is the actual driver of age-grouper results.
9. **On a *high* readiness / "ahead" day, encourage — never auto-add load.** Keep AmaTri's existing rule (`adapt.ts` "ahead" branch). Extra unplanned load is how people get hurt; the deterministic plan already progresses.
10. **Debounce every adaptation.** Require a trend or a hard threshold before large changes (one bad night ≠ rewrite the block). AmaTri's `easedWeeks` + minimum-sample gates are the right pattern — extend them to readiness (e.g. two low mornings, or a baseline drop, before touching more than today).
11. **Separate "missed because life" from "felt too hard."** Compliance drops → offer *reschedule/rebuild*; physiological strain → *reduce intensity*. Don't collapse both into one "ease" as `assessAdaptation` currently does.
12. **HRV, if/when added, must follow protocol or not ship.** Morning, same posture, pre-caffeine, **ln(rMSSD)**, judged vs. 7-day baseline + normal range + CV — never a single raw number. A wrong HRV feature is worse than none (false alarms destroy trust).
13. **Watch the metabolic/mechanical gap (hand-off to Realm 3).** Our load is purely metabolic (HR/zone/RPE). Bone/tendon injury tracks *mechanical* load (run volume, impact) — track running-specific volume/ramp separately; don't let a low metabolic load hide a spiking run mileage.
14. **Keep every metric degradable and interpretable.** No feature may require power/HRV/CSS that most users lack; every score must be explainable in one sentence ("today's easy because you slept poorly and your legs are sore").
15. **Treat all constants as tunable, and log the data to tune them.** Zone weights, EWMA α's, RPE↔HR conversions, deadbands — capture inputs/outcomes now so these can be fit to real AmaTri data later instead of staying folk constants.

---

## 5. Open questions, gaps & roadmap

**P0 — foundational, high leverage:**
1. **Recompute `workoutLoad` from reality** (device actuals → sRPE → planned zone). Closes the "hard session scores like an easy one" bug and feeds everything downstream. (`lib/stats.ts`)
2. **Add Foster session-RPE load** (`RPE × duration`) as the canonical internal-load unit with zone-weighted-minutes as fallback. Nearly free; inputs already collected.
3. **Build a daily PMC: CTL/ATL/TSB.** Requires daily-resolution load (from #1). Unlocks freshness/taper/ramp guidance. This is the flagship missing capability.

**P1 — readiness maturity:**
4. **Baseline-relative readiness:** convert the absolute 3-item score to deviation-from-rolling-baseline as history accrues; add multi-day trend + debounce; let *high* readiness green-light (not add) the key session.
5. **Use `restingHr`:** morning RHR vs. baseline as a confirming fatigue signal (already captured, currently dead).
6. **Ramp-rate guardrail + Foster monotony/strain** surfaced as gentle "you're ramping fast / your week is monotonous" nudges (uncoupled, non-ACWR).

**P2 — richer signals & prediction:**
7. **Optional HRV path** (manual entry or wearable import) done to Altini protocol — ln(rMSSD), baseline, normal range, CV. Optional, never required.
8. **Overreaching early-warning:** trend on `sessionStrain` (rising RPE for equal prescribed zone) → NFOR flag distinct from the 2-week miss-rate trigger.
9. **Better prediction:** consider Daniels VDOT / critical-speed for run and a CP model for bike as *optional* enrichments to `estimateRaceSeconds`, with honest error bars. Keep `projectRace` framed as motivational.

**Cross-cutting research questions:**
- What zone weights / EWMA time constants actually fit *age-grouper* multisport data (vs. the cycling-derived 42/7 and our asserted `{0.6…3}`)? Instrument to find out.
- How do we present *one* PMC for a triathlete when swim/bike/run thresholds have very different confidence (swim CSS is usually guessed)? Per-sport confidence weighting?
- Can the deterministic engine + a daily TSB close the loop *automatically* (auto-taper when TSB says race-ready) without eroding the "plan you can trust" feel?
- Where exactly does the metabolic-load view need a parallel *mechanical*-load view to catch run-volume injuries (shared with Realm 3)?

---

## 6. Sources & further reading

**Load quantification**
- Foster C. et al. — *A New Approach to Monitoring Exercise Training* (session-RPE, 2001) [primary research]: https://paulogentil.com/pdf/A%20New%20Approach%20to%20Monitoring%20Exercise%20Training.pdf
- Haddad M. et al. — *Session-RPE Method for Training Load Monitoring: Validity, Ecological Usefulness, and Influencing Factors* (Frontiers, 2017) [primary research]: https://pmc.ncbi.nlm.nih.gov/articles/PMC5673663/
- Banister TRIMP overview & variants (Edwards, Lucia, iTRIMP) [practitioner]: https://www.trainingimpulse.com/banisters-trimp-0 · https://www.trainingimpulse.com/itrimp
- Understanding TRIMP (formula, gender constants) [practitioner]: https://www.globalperformanceinsights.com/post/understanding-trimp-a-guide-to-heart-rate-training-impulse
- Coggan — *Normalized Power, Intensity Factor and Training Stress Score* (TrainingPeaks) [industry]: https://www.trainingpeaks.com/learn/articles/normalized-power-intensity-factor-training-stress/
- Goossens A. — *Formulas from "Training and Racing with a Power Meter"* (NP/IF/TSS/rTSS/hrTSS math) [practitioner]: https://medium.com/critical-powers/formulas-from-training-and-racing-with-a-power-meter-2a295c661b46
- Critical Power concept (GSSI review) & Skiba W'BAL [primary/practitioner]: https://www.gssiweb.org/sports-science-exchange/article/the-critical-power-concept-and-high-intensity-exercise-performance · https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7552657/

**Performance Management Chart**
- TrainingPeaks — *The Science of the Performance Manager* (CTL/ATL/TSB, 42/7) [industry]: https://www.trainingpeaks.com/learn/articles/the-science-of-the-performance-manager/
- TrainingPeaks — *What is the Performance Management Chart?* [industry]: https://www.trainingpeaks.com/learn/articles/what-is-the-performance-management-chart/
- TrainingPeaks Help — *Fitness (CTL)* [industry]: https://help.trainingpeaks.com/hc/en-us/articles/204071884-Fitness-CTL
- Intervals.icu — *Fitness, Fatigue & Form Chart* (multi-source load, EWMA defaults, hrTSS caveats) [industry]: https://www.intervals.icu/features/fitness-chart/

**ACWR — claim and critique (read both sides)**
- Gabbett T. — training-injury prevention / "sweet spot" (origin of ACWR) [primary research]; summary via: https://www.globalperformanceinsights.com/post/has-the-acute-chronic-workload-ratio-been-debunked
- Lolli L. et al. — *Mathematical coupling causes spurious correlation within the conventional acute-to-chronic workload ratio* (2019) [primary research]: https://www.researchgate.net/publication/320847733_Mathematical_coupling_causes_spurious_correlation_within_the_conventional_acute-to-chronic_workload_ratio_calculations
- Impellizzeri F. et al. — *Acute:Chronic Workload Ratio: Conceptual Issues and Fundamental Pitfalls* (2020) [primary research]: https://www.researchgate.net/publication/341936245_AcuteChronic_Workload_Ratio_Conceptual_Issues_and_Fundamental_Pitfalls
- Impellizzeri F. et al. — *What Role Do Chronic Workloads Play in the ACWR? Time to Dismiss ACWR and Its Underlying Theory* (2021) [primary research]: https://www.researchgate.net/publication/347442902
- *Training Load and Its Role in Injury Prevention, Part 2: Conceptual and Methodologic Pitfalls* (J Athletic Training, 2020) [primary research]: https://meridian.allenpress.com/jat/article/55/9/893/444129/

**Readiness, HRV & subjective monitoring**
- Saw A., Main L., Gastin P. — *Subjective self-reported measures trump commonly used objective measures: a systematic review* (BJSM, 2016) [primary research]: https://pubmed.ncbi.nlm.nih.gov/26423706/
- Altini M. / HRV4Training — baseline, normal range, CV, morning-vs-night [practitioner]: https://marcoaltini.substack.com/p/hrv4training-pro-user-guide · https://hrv4training.substack.com/p/week-10-another-look-at-the-coefficient · https://hrv4training.substack.com/p/week-4-morning-or-night
- HRV-guided training RCTs: Nuuttila et al. (block vs HRV-guided) [primary research]: https://www.firstbeat.com/wp-content/uploads/2017/11/Nuuttila-et-al_Effects-of-HRV-Guided-vs.-Predetermined-Block-Training-on-Performance-HRV-and-Serum-Hormones.pdf ; Granero-Gallegos et al. meta-analysis (HRV-guided vs predefined) [primary research]: https://www.researchgate.net/publication/346971733
- Individualized training by HRV/HR/well-being in cyclists (Sci Reports, 2025) [primary research]: https://www.nature.com/articles/s41598-025-13540-z

**Prediction & overreaching**
- Riegel endurance model (fatigue exponent 1.06) — implemented in `lib/paces.ts`; background: https://gssns.io/posts/formulas-training-racing-power-meter/
- Meeusen R. et al. — *Prevention, diagnosis and treatment of the overtraining syndrome* (ECSS/ACSM joint consensus, 2013) [primary research]; overreaching taxonomy summary: https://uesca.com/overtraining-syndrome/

**Overview / synthesis**
- *Training load monitoring* review [primary research]: https://www.researchgate.net/publication/291695236_Training_load_monitoring
- TRIMP/TSS/training-load explainer [practitioner]: https://www.iamcoach.ai/blog/trimp-training-load-explained

---

## Related knowledge docs
- [01 — Exercise Physiology & Periodization](./01-exercise-physiology-and-periodization.md) — zones, thresholds, phases, supercompensation (the *why* behind the load these models measure).
- [03 — Injury & Load Management](./03-injury-and-load-management.md) — the mechanical-load counterpart, ACWR-for-injury, and the metabolic/mechanical gap flagged here (§1.0, rule 13).
- [04 — Planning Engine Algorithm Design](./04-planning-engine-algorithm-design.md) — how the deterministic weekly-load curve, ramp control, and adaptation hooks consume readiness/calibration.
- [05 — Wearable & Data Ecosystem](./05-wearable-and-data-ecosystem.md) — Strava `actuals`, HRV/RHR device sources, and the data-availability ladder that this realm degrades along.
- [06 — Behavioral Science & Retention](./06-behavioral-science-and-retention.md) — check-in compliance, streaks, and why cheap subjective signals win on adherence.
- [07 — Product & UX Design](./07-product-and-ux-design.md) — surfacing readiness/fitness/form without overwhelming a time-crunched age-grouper.
- [08 — Software & Platform & Security](./08-software-platform-and-security.md) — storing daily readiness/load history, recomputation, and privacy of health signals.
