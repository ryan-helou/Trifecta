# Exercise Physiology & Periodization (Multisport)
> Canonical Trifecta knowledge doc · Realm 1 of 8 · Last researched: 2026-07-22 (§4 rule 16, course profile, added 2026-08-09 — reasoned, not researched)

**Purpose:** This realm is the physiological ground truth the entire product stands on. Trifecta's moat is a deterministic engine that generates a coach-quality triathlon plan at ~$0 marginal cost ([lib/planEngine.ts](../../lib/planEngine.ts)). That engine is only as good as the periodization science encoded in it. If our phase splits, intensity distribution, load:deload ratios, taper, brick logic, and per-sport balancing are physiologically sound, we out-coach a $200/month human for the time-crunched age-grouper. If they're naive, we injure people (Runna's open flank — see [runna-competitive-analysis.md](../research/runna-competitive-analysis.md) §5) or leave fitness on the table. This document is what "getting the physiology right" actually means, with the numbers, protocols, named research, and an honest audit of where our code is sound vs. where it's guessing.

---

## TL;DR — the things that actually matter

- **Endurance performance is governed by four things, not one:** VO₂max (ceiling), lactate/anaerobic threshold (the fraction of the ceiling you can hold), economy/efficiency (cost per unit speed), and — newly formalized — **durability** (how little those three decay over hours). Long-course triathlon is won on threshold, economy, and durability, *not* VO₂max. Our engine correctly anchors everything to **threshold** (FTP / threshold pace / CSS), which is right.
- **The single most robust finding in endurance training** is that elite athletes train ~**80% easy / 20% moderate-hard** by session count (Seiler). This is a *population optimum*, not a law. Our engine produces roughly this ratio by construction (many easy fillers + 1–2 quality sessions/sport) but never *measures or enforces* it.
- **Polarized (lots of easy + lots of hard, little middle) vs pyramidal (lots of easy, some threshold, little VO₂)** is the live debate. Evidence: polarized wins for *already-fit athletes doing a short intensification block* (Stöggl & Sperlich 2014); pyramidal is what most elites actually do most of the year, and is arguably *better for long-course* tri where threshold-to-tempo is the race intensity. Our build phase is implicitly pyramidal (sweet-spot/tempo/threshold heavy) — defensible for 70.3/IM.
- **Intensity is best prescribed off thresholds, not VO₂max or %HRmax.** Bike = %FTP (Coggan), run = % of threshold pace (Friel/Daniels), swim = seconds vs CSS. We do exactly this. HR is a fallback, not the anchor — correct, because HR lags, drifts with heat/fatigue, and is useless for intervals.
- **Load:deload cycles matter.** 3:1 (three build weeks + one recovery) for trained athletes, **2:1 for beginners and masters**. We do 3:1 / 2:1 by level — good — but **age is not an input**, so a 55-year-old intermediate gets a 3:1 cycle they may not recover from.
- **The taper is the highest-leverage two weeks of the year.** Meta-analysis (Bosquet 2007): reduce volume **41–60%**, hold **intensity and frequency**, ~**2-week exponential** taper → ~2–3% performance gain. Our taper cuts volume and keeps intensity (right) but uses fixed 1/2/3-week durations by distance (Olympic taper of 1 week is arguably short).
- **The concurrent/interference effect is the crux of multisport** and the one thing a run app can never teach us. Endurance signaling (**AMPK**) blunts the strength/hypertrophy pathway (**mTORC1**); the effect is dose-dependent and worst when high-intensity endurance and heavy strength are done close together. **Our engine schedules strength but does not sequence it to minimize interference** — a real, fixable gap.
- **Bricks are non-negotiable in tri.** Running off the bike costs **1.6–11.6% extra oxygen** at a given pace (worse the less trained you are); the "jelly legs" clear by ~minute 8–10. We build bricks in build/peak only and cue this well.
- **Distance dictates race intensity.** Sprint/Olympic run near/above threshold; 70.3 bike ~**76–83% FTP** / run ~tempo; full IM bike ~**68–75% FTP** / run ~Z2. Our race-day targets (Olympic 88–95%, half 80–85%, full 70–75% FTP) are in the right ballpark, slightly hot on the half.
- **Female physiology:** the menstrual cycle's *average* effect on performance is **trivial** (McNulty 2020 meta-analysis, 78 studies) with **large individual variation**. So rigid cycle-phase periodization is over-sold; letting athletes *track and self-adjust* is the evidence-based move. The real danger is **RED-S / low energy availability**, which our engine is blind to. **We collect no sex, age, or menstrual data at all** — both a defensible neutrality and a missed safety/personalization layer.
- **Masters athletes** lose ~**5.5% VO₂max/decade** if they keep training hard (vs ~12%/decade sedentary); the binding constraint is **recovery**, not trainability. They need more easy days and longer deloads. Our engine has no age awareness.
- **Durability** is the emerging fourth marker and is *the* differentiator between two athletes with identical lab numbers. It's trained by long sessions, race-pace-in-fatigue work, and fasted rides. Our long-ride/long-run + "race effort in the final 25%" touches this but doesn't progress it deliberately.
- **Environment is a performance variable:** heat acclimation (~**10–14 days**, plasma volume +) is worth minutes and is a *safety* issue for hot races; altitude (live-high/train-low, **2000–2500 m**, ~2–4 weeks) raises hemoglobin mass. **Our engine models neither.** Fueling target for long course is **~90 g carbs/hr** of multiple-transportable carbs, requiring **gut training**. We mention 60–90 g/hr but don't program it.

---

## 1. Core knowledge

### 1.1 Bioenergetics — the three energy systems

Every session trains one or more of three overlapping ATP-resynthesis pathways:

| System | Fuel | Dominant duration | Byproduct/limit | Tri relevance |
|---|---|---|---|---|
| **Phosphagen (ATP-PCr)** | Creatine phosphate | 0–10 s | PCr depletion | Starts, surges, standing on a climb |
| **Glycolytic (anaerobic)** | Muscle glycogen → lactate | ~10 s–2 min | H⁺ accumulation (the "burn"), not lactate itself | Short surges, the last 400 m of an Olympic run |
| **Oxidative (aerobic)** | Fat + carbohydrate + lactate | 2 min → hours | O₂ delivery, glycogen depletion, substrate | **~95–99% of a triathlon's energy** |

Key truths the engine must respect:
- **Triathlon is an aerobic sport at every distance.** Even a sprint tri (~1 hr) is >90% aerobic. This is *why* the base phase (aerobic engine) is the foundation and why 80% of volume is easy.
- **Lactate is a fuel, not a poison.** It's shuttled and oxidized (Brooks' lactate shuttle). The "lactate threshold" marks where production outpaces clearance — a *proxy* for metabolic strain, not a toxin threshold.
- **Fat vs. carbohydrate crossover:** at low intensity you burn mostly fat (near-infinite stores); as intensity rises you shift to carbohydrate (glycogen, ~90–120 min at race pace before depletion). This is the physiological basis of both **Z2 base training** (improve fat oxidation, spare glycogen → durability) and **race fueling** (~90 g carb/hr to defend glycogen).

### 1.2 The physiological markers — what they are, how they're measured, why they matter

**VO₂max** — maximal rate of oxygen uptake (ml·kg⁻¹·min⁻¹). The aerobic *ceiling*. Trainable ~5–15% in most; largely genetically capped. Elite male AG triathletes ~60–70, pros ~70–85. **Critically: among trained athletes VO₂max correlates poorly with race result** — two athletes at VO₂max 65 can finish 20 min apart over 70.3. That's why we don't anchor to it. Measured via graded lab test to plateau; field-estimated from race performances.

**Lactate thresholds (LT1 & LT2)** — the two inflection points that matter more than VO₂max:
- **LT1 / aerobic threshold (AeT):** first rise in blood lactate above baseline (~2 mmol/L), roughly the top of "all-day" pace. The ceiling of true easy/Z2 training. Sits around ~70–80% VO₂max in trained athletes.
- **LT2 / anaerobic threshold / MLSS / critical power/speed:** the highest intensity at which lactate stays in steady state (~3.5–4.5 mmol/L, but individual). This is **the** performance-defining marker — the fastest sustainable pace. ~80–90% VO₂max in the well-trained.
- Measured by incremental test with fingertip lactate; the **Norwegian method** (below) uses it as the *live* training control, keeping sessions at 2.0–4.5 mmol/L.

**FTP (Functional Threshold Power)** — Coggan's field proxy for LT2 on the bike: the highest power sustainable ~1 hr, practically estimated as **95% of a 20-min max effort** (or a 40–60 min TT). Anchors all bike zones. Simple, testable, wildly popular — but a *single number* that hides the shape of the power-duration curve.

**Critical Power (CP) & W′** — the more complete two-parameter model (Monod & Scherrer; developed by **Jones & Vanhatalo**). Fit power vs. time-to-exhaustion across 2–15 min efforts: **CP** = the asymptote (a truer physiological threshold / maximal metabolic steady state than FTP), **W′** ("W-prime") = the fixed anaerobic work capacity *above* CP (~9–15 kJ men, ~6–10 kJ women), which depletes and reconstitutes. CP/W′ explains interval tolerance and end-spurt capacity that FTP alone can't, and **explains training-adaptation variance that VO₂max misses** (Jappl. Physiol. 2022). Running has an equivalent: **critical speed + D′**.

**CSS (Critical Swim Speed)** — the swim analog of FTP/CP. From two maximal time trials: `CSS = (400 m − 200 m) ÷ (t400 − t200)`, giving sec/100 m (Wakayoshi 1992). It's the swim threshold pace, holdable ~1500 m, and the single biggest lever on the swim split. Anchors all swim zones.

**Running economy / cycling efficiency** — the oxygen (or energy) cost of a given submaximal speed/power. Two athletes with identical VO₂max and threshold can differ 5–10% in economy → minutes over a race. Improved by volume, strength, plyometrics, and technique. Hard to measure in the field; we don't try, which is fine.

**Durability / fatigue resistance** *(see §1.9)* — the fourth marker, how little the above decay over hours.

### 1.3 Zone models — how many, and the tradeoffs

There is no single "correct" zone system; each is a different lens on the same continuum:

- **3-zone (Seiler / physiological):** Z1 = below LT1 (easy), Z2 = between LT1 and LT2 ("the middle," threshold-ish), Z3 = above LT2 (hard). This is the model the **80/20 / polarized** literature is written in — and it's why "polarized" means "avoid the middle Z2," which is a *different* Z2 than the 5-zone Z2. **Terminology trap:** Seiler-Z2 = no-man's-land; Coggan/5-zone-Z2 = aerobic base. Do not conflate.
- **5-zone (Coggan-lite / what Trifecta uses):** Recovery / Endurance / Tempo / Threshold / VO₂max. Legible for consumers, maps cleanly to one prescription per session. Cost: it compresses Coggan's 7 power zones and loses the anaerobic/neuromuscular top end.
- **7-zone (Coggan power):** Active Recovery, Endurance, Tempo, Lactate Threshold, VO₂max, Anaerobic, Neuromuscular. Precise for cyclists with power; overkill for a consumer tri app.
- **HR zones (%HRmax or %HRR/Karvonen or %LTHR):** convenient but flawed — HR lags effort by 30–120 s (useless for intervals), drifts up with heat/dehydration/fatigue ("cardiac drift"), and %HRmax overstates zones vs. %HR-reserve. Best as a *ceiling check* on easy days, not an interval target.
- **RPE (Borg / CR10):** free, always available, and — trained — remarkably accurate. The Norwegian pros race on internal feel. Our engine carries an RPE label on every zone, which is the right safety net.

**The honest position:** thresholds (FTP/CSS/threshold-pace) are the best field anchor; power (bike) and pace (run/swim) beat HR; HR and RPE are backstops. Trifecta's design (§3) matches this.

### 1.4 Periodization theory — the models and what the research says

**Periodization** = the planned distribution of training stress over time to peak on a date while managing fatigue and adaptation. Four organizing philosophies:

1. **Linear / traditional (Matveyev):** high volume → low intensity early; progressively lower volume → higher intensity toward the race. Base → Build → Peak → Taper. Robust, simple, the default for a first-time age-grouper. Trifecta is fundamentally this.
2. **Reverse periodization:** intensity first, volume later. Used when the *race* is short/intense or the athlete's off-season is indoors (trainer). Niche for tri.
3. **Block periodization (Issurin):** 2–4 week mesocycles of *concentrated* single-focus load — **accumulation** (aerobic/base), **transmutation** (sport-specific), **realization** (taper/race). Rationale: you can only develop a few qualities at once, and different qualities detrain at different rates (neural/glycolytic fast, aerobic slow), so concentrate and rotate. Meta-analysis (Rønnestad): **small but real** VO₂max/Wmax benefit vs. traditional for *already-trained* athletes; a 12-week trained-cyclist RCT found **no difference** (Frontiers 2022). Verdict: promising for advanced athletes, not clearly better for the general population, and harder to schedule around three sports.
4. **Undulating / non-linear:** intensity varies within the week/microcycle rather than across months. This is arguably what *every* good tri week already is (a threshold day, a VO₂ day, easy days) — so "undulating" describes our microcycle even inside a linear macrocycle.

**Intensity distribution — the real debate (this is where the science is loudest):**
- **Polarized (POL):** ~80% easy (below LT1) + ~15–20% hard (above LT2), *minimal* threshold. **Stöggl & Sperlich 2014** (48 well-trained endurance athletes, 9 weeks, 4 groups): POL (achieved 68/6/26 by the 3-zone split) produced the **largest gains in VO₂max and time-to-exhaustion** — beating threshold (46/54/0), HIIT (43/0/57), and high-volume (83/16/1). Threshold and high-volume groups saw *no* significant further gains in this already-fit cohort.
- **Pyramidal (PYR):** ~80% easy + a *descending* amount of threshold then VO₂ (more Z2/threshold than a polarized model, less pure VO₂). Retrospective analyses (Seiler; Kenneally; Filipas) show many elite runners/cyclists actually train **pyramidal for most of the year and shift toward polarized near competition.**
- **Threshold (THR):** the "middle" heavy model — repeatedly shown *inferior* for improving fitness in the trained, but note the **Norwegian double-threshold method** deliberately lives here with careful lactate control and huge volume.
- **What to actually believe:** (a) **~80% easy is the near-universal invariant** across all successful models; the fight is only over the other 20%. (b) POL is well-evidenced as a **short intensification block** for fit athletes. (c) **PYR is likely better for long-course triathlon**, whose race intensity *is* threshold-to-tempo — you should spend build-phase quality time at the intensity you'll race. (d) It's not either/or: **PYR in base/build → more POL in peak** is the sophisticated answer. This directly informs how Trifecta should shape quality across phases (§4).

### 1.5 Macro / meso / microcycle & load:deload

- **Macrocycle:** the whole plan to the A-race — spanning the entire runway from sign-up (~8 weeks up to ~2 years; compressing if the race is sooner, extending the aerobic base if it's further out).
- **Mesocycle:** a 3–4 week block with a theme (base, build, peak). Ends in a deload.
- **Microcycle:** the week.
- **Progressive overload with deloads:** you can't build linearly forever — fitness is built by *stress + recovery*, and unrecovered stress becomes non-functional overreaching → overtraining. The standard is **3:1** (three progressively harder weeks, one recovery week at ~60% load) for trained athletes and **2:1** for beginners, masters, and the injury-prone. Recovery weeks drop *volume* ~40%, keep a touch of intensity to hold sharpness.
- **How much to add:** the "**10% rule**" (don't raise weekly load >~10%) is a useful heuristic though weakly evidenced; the modern framing is the **acute:chronic workload ratio** (keep the ~7-day load within ~0.8–1.3× the ~28-day chronic load) — covered in [02-training-load-and-readiness.md](02-training-load-and-readiness.md) and [03-injury-and-load-management.md](03-injury-and-load-management.md).

### 1.6 The taper — what physiologically happens, and the optimal protocol

The taper is a pre-race reduction in load to shed accumulated fatigue while *preserving* fitness — "supercompensation." Physiology: **muscle glycogen repletion, blood/plasma volume normalization, ↑ red cell volume, ↑ muscle power and enzyme activity, repair of micro-damage, hormonal/immune rebound, and CNS freshening.** Fitness (VO₂max, threshold) barely declines over 1–3 weeks of reduced volume; fatigue clears fast → net performance ↑.

**The evidence (Bosquet 2007 meta-analysis, 27 studies; Mujika):**
- **Reduce volume by 41–60%.** (Retain ~40–59% of peak volume.)
- **Maintain intensity** — this is the non-negotiable. Cutting intensity detrains you.
- **Maintain (or only slightly cut) frequency** — keep the *pattern* of training.
- **Cut duration of sessions, not their number.**
- **~2 weeks** is the sweet spot for most; an **exponential ("fast decay")** taper beats a linear/step taper.
- Expected gain: **~2–3%** (meaningfully more for the highly trained).

**By distance:** sprint/Olympic ~7–10 days; 70.3 ~10–14 days; full IM ~2–3 weeks (some carry a mini-recovery earlier plus a final taper). Race week always includes a rest day and short **"openers"** (a few race-pace efforts) to prime without fatiguing.

### 1.7 Concurrent training & the interference effect — the crux of multisport

This is the physiological problem *unique* to combining sports + strength, and it's why a run-app's periodization can't just be bolted onto tri.

**The phenomenon (Hickson 1980):** adding endurance training blunts strength/power/hypertrophy gains vs. strength alone. The reverse (strength blunting endurance) is *much smaller* — well-programmed strength generally **helps** endurance (economy, injury resistance, late-race durability).

**Molecular basis (Coffey & Hawley; Baar; Atherton's "AMPK–PKB switch"):**
- Endurance exercise activates **AMPK** (an energy-stress sensor) and PGC-1α → mitochondrial biogenesis, fat oxidation, capillarization.
- Resistance exercise activates **mTORC1** (via PKB/Akt) → muscle protein synthesis, hypertrophy.
- **AMPK inhibits mTORC1** (via TSC2/raptor). So a strong endurance signal, especially *high-intensity or glycogen-depleting* endurance done close to a strength stimulus, suppresses the anabolic response. Coffey showed mTORC1 activation after strength was **abolished** when preceded 15 min earlier by 10×6 s maximal sprints, but **not** when preceded by moderate cycling.
- The current consensus is it's **multi-factorial** (not AMPK alone): also glycogen status, residual fatigue, muscle damage, and molecular "competition."

**Practical rules for tri (what our engine should encode):**
- **Interference is dose-dependent:** worst with high endurance volume/intensity + heavy lowering-focused strength close in time.
- **Separate incompatible sessions by ≥6 h**, or do the *priority* quality first when they must share a day.
- **Don't put heavy lower-body strength adjacent to a key run/threshold session** (both tax the legs; interference + injury risk).
- Triathletes don't need hypertrophy — they need **strength/power + durability + injury resistance**, so heavy-low-rep and plyometric work (which is *less* interfered-with than hypertrophy) is the right prescription, and interference matters less than for a bodybuilder — but session *timing/sequencing* still matters.
- In-season strength is a **maintenance** dose (1–2×/week), tapered before the race.

### 1.8 Brick physiology

A "brick" = bike→run (or swim→bike) back-to-back, the defining tri skill. Running off the bike is physiologically different from fresh running:
- **↑ oxygen cost of running 1.6–11.6%** at the same pace, worse the less trained (Sports 2019). Cause: altered stride (shorter, higher cadence early), leg muscle fatigue/O₂ desaturation, and blood-flow redistribution from cycling-recruited to running-recruited muscles.
- The "jelly-legs" sensation and elevated cost **clear by ~minute 8–10** as gait normalizes and blood redistributes.
- **What bricks train:** neuromuscular adaptation to the transition, pacing discipline off the bike, fueling/transition rehearsal, and mental familiarity so it "won't rattle you on race day."
- For long course, bricks also build **durability** (running well on pre-fatigued legs). Short bricks (10–20 min run) suffice for skill; long-course benefits from occasional longer run-off-bike blocks.

### 1.9 Durability / fatigue resistance — the emerging fourth marker

Coined by **Maunder et al. (2021)**: *"the time of onset and magnitude of deterioration in physiological-profiling characteristics over time during prolonged exercise."* Two athletes with identical *rested* VO₂max, threshold, and economy can differ enormously after 3 hours — the durable one holds power/pace/economy; the other's thresholds sag. **This is often the real difference-maker in long-course racing** and is invisible to a single rested lab test. Jones (2025) frames the broader construct as "physiological resilience."
- **How it's measured:** re-test threshold/economy *after* a prolonged bout (e.g., after 15 kJ·kg⁻¹ of work), or track drift in HR/power/economy during a long ride.
- **How it's trained:** long sessions, **quality efforts placed late in long sessions (on tired legs)**, occasional fasted/low-carb-availability rides (train fat oxidation — carefully, RED-S risk), and progressive time-at-race-intensity. Improved by **both** low- and high-intensity training (Frontiers 2023).
- **Why it matters to us:** it's the physiological name for what age-groupers call "not blowing up," and it's exactly what an IM plan must build. Our long-ride "race effort in the final 25%" is a rudimentary durability stimulus.

### 1.10 Distance-specific demands & race-pacing physiology

Race intensity is inversely related to duration. Approximate targets (well-trained age-grouper):

| | Duration | Swim | Bike (% FTP, Normalized Power) | Run |
|---|---|---|---|---|
| **Sprint** | ~1–1.5 h | ~CSS to CSS-pace | ~88–95%+ | ~threshold to 10k pace |
| **Olympic** | ~2–3 h | ~CSS+2–4 s | ~85–92% | ~threshold to tempo (Z3–Z4) |
| **70.3** | ~4–6 h | ~CSS+3–5 s | **~76–83%** (IF ~0.78–0.83; elites 0.85–0.87) | tempo (Z3), ~half-marathon-ish effort |
| **Full IM** | ~9–15 h | ~CSS+5–8 s (steady) | **~68–75%** (IF ~0.68–0.75) | Z2, marathon effort / "controlled" |

Pacing physiology principles:
- **The bike sets up the run.** Overbiking (too high IF) depletes glycogen and trashes the run far more than it gains on the bike. The classic error. Keep **Variability Index (NP/AP) < 1.05** — steady beats surge/coast.
- **Fueling:** ~**60–90 g carb/hr** for 70.3, up to ~**90–120 g/hr** for IM, using **multiple-transportable carbs** (glucose:fructose ~2:1 or 1:0.8) to exceed the ~60 g/hr single-transporter (SGLT1) ceiling — glucose via SGLT1, fructose via GLUT5, additive (Jeukendrup). Requires **"gut training"** (progressive high-carb sessions over 6–12 weeks to upregulate transporters and gastric emptying).
- **Sodium/hydration:** individualized to sweat rate and sweat sodium; over-drinking plain water → hyponatremia; under-fueling → glycogen depletion ("the wall").

### 1.11 Female physiology — evidence vs. hype

- **Menstrual-cycle effect on performance:** the definitive meta-analysis (**McNulty 2020**, 78 studies, 1,193 women) found performance may be **"trivially reduced" in the early follicular phase** (during menstruation, low hormones) vs. other phases — but the effect is *small*, study quality is largely low, and **individual variation dominates**. So the popular claim that you must rigidly periodize training to cycle phase is **over-sold**.
- **The practitioner view (Stacy Sims):** train hard in the low-hormone follicular phase (better pain tolerance, glycogen access), ease toward aerobic/steady in the high-progesterone luteal phase (↑ core temp, ↑ cardiovascular strain, ↑ protein catabolism, harder thermoregulation). Reasonable *heuristics*, but Sims' strongest specific claims outrun the RCT evidence, which is why the honest synthesis is: **the mechanisms are real, the average performance effect is small, and the right product move is to let each athlete *track her own cycle and symptoms and self-adjust* rather than hard-code a universal template.**
- **Hormonal contraceptives:** blunt the natural hormonal fluctuation; current evidence shows only trivial average effects on performance — again, individual.
- **RED-S / Low Energy Availability (LEA):** the genuinely important, *safety-critical* issue. When energy intake doesn't cover training expenditure, the body downregulates: **menstrual dysfunction, low bone mineral density (stress-fracture risk), impaired recovery/immunity/mood, and *reduced* performance.** IOC consensus statements (2014 → 2018 → 2023) expanded the older **Female Athlete Triad** (LEA + menstrual dysfunction + low BMD) into **RED-S**, which affects **men too**. A time-crunched age-grouper adding big tri volume on a busy life is a textbook LEA risk. Any adaptive engine that only ever adds load is complicit in this if it ignores fueling and red-flag symptoms.
- **Practical:** most female-specific physiology worth encoding is *not* cycle-phase micro-periodization; it's (1) don't under-recover, (2) protect energy availability, (3) let her log cycle/symptoms and adapt, (4) higher iron-deficiency vigilance.

### 1.12 Masters athletes — aging & recovery

- **VO₂max declines ~10%/decade sedentary; ~5%/decade in athletes who keep training** — and most of the *athletic* decline tracks **falling training volume**, not age per se (Journal of Applied Physiology; MDPI 2022). Longitudinal masters data ties ~40–54% of VO₂max-decline variance to volume change.
- **Maximal HR falls ~0.7 bpm/yr** regardless of fitness (so age-predicted HR zones shift, and %HRmax formulas get less reliable) — a reason to anchor to threshold, not HRmax, for masters.
- **The binding constraint is recovery, not trainability.** Masters can still adapt strongly but need **more recovery between hard sessions, longer deloads (lean 2:1), and more easy volume.** Connective-tissue resilience drops → higher injury risk from intensity spikes.
- **Strength training becomes *more* important with age** (counter sarcopenia, maintain power and economy, protect bone).

### 1.13 Environmental physiology

- **Heat:** acclimation over **~10–14 days** (60–90 min daily heat exposure with exercise) drives **plasma volume expansion (within days), lower HR at a given load, earlier/greater sweating, lower core & skin temp, improved thermal comfort** (Périard). Worth minutes on a hot race and, more importantly, a **safety** issue (heat illness). Adaptations decay in ~1–2 weeks without maintenance. A hot A-race should be preceded by a heat block.
- **Altitude:** **live-high/train-low (Levine & Stray-Gundersen)** at **2000–2500 m** for **~3–4 weeks** raises **hemoglobin mass / red cell volume ~3–5%** (EPO-mediated) while preserving sea-level training intensity. "Live high/train high" costs training quality; benefit is contested and highly individual (responders vs. non-responders). Niche for most age-groupers.
- **Hydration/sodium:** as §1.10 — individualized, sweat-rate-based; the failure modes are hyponatremia (over-drink) and dehydration/GI shutdown.

---

## 2. State of the art — what the best in the world do

- **Stephen Seiler** — the 80/20 / polarized framework; *descriptive* research on what elite XC-skiers, rowers, cyclists, runners actually do (~80% below LT1). Not the inventor — the *measurer*. His "hierarchy of endurance training needs" is a clean mental model.
- **Marius Bakken / the Norwegian method** — **double-threshold** days (two sub-threshold interval sessions in one day, e.g., AM long / PM short), controlled by **live lactate (2.0–4.5 mmol/L, target ≤3.0)**, huge sub-threshold volume, *no pace/power cue* — feel + lactate only. Behind Jakob Ingebrigtsen and Kristian Blummenfelt/Gustav Iden (the latter two applying it to triathlon at extreme volume). The frontier's answer to "how much quality can you absorb without digging a hole": a lot, if it's *controlled* threshold, not race-pace grinding.
- **Andrew Coggan & Hunter Allen** — FTP, power zones, TSS/IF/NP, the *Training and Racing with a Power Meter* framework that underpins essentially every power-based bike prescription (including ours). IF 0.78–0.83 for 70.3, 0.68–0.75 for IM.
- **Philip Skiba** — CP/W′ modeling, W′ balance (real-time anaerobic-battery tracking), the BikeScore/GOVSS load metrics; the rigorous end of power-duration science.
- **Jones & Vanhatalo (Exeter)** — critical power/critical speed physiology and, latterly, **durability/physiological resilience** — the current research frontier for *why* two athletes with equal thresholds race differently.
- **Laursen & Buchheit** — *Science and Application of HIIT*; the definitive taxonomy of interval design (the "5 types of HIIT" by targeted physiology) — how to choose interval length/intensity/recovery to hit VO₂max vs. threshold vs. anaerobic.
- **Joe Friel** — *The Triathlete's Bible*; the practitioner canon for tri periodization (annual training plan, base/build/peak, testing, masters-specific work). The reference our phase structure most resembles.
- **Íñigo San Millán** — Zone-2 / mitochondrial-function and fat-oxidation emphasis (Pogačar's physiologist); the modern case for *why* huge easy volume works (metabolic flexibility, lactate clearance).
- **Stacy Sims** — female-specific physiology and fueling; strong on RED-S/LEA and sex-difference *awareness*, with the caveat that some specific cycle-periodization claims outrun the RCT base.
- **Asker Jeukendrup** — sports nutrition; multiple-transportable carbohydrates, 90 g/hr, gut training — the science behind modern race fueling.
- **Vladimir Issurin** — block periodization theory (accumulation/transmutation/realization).

Current frontier themes: (1) **durability/resilience** as the fourth pillar; (2) **controlled-threshold high volume** (Norwegian) vs. classic polarized; (3) **fueling as a trainable performance system** (very-high-carb, gut training); (4) **individualization** over population templates (responders/non-responders, sex, age, menstrual status); (5) **real-time internal-load control** (lactate, HRV, power-duration) over prescribed external load.

---

## 3. How this maps to Trifecta

### What our engine already does (cite file:line)

**Plan length, phases, load curve** — [lib/planEngine.ts](../../lib/planEngine.ts):
- Plan length = the **whole runway to race day, always starting the week the athlete signs up** (no delayed start). A race sooner than the per-distance minimum (Olympic 8 / half 12 / full 16 wk, `PLAN_MIN`) compresses; otherwise `totalWeeks = weeksUntil`, so surplus lead time **fills the runway with base** — build is a bounded ~6–12-week specific-prep block (`BUILD_MAX`) and `baseWeeks` is the residual, so extra time grows the aerobic engine (the long-course determinant), not near-peak build load. The *only* delayed-start case is a race booked past a ~2-year guardrail (`MAX_PLAN_WEEKS = 104`) — a mistyped date, not a real lead time.
- **Base/Build/Peak/Taper** split: taper = `min(TAPER_WEEKS, floor(totalWeeks*0.18))` (L603); base ≈ **45% of remaining** (`round(remaining*0.45)`, L605); peak ≈ 12% capped at 2 weeks (L606); build = the rest. `TAPER_WEEKS` = Olympic 1 / half 2 / full 3 (L48).
- **Weekly load curve** via `baseFraction` (L132–151): base ramps **0.60→0.85** of peak, build **0.85→1.00**, peak **1.00**, taper ladder **[0.70, 0.55, 0.42]** with **race week 0.32**. Peak weekly hours from `PEAK_HOURS` (L42–46): e.g., half-IM intermediate 11 h, full-IM advanced 18 h — capped by the athlete's `weeklyHoursCap`.
- **3:1 / 2:1 load:deload**: `cycleLen = level==="beginner" ? 3 : 4` (L620); recovery weeks every `cycleLen` weeks within base/build (L634), scaled to **0.62×** load (L654).
- **Fitness mode** (no race): rolling 12-week base→build block at 0.9× peak hours, no peak/taper/race week (L710–777).

**Intensity model** — [lib/zones.ts](../../lib/zones.ts) + [lib/paces.ts](../../lib/paces.ts) + [lib/targets.ts](../../lib/targets.ts):
- 5-zone model, prescribed correctly per sport: **bike = %FTP** (Z2 56–75, Z4 91–105, Z5 106–120 — Coggan-aligned), **run = ×threshold pace** (Friel/Daniels), **swim = ±sec vs CSS**, **HR = %HRmax fallback**, each with an RPE label (zones.ts L26–92).
- Paces derived from athlete PRs via **Riegel** (`riegel`, exp 1.06 run / 1.02 swim, paces.ts L12): run threshold = predicted-10k pace + 7 s/km; CSS = predicted-1000m ÷ 10; FTP → watt zones; level defaults when no PR (e.g., run threshold beginner 6:30/km → elite 3:40/km, paces.ts L16–30). **Auto-calibration** nudges targets ±15% from real performance (`CAL_MAX`, paces.ts L33).
- Race-day pacing targets (planEngine.ts L924): full **70–75% FTP** (Z2 run), half **80–85% FTP** (Z3 run), Olympic **88–95% FTP** (Z3 run) — plus fueling cue "60–90 g carbs/hour" (L924).

**Session library & 80/20** — [lib/workouts.ts](../../lib/workouts.ts):
- Rich, structured, physiologically-labeled builders per sport: swim technique/endurance/**CSS threshold**/VO₂/open-water/recovery; bike endurance/**sweet-spot 88–94%**/threshold 95–105%/VO₂ 110–120%/long/recovery; run easy/long/tempo/threshold/VO₂/recovery; strength (5 splits + home/custom/dryland); **brick**.
- Each week is assembled as **1–2 quality sessions per sport + easy/aerobic fillers** (planEngine.ts `pickWeekSlots`, L359–515), which **produces ~80/20 by construction**. Build/peak add race-specific intensity; base leans technique/aerobic (`bikeQualityRole`/`runQualityRole`/`keySwimBuild`, L448–479).
- Long-session **caps** so you don't train the full race distance: long run 90/120/180 min, long ride 150/240/330 min by distance (`LONG_RUN_CAP`/`LONG_RIDE_CAP`, L51–52). Long ride/run add **race effort in the final ~25%** in peak (`bikeLong`/`runLong`, workouts.ts L429–517) — a durability touch.
- **Bricks** only in build/peak, and only if a run injury doesn't make running-off-bike unwise (`brickOk`, L381–382); the brick cues the physiology precisely ("heaviness lifts by minute 8", workouts.ts L616).
- **Taper** keeps intensity while cutting volume: taper weeks retain quality/openers, drop most strength, cap total sessions (L338–341); race week builds short **openers** + rest day before race + the race itself (`buildRaceWeek`, L856–941).

**Multisport-native personalization** (the moat) — planEngine.ts:
- Per-sport session counts, either explicit (`perSport`) or distributed bike-leaning (swim 0.28 / bike 0.40 / run 0.32, +0.12 to the focus limiter; `splitTotal`, L192–222).
- **Injury modifiers** (`injuryMods`, L256–272): niggle → zone-cap 3, vol ×0.85; moderate → cap 2, ×0.6; severe → cap 2, ×0.4 + avoid — with freed volume **shifted onto low-impact healthy sports** (L305–314). This is the injury-aware substitution Runna can't do.
- Equipment substitution (no pool → dryland; no gym → home circuit), blackout dates, rest-day preference, strength split awareness, day-assignment that spreads sessions, never stacks two hard sessions **on the same day** (`assignDays`, L532–568).
  - ⚠️ **Corrected 2026-07-28.** This line used to claim the scheduler "honors a rest day". It only honors one the athlete explicitly asked for — `restDayPreference` is `undefined` unless they tap an optional onboarding chip, and the −1000 guard is behind a `!= null` check. Measured: at 8 sessions/week with no preference set, a 70.3 plan gives **14 off days in 147 and a 30-day unbroken training streak**; at 11 sessions, **6 off days in 224**. There is no rest-day *floor*. See §5 and the "no rest-day floor" ticket.
- Race-day finish estimate incl. **aerodynamic FTP→speed scaling (v ∝ FTP^⅓)** (`estimateRaceSeconds`, L84–110) — physiologically sound for flat-course drag.

### Where we're strong (the moat)

1. **We anchor to thresholds, not VO₂max or HRmax** — the single most correct decision. FTP/CSS/threshold-pace are the right performance anchors and are field-testable. Runna is pace-and-schedule only, no power/HR in plan logic (competitor doc §5.4) — we regulate off physiology.
2. **80/20 by construction + phase-appropriate quality.** The engine naturally produces the polarized-ish easy majority and — importantly — leans **pyramidal in build** (sweet-spot/tempo/threshold), which is *correct for long-course*. This is a defensible, evidence-aligned intensity design.
3. **Injury-aware, low-impact substitution** — genuinely differentiated and physiologically the right response (offload the aggravated tissue, keep the aerobic engine via swim/bike). This is our sharpest wedge (competitor doc §7C.1).
4. **Sound taper mechanics** — cut volume, hold intensity, keep frequency, add openers, rest before race. Matches Bosquet/Mujika in *shape*.
5. **Distance-appropriate race intensity + fueling cue + aero-correct finish estimate** — the details a real coach gets right.
6. **Multisport-native scheduling** (bricks, per-sport balancing, limiter bias, equipment realism) — the category Runna structurally can't enter.

### Where we're weak / naive / missing

1. **Concurrent/interference is not managed.** Strength is `hard:false` (planEngine.ts L493), so `assignDays` will happily place a **lower-body strength session on the same day as a hard run/threshold** (it only blocks two `hard` sessions and same-*discipline* doubles, L556–567). Physiologically this is exactly the AMPK/mTOR + shared-tissue collision to avoid. **Fix:** treat leg-strength as conflicting with key run/bike quality (min 6 h or different day), and sequence priority-quality-first.
2. **No age input → masters get an inappropriate cycle.** `cycleLen` keys off *level*, not age (L620). A fit 55-year-old "intermediate" gets 3:1 and full peak hours; masters need leaner 2:1 and more recovery. **Add `age`/`birthYear`; force ≤2:1 and trim peak hours/intensity density for masters.**
3. **No sex / menstrual / energy-availability model.** `Profile` has no sex field ([lib/types.ts](../../lib/types.ts) L213–248). Not hard-coding cycle-phase periodization is *defensible* (McNulty: trivial average effect) — but we have **no RED-S/LEA guardrail and no way to log cycle/symptoms to self-adjust**. The engine only ever *adds* load; that's an LEA risk. **Add optional cycle/symptom logging + an energy-availability/red-flag check that can *withhold* load.**
4. **80/20 is implicit, never measured** — but now measured *externally*, and it passes. We still never compute realized TID inside the engine, so nothing stops future drift. ✅ **Measured 2026-07-28** (expanding segments through `repeat` nesting, excluding rest intervals, by *time* not session count): Oly/beginner **77.6% Z1-2 / 17.1% Z3 / 5.3% Z4-5**; 70.3 **81.3 / 14.4 / 4.3**; full **92.3 / 5.2 / 2.5**; fitness block **90.5 / 3.8 / 5.7**. Every plan clears a 75–80% easy floor today — **there is no violation to fix.** A grey-zone hypothesis about the 17% Z3 in the beginner plan was tested and rejected: that Z3 time is **43% bricks, 36% race day itself, only 8.6% sweet spot**, and bricks at Z3 are correct for triathlon. **So the remaining work is the *measurement as a regression guard*, not an enforcement mechanism.** (Caveat: this trusts the zone labels, one of which is wrong — see §5.)
5. **5-zone compression + a sweet-spot boundary bug — NOT minor; it is an injury-cap bypass.** Sweet spot is prescribed at **88–94% FTP** (workouts.ts L364) but labeled Z3 (`primaryZone:3`), while our Z3 is 76–90% and Z4 is 91–105% (zones.ts) — so sweet spot **straddles the Z3/Z4 line**.
   - ⚠️ **Escalated 2026-07-28.** This entry previously called the bug "Minor… the zone dot/target can misrepresent it." That undersold it twice over. (a) `targetView()` renders targets from `ZONES[zone]`, so the athlete sees **"Tempo · 76–90% FTP" directly above "8 min @ 88–94% FTP"** — two different prescriptions for the same interval. (b) Far worse: `injuryMods()` maps a **niggle** to `capZone: 3`, and `bikeQualityRole()` routes `cap === 3` straight to `bikeSweetSpot`. So an athlete who reports a bike niggle is prescribed **88–94% FTP by a cap that exists to hold them at ≤90%**. The injury guard reduces the label, not the load. Fix the label/prescription agreement *and* the `cap === 3` route.
6. **Threshold derivation is single-PR Riegel, not a real CSS/CP test.** CSS from one swim PR (paces.ts L68–76) is a coarse proxy vs. the true 400/200 CSS test; bike anchors to FTP with no CP/W′ (so no interval-tolerance or end-spurt modeling). **Offer the proper 2-swim CSS test and a bike ramp/20-min FTP protocol in onboarding/testing.**
7. **Taper durations are fixed by distance, ignoring the individual and the evidence's ~2-week optimum.** Olympic taper of **1 week** is short vs. the 8–14 day literature; taper doesn't scale with how fatigued/how trained the athlete is. Race-week floor 0.32 = 68% volume cut, a touch beyond Bosquet's 41–60% (fine for the last days, but it's not derived from the meta-analysis, just chosen).
8. **Durability is touched, not progressed.** One "race effort in final 25%" block in peak isn't a deliberate durability progression (late-session quality, occasional fasted long rides, longer run-off-bike for IM). Long-course durability is under-built.
9. **No environmental layer.** No heat-acclimation block before a hot A-race, no altitude logic, no per-athlete sweat/sodium or programmed gut-training progression toward 90 g/hr. All are real performance/safety levers we ignore.
10. ~~**Brick run is capped short** (`runOff` ≤ 20–30 min). Fine for skill; thin for IM run-off-bike durability.~~ ✅ **Closed 2026-08-10 (#190).** `brickRunOffMin` now scales the ceiling to the race's run leg and **ramps across the build** instead of sitting flat. Measured before: every Ironman brick ran 24 min off the bike in build and 36 in peak, unchanged all block. Measured after: **28 → 39 → 49 → 60 → 70 → 86 min**; 70.3 reaches 61; Olympic 36. Ceilings are ~60% of an Olympic 10 km, ~30% of a 70.3 half, ~25% of an IM marathon — durability work, not a rehearsal of the leg. Rails clean on all three archetypes; invariants in `test/brick.test.ts`.
11. **Recovery-week and deload logic is load-only.** It cuts volume but doesn't guarantee the *removal of intensity* (fillers already ease, but a stacked-quality week could still carry too much hard work into a "recovery" week). Verify recovery weeks actually go easy.

---

## 4. Principles & decision rules — READ THIS BEFORE BUILDING IN THIS REALM

1. **Anchor intensity to thresholds, always.** Bike → %FTP (or CP), run → % threshold pace (or critical speed), swim → CSS. HR and RPE are *backstops*, never the primary target. Never anchor a plan to VO₂max or %HRmax.
2. **Protect the 80% easy.** Whatever else changes, keep ≥~75–80% of *session time* genuinely easy (below LT1 / Z1–Z2). If you add quality, remove it elsewhere. **Compute the realized easy-fraction and treat dipping below ~75% as a bug**, not a feature. "Too spicy" is the #1 way to lose a user (and injure them).
3. **Shape quality by phase, not by a single dogma.** Base = aerobic + technique + a little tempo. Build = **pyramidal**, weighted to the race intensity (70.3/IM: sweet-spot/tempo/threshold; short course: more threshold/VO₂). Peak = sharpen toward **more polarized** race-specific work + race simulation. Don't run a pure-polarized template for a 5-hour race whose intensity is threshold-to-tempo.
4. **Respect the interference effect in scheduling.** Never place heavy lower-body strength on the same day as (or the day before) a key run/threshold session; separate incompatible quality by ≥6 h; do the priority discipline first. In-season strength is a **maintenance** dose (1–2×/wk), tapered out before the race. Prefer strength/power/plyometric over hypertrophy work for triathletes.
5. **3:1 for trained, 2:1 for beginners AND masters AND injury-prone.** Deload = ~40% volume cut, keep a little intensity. If age ≥ ~50 or injury history, force ≤2:1 regardless of declared level, and lower peak-hour density.
6. **Taper by the evidence:** ~2 weeks (scale 7–21 days by distance), reduce **volume 41–60%**, **hold intensity**, keep frequency, cut session *duration*, exponential decay, race-week openers + a rest day before the race. Never cut intensity in the taper.
7. **Progressive overload with a ceiling.** Cap weekly load increases (~10% heuristic; better: keep acute:chronic in ~0.8–1.3). Long sessions grow toward — but never reach — race duration; use the caps.
8. **Bricks are mandatory for tri, in build/peak, and cue the physiology** (short-strided start, cost clears ~min 8–10). For IM, program at least some *long* run-off-bike durability work.
9. **Build durability deliberately for long course:** put quality *late* in long sessions (on tired legs), progress time-at-race-intensity, and use occasional fasted/low-availability aerobic work — *but* gate that behind an energy-availability check (RED-S risk).
10. **Fueling is a trainable system, not an afterthought.** For sessions >2–2.5 h, program toward **~90 g carb/hr** (multiple-transportable, ~2:1 glucose:fructose) via a **gut-training progression** over 6–12 weeks. Rehearse race fueling in long sessions and bricks.
11. **Female physiology: enable, don't prescribe.** Do **not** hard-code universal menstrual-cycle periodization (average effect is trivial; variation is huge). **Do** let athletes optionally track cycle/symptoms and self-adjust, and **do** build an RED-S/low-energy-availability guardrail that can *withhold* load and flag under-fueling. Sex-specific defaults (iron vigilance, W′ ranges, thermoregulation in the luteal phase) are reasonable; sex-specific *mandates* are not.
12. **Masters: recovery is the constraint.** More easy volume, fewer hard days, longer deloads, more strength (anti-sarcopenia), threshold-not-HRmax anchoring (max HR falls ~0.7 bpm/yr).
13. **Environment is a performance and safety variable.** Hot A-race → prescribe a **10–14 day heat-acclimation** block beforehand. Altitude is niche (LHTL 2000–2500 m, 3–4 wks) — inform, don't auto-program. Always surface hydration/sodium/heat safety for hot races.
14. **Keep the plan deterministic and cheap.** The physiology above is *rules*, not an LLM. Encode it in [planEngine.ts](../../lib/planEngine.ts). Reserve any LLM spend for the *briefing text*, never the plan logic — that's the structural cost moat (competitor doc §7B.5).
15. **Base is aerobic-DOMINANT, not aerobic-only.** Measured 2026-08-10: the engine ran base at **100% Z2 — not one tempo, threshold or interval session**, which is stricter than rule 3 above ("base = aerobic + technique + a little tempo") and reads to an athlete as eight identical weeks. Base now carries **one tempo run weekly from base week 3**, plus **sweet spot on alternate weeks** for intermediate+ (Ryan's call, #195 — he asked for "power bike exercises"). Guardrails, all measured:
    - the first **two** base weeks stay purely aerobic — week one of a new plan is the worst possible moment to introduce intensity, and "too spicy too early" is the injury story the whole category is fighting (competitor doc §5 #1)
    - **beginners and anyone at ≤5 sessions/week get tempo only, never sweet spot.** Sweet spot is zoned Z4 here (88–94% FTP straddles Z3/Z4); on olympic/beginner/5 it measured **26.9% block Z4+ against the 25% rail** — caught by `railsRegressed`, not by a user
    - **nothing above Z4 in base.** Threshold and VO2 belong to build
    - realized base distribution after the change: **87.7–90.9% easy**, block Z4+ 12.8–19%, rails clean on every archetype
16. **When the evidence is thin or individual, expose control instead of guessing.** Cycle phase, sweet-spot vs. threshold preference, taper length — where the science says "it depends on the person," give the athlete/calibration loop the lever rather than baking in a false universal.
17. **Train the course, not just the distance — but change the MODALITY, never the dose.** A hilly race and a flat race at the same distance need the same weekly hours and the same intensity distribution; what differs is *where* the quality work happens. Convert existing threshold/VO₂/tempo sessions into their hill equivalents rather than adding sessions or minutes — a hill repeat at threshold *is* threshold work. This keeps the PMC, the 80/20 share and the ramp identical to the terrain-neutral plan, so course-specificity can never smuggle in a load increase. Two hard constraints: **(a) no hill work in the taper** — a novel eccentric stimulus in the last fortnight is how athletes reach a start line with wrecked quads (rule 6 holds intensity, it doesn't add new stress); **(b) no hill work in base or deloads**, whose job is aerobic volume (rule 3). Prescribe climbs by **effort, not pace/power** — riding a climb to a flat power target is the most common way a good race falls apart in T2. Default an unknown course to *rolling*, never flat: assuming flat quietly promises a finish time nobody hits on real terrain.
    - *Provenance:* this rule was added 2026-08-09 (ticket #85) at Ryan's direction. It is **reasoned, not sourced** — the literature here is thin, and the surrounding rules 1–15 are evidence-backed in a way this one is not yet. Implemented in [terrain.ts](../../lib/terrain.ts); the invariants above are enforced in `test/terrain.test.ts`.
    - *Known gap:* sustained **downhill** running is eccentric work and costs more mechanically (bone/tendon) per minute than flat running. [mechanical.ts](../../lib/mechanical.ts) prices impact per minute with **no terrain term**, so a hill run and a flat run look identical to the impact ramp. Adding one would move a safety rail and was deliberately not done as part of a training-content change.

---

## 5. Open questions, gaps & roadmap

**Quick wins (high leverage, engine already close):**
1. **Interference-aware scheduling** — mark leg-strength as conflicting with key run/bike quality in `assignDays`; separate by day or ≥6 h. *(Small change, real physiological correctness.)*
2. **Enforce a realized easy-fraction floor** — compute weekly TID; if easy% < ~75–80%, demote a quality filler. Directly answers Runna's "too spicy" complaint and becomes a *marketing promise*.
3. **Fix the sweet-spot zone label / boundary** (88–94% straddling Z3/Z4) — either a dedicated band or correct the `primaryZone`.
4. **Proper CSS + FTP field tests** in onboarding/testing (400/200 swim; 20-min or ramp bike) instead of single-PR Riegel — better anchors, better plan.
5. **Masters guardrail** — add age; force ≤2:1 deload and trim peak density for ≥~50.

**Bigger bets:**
6. **RED-S / energy-availability guardrail + optional cycle & symptom logging** — the engine must be able to *withhold* load, not only add it. This is both a safety story and a female-athlete-serving differentiator no competitor has.
7. **Deliberate durability progression** for long course — late-session quality, longer IM bricks, gated fasted rides; make "won't blow up" a built feature.
8. **Programmed fueling / gut-training plan** — progress long sessions toward 90 g/hr with rehearsal cues; surface a personalized carb/sodium target.
9. **Heat-acclimation block** auto-inserted before a hot A-race (needs race-location weather — see [05-wearable-and-data-ecosystem.md](05-wearable-and-data-ecosystem.md) for data plumbing).
10. **CP/W′ (bike) and critical-speed/D′ (run) modeling** for interval tolerance, end-spurt, and better durability/pacing prediction — the research frontier, and a "physiology-driven" story vs. Runna.
11. **Optional block-periodization / Norwegian-style controlled-threshold mode** for advanced athletes who can absorb it (with lactate/HR/RPE control) — depth for the committed age-grouper once the base product is solid.
12. **Adaptive taper length** derived from accumulated fatigue and training age rather than a fixed table.

---

## 6. Sources & further reading

**Intensity distribution / polarized vs pyramidal**
- Seiler — *What is best practice for training intensity distribution?* & the 80/20 body of work: [Fast Talk Labs polarized pathway](https://www.fasttalklabs.com/pathways/polarized-training/) *[practitioner]*; [Training intensity distribution among well-trained & elite endurance athletes (PMC)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4621419/) *[primary research]*
- Stöggl & Sperlich (2014) — *Polarized training has greater impact on key endurance variables than threshold, high-intensity, or high-volume training*, Front. Physiol.: [Frontiers full text](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2014.00033/text) *[primary research]*
- Polarized training & VO₂max/economy systematic review (2024, PMC): [PMC11679080](https://pmc.ncbi.nlm.nih.gov/articles/PMC11679080/) *[primary research]*

**Periodization / block**
- Issurin — *Block periodization versus traditional training theory: a review*: [PubMed 18212712](https://pubmed.ncbi.nlm.nih.gov/18212712/) *[primary research]*
- Rønnestad et al. — *No differences between 12 wk block- vs traditional-periodized training in trained cyclists*, Front. Physiol. 2022: [Frontiers](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2022.837634/full) *[primary research]*; block-periodization systematic review & meta-analysis: [OAJSM](https://www.tandfonline.com/doi/full/10.2147/OAJSM.S180408) *[primary research]*

**Taper**
- Bosquet et al. (2007) — *Effects of tapering on performance: a meta-analysis* (the 41–60% volume / 2-week / maintain-intensity findings): [Semantic Scholar](https://www.semanticscholar.org/paper/Effects-of-tapering-on-performance:-a-Bosquet-Montpetit/a41517ab5fa06b92568b861e2b1aa32b3003d214) *[primary research]*
- *Effects of tapering on performance in endurance athletes: systematic review & meta-analysis*, PLOS One 2023: [PMC10171681](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10171681/) *[primary research]*

**Concurrent training / interference**
- Coffey & Hawley (2017) — *Concurrent exercise training: do opposites distract?*, J. Physiol.: [Wiley](https://physoc.onlinelibrary.wiley.com/doi/abs/10.1113/JP272270) *[primary research]*
- *Using Molecular Biology to Maximize Concurrent Training* (AMPK/mTOR mechanism), PMC: [PMC4213370](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4213370/) *[primary research]*

**Critical power / W′ / thresholds**
- Jones et al. — *The "Critical Power" concept and high-intensity exercise performance* (GSSI): [GSSI PDF](https://www.gssiweb.org/docs/default-source/sse-docs/jones_sse_181_v3.pdf) *[primary research]*
- *Application of Critical Power, W′, and its reconstitution* (narrative review), PMC: [PMC7552657](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7552657/) *[primary research]*
- *Critical power and W′ account for training-adaptation variance not captured by VO₂max*, J. Appl. Physiol. 2022: [APS](https://journals.physiology.org/doi/full/10.1152/japplphysiol.00344.2022) *[primary research]*
- CSS test (Wakayoshi method) explainer: [Tri Training Harder — CSS](https://tritrainingharder.com/blog/2013/10/swim-testing-critical-swim-speed.html) *[practitioner]*

**Durability / resilience**
- Maunder et al. (2021) — *The importance of 'durability' in the physiological profiling of endurance athletes*: [PubMed 33886100](https://pubmed.ncbi.nlm.nih.gov/33886100/) *[primary research]*
- Jones (2025) — *Physiological resilience: what is it and how might it be trained?*, Scand. J. Med. Sci. Sports: [Wiley](https://onlinelibrary.wiley.com/doi/10.1111/sms.70032) *[primary research]*
- *Durability improved by both low and high intensity training*, Front. Physiol. 2023: [Frontiers](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2023.1128111/full) *[primary research]*

**Norwegian method / double threshold**
- Marius Bakken — *The Norwegian model of lactate-threshold training*: [mariusbakken.com](https://www.mariusbakken.com/the-norwegian-model.html) *[practitioner]*
- *Norwegian double-threshold method: systematic literature review*: [ResearchGate](https://www.researchgate.net/publication/376465773_Norwegian_double-threshold_method_in_distance_running_Systematic_literature_review) *[primary research]*

**Brick / triathlon transition**
- *Effects of cycling on subsequent running performance, stride length, and muscle O₂ saturation in triathletes*, Sports 2019: [PMC6572577](https://pmc.ncbi.nlm.nih.gov/articles/PMC6572577/) *[primary research]*

**Distance-specific pacing / power**
- *Ironman 70.3 bike pacing (IF / %FTP / NP)* — TrainingPeaks & practitioner guides: [TrainingPeaks 70.3 pacing](https://www.trainingpeaks.com/blog/taking-risks-ironman-70-3-world-championships-bike-pacing/) *[practitioner]*; [Roadman — triathlon FTP pacing](https://roadmancycling.com/blog/triathlon-ftp-pacing-strategy) *[practitioner]*

**Fueling**
- Jeukendrup — *Multiple transportable carbohydrates and their benefits* (GSSI): [GSSI SSE-108](https://www.gssiweb.org/sports-science-exchange/article/sse-108-multiple-transportable-carbohydrates-and-their-benefits) *[primary research]*; [A step towards personalized sports nutrition: carbohydrate intake during exercise, Sports Med](https://link.springer.com/article/10.1007/s40279-014-0148-z) *[primary research]*

**Female physiology / RED-S**
- McNulty et al. (2020) — *Effects of menstrual cycle phase on exercise performance in eumenorrheic women: systematic review & meta-analysis*, Sports Med: [PMC7497427](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7497427/) *[primary research]*
- IOC consensus (2018) — *Relative Energy Deficiency in Sport (RED-S)*: [IOC PDF](https://stillmed.olympics.com/media/Documents/Athletes/Medical-Scientific/Consensus-Statements/REDs/IOC-consensus-statement-Relative-Energy-Deficiency-in-Sport-2018.pdf) *[primary research]*
- Stacy Sims — cycle-based training (practitioner view): [TrainingPeaks — tracking menstrual cycles](https://www.trainingpeaks.com/coach-blog/the-performance-advantages-of-tracking-menstrual-cycles-with-dr-stacy-sims/) *[practitioner]*

**Masters**
- *Decline in VO₂max with aging in master athletes and sedentary men*, J. Appl. Physiol.: [APS](https://journals.physiology.org/doi/abs/10.1152/jappl.1990.68.5.2195) *[primary research]*
- *Impact of training on loss of cardiorespiratory fitness in aging masters endurance athletes*, MDPI 2022: [PMC9517884](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9517884/) *[primary research]*

**Environment**
- Périard et al. — heat acclimation kinetics / cardiovascular adaptations: [Autonomic Neuroscience review](https://www.autonomicneuroscience.com/article/S1566-0702(16)30007-8/fulltext) *[primary research]*; heat-acclimation adaptation-kinetics meta-regression (2025): [PMC12122934](https://pmc.ncbi.nlm.nih.gov/articles/PMC12122934/) *[primary research]*
- Levine & Stray-Gundersen — *Live high–train low increases hemoglobin mass*, J. Appl. Physiol.: [APS](https://journals.physiology.org/doi/full/10.1152/japplphysiol.01284.2005) *[primary research]*

**Practitioner canon (books)**
- Joe Friel — *The Triathlete's Training Bible* *[practitioner]*
- Coggan & Allen — *Training and Racing with a Power Meter* *[practitioner]*
- Laursen & Buchheit — *Science and Application of High-Intensity Interval Training* *[practitioner/primary]*

---

## Related knowledge docs
- [02-training-load-and-readiness.md](02-training-load-and-readiness.md) — quantifying load (TSS/TRIMP/rTSS), CTL/ATL/TSB, acute:chronic workload, HRV, and the readiness layer that should *regulate today's session* (the moat the periodization here sets up).
- [03-injury-and-load-management.md](03-injury-and-load-management.md) — how the load:deload, 80/20, and injury-substitution rules here translate into staying healthy; the ACWR and progression caps live there.
- [04-planning-engine-algorithm-design.md](04-planning-engine-algorithm-design.md) — how to encode all of Section 4's rules deterministically in `planEngine.ts` (phase math, scheduling, interference constraints, TID enforcement).
- [05-wearable-and-data-ecosystem.md](05-wearable-and-data-ecosystem.md) — the sensor data (power, HR, pace, lactate, temperature, cycle-tracking) that would let us measure thresholds, durability, and environment for real.
