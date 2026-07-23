# Behavioral Science, Habit Design & Retention (the knowledge that decides whether AmaTri is a company)

> **What this is.** The canonical reference for how AmaTri *keeps* an athlete, not just how it
> plans for one. The physiology in [01](01-exercise-physiology-and-periodization.md)–[03](03-injury-and-load-management.md)
> and the engine in [04](04-planning-engine-algorithm-design.md) are worth exactly nothing if the
> athlete stops opening the app in week three — which, on the base rates, is what most of them will
> do. This doc covers the brutal retention math of fitness apps, the behavior-change science that
> actually explains adherence (Fogg, Eyal, Ryan & Deci, Lally, Gollwitzer, Milkman/Dai, Prochaska),
> how that science maps onto **our real code** (§3), the metrics that measure whether we're winning
> (§4, incl. a proposed **North-Star**), and a **leverage-ranked feature backlog** (§5). It is a
> sibling to [07-product-and-ux-design.md](07-product-and-ux-design.md) (which owns the *how it
> feels*); this doc owns the *why they come back*.
>
> **Compiled:** 2026-07-22. **Method:** multi-source web research (peer-reviewed behavioral science,
> product-analytics benchmark reports, named case studies) cross-read against the AmaTri codebase
> (`lib/notify.ts`, `lib/social.ts`, `lib/haptics.ts`, `lib/adapt.ts`, `lib/readiness.ts`,
> `lib/stats.ts`, `lib/predict.ts`, `components/onboarding/Onboarding.tsx`, `components/app/*`).
> **Honesty rule:** retention benchmarks are notoriously inconsistent across vendors (Adjust,
> Sendbird, RevenueCat, Business of Apps, Antenna all cut the data differently and rarely agree to
> the point). Figures here are **order-of-magnitude, not gospel** — ranges, dated, sourced. Where a
> claim is folklore (the "21-day habit"), it's flagged as folklore. Sources are listed in §7 and
> cited inline as `[Label]`.

---

## 0. TL;DR — the 14 things that actually matter

1. **Fitness apps have the steepest churn curve in consumer software.** Health-&-fitness D30
   retention is roughly **3–4%** of installs, and subscription churn runs **~8–14%/month**
   (≈**67% annual churn**). You are not fighting for engagement; you are fighting a physics of decay.
   `[Sendbird, RevenueCat, RetentionCheck, BusinessOfApps]`
2. **The single most predictive churn signal is the first two weeks.** Users who complete **fewer
   than 3 workouts in their first 14 days churn at 3–4× the rate** of those who form a weekly habit.
   Activation is a two-week race, and it's the game. `[RetentionCheck]`
3. **Seasonality is a scythe.** Massive January sign-up spike → **40–60% cancel by February**.
   Build for the Q2 collapse, and *exploit* temporal landmarks (New-Year, Monday, birthday,
   post-race) as re-engagement fuel — the **Fresh-Start Effect** is real (gym visits +33% at the
   start of a new week). `[RetentionCheck, Dai-Milkman-Riis]`
4. **Behavior = Motivation × Ability × Prompt (Fogg's B=MAP).** When an athlete skips, the failure
   is almost never "low motivation" — it's a missing prompt or too-high friction. **Design for
   Ability and Prompts; do not try to out-motivate life.** `[Fogg]`
5. **The habit takes ~66 days, not 21.** Lally 2010: median **66 days** to automaticity, range
   **18–254**, and only ~48% got there. The "21 days" number is a **myth** (misread from a 1960
   plastic-surgery book). Our retention model must assume the habit isn't set until ~week 9. `[Lally]`
6. **Self-Determination Theory is the load-bearing framework for endurance sport.** Long-term
   adherence is driven by **intrinsic** motivation, which requires **autonomy, competence,
   relatedness**. Extrinsic carrots (badges, points) predict *short-term* adoption but can **crowd
   out** the intrinsic drive that keeps age-groupers training for years. `[Ryan-Deci, Teixeira, Wikipedia-Overjustification]`
7. **Streaks are the most powerful — and most dangerous — retention primitive.** They work via
   **loss aversion** (a 180-day-streak user is protecting 180, not chasing 181). Duolingo built a
   $14B business substantially on them. But past ~30 days they curdle into **anxiety and
   guilt-driven compulsion**, and a hard reset to zero triggers the **"broken-streak → quit" cliff.**
   Copy the mechanic; copy the *forgiveness* (freeze / earn-back) even harder. `[Shuttleworth, UXMag]`
8. **Forgiving plans beat rigid plans.** Athletes miss sessions for time, fatigue, weather, life —
   not weakness. A plan that **absorbs a miss and reschedules** retains; a plan that leaves a red
   "FAILED" and craters the week teaches learned helplessness → churn. This is already AmaTri's
   design philosophy in `lib/adapt.ts` — it is a *retention* feature, not just a planning one.
9. **The Hooked loop (Trigger → Action → Variable Reward → Investment) is the engagement engine.**
   Our reward is under-built (praise is only mildly variable) and our **external trigger is broken
   on iOS** — see #12. `[Eyal]`
10. **Show value before the ask.** Runna's onboarding puts a personalized finish-time and a first
    easy run *before* the paywall. **We already own the engine** (`lib/predict.ts` → the "projected
    finish" card in `ReviewStep`). Time-to-value is a conversion lever we've half-pulled.
11. **The North-Star should be completed training, never logins.** Proposed NSM:
    **Weekly Adherent Athletes** — athletes who complete **≥60% of that week's planned sessions
    (min 2).** It captures the value moment, is the right cadence for a weekly sport, and is a
    leading indicator of both fitness *and* subscription survival (§4).
12. **Our biggest retention hole is the notification channel.** `lib/notify.ts` uses the
    **Notification Triggers API — Chromium/Android only.** On **iOS Safari (the age-grouper's
    phone), scheduled reminders silently do not fire.** The primary habit *Prompt* is missing for a
    huge share of users. This is the #1 backlog item.
13. **The coach voice is a retention lever, not decoration.** Empathy after a missed session,
    calibrated praise, "the plan adjusts to *you*" — this is how you deliver **competence +
    relatedness** (SDT) at software scale. Our `app/api/coach/route.ts` system prompt already nails
    the tone ("never hype, no 'crush it'"). We under-use it: it's reactive chat, never a proactive nudge.
14. **Instrument or fly blind.** There is currently **no analytics/event layer** in the repo. You
    cannot compute a single retention curve, activation rate, or North-Star number today. Nothing in
    §4/§5 is measurable until this exists. It is the true prerequisite.

---

## 1. The brutal baseline — why fitness-app retention is a bloodbath

Internalize the base rates before designing anything. Optimism here is fatal.

### 1.1 Install-level retention (free / top-of-funnel)
Consumer mobile retention decays viciously, and **Health & Fitness is at the harsh end**:

| Metric | Health & Fitness (typical) | "Competitive" bar | Note |
|---|---|---|---|
| **D1** (came back next day) | ~20–27% | >~15% is competitive | ~1 in 4 users never open an app a second time at all `[Sendbird, core-mba, Localytics-folklore]` |
| **D7** | ~7–9% (some cohorts to low-teens) | low-teens is healthy | The cliff has already happened by here |
| **D30** | ~3–4% | >3% *outperforms* the category | This is the number that predicts product-market fit `[Prooflytics, Amplitude-7pct]` |

Rules of thumb from the analytics literature: **D30 ≈ half of D7**; an app at ~30% D7 tends to land ~15–20% D30 `[Sendbird]`. Amplitude's **"7% rule"**: if your retention curve hasn't *flattened* above ~zero by the time it stabilizes, you don't have PMF — a flat, non-zero asymptote is the signal you retain a real core `[Amplitude-7pct]`.

**The shape matters more than any single day.** A healthy curve **flattens** at a non-trivial floor; a great one **smiles** (churned/lapsed users resurrect as the product improves or the network pulls them back) `[Sequoia-Retention, IndieHackers-Smile]`. For AmaTri the smile is *structurally available* — a triathlete finishes a race, lapses, then comes back for the next season. Designing the **post-race re-entry + next-race** loop is how you manufacture a smile instead of a cliff.

### 1.2 Subscription-level churn (the number that pays salaries)
Free-install retention is vanity next to *paid* retention. Here it's brutal but the *revenue* is real (Health & Fitness monetizes better long-term than almost any category):

- **Median subscription-app monthly churn ≈ 13–14%** across categories → the median app **replaces its entire subscriber base every ~7–8 months** `[RevenueCat]`.
- **Fitness-specific monthly churn ≈ 9.2% (~68% annual)** in 2026 data `[RetentionCheck]`; independent estimates put **annual retention for health-&-fitness subscriptions ≈ 33%** (i.e., ~67% annual churn) `[BusinessOfApps/Antenna]`.
- Public benchmark: **Peloton app** disclosed **8.4% monthly churn** (Q4 2024) — and that's a category *leader* with hardware lock-in `[Peloton-SEC]`.
- **Trial-to-paid** median ≈ **50–60%**; Health & Fitness uses **longer trials (5–9+ days)** because value takes time to feel `[RevenueCat, Adapty]`.
- **Cohort churn hits hardest in month 3** `[RevenueCat]` — the honeymoon fades, the first race is often past, and the plan can feel like a treadmill. Month 3 is a designed-intervention moment, not an accident.

### 1.3 The seasonality scythe (January in, February out)
Fitness demand is violently cyclical: a **January sign-up spike** (New-Year resolutions) followed by **40–60% cancellation by February**, then a long **Q2 sag** `[RetentionCheck]`. Two implications:
- **Don't read January cohorts as your true baseline** — they're inflated with low-intent "resolution" users who will churn regardless. Judge health on *cohort quality*, not raw signups.
- **Turn the calendar into a weapon.** The same seasonality is the **Fresh-Start Effect** (§2.8): people act on aspiration at temporal landmarks. Every Monday, month-start, birthday, and post-race is a *free re-engagement trigger* — if you have the notification channel to fire it (we mostly don't yet; §3.4).

### 1.4 Why physiology is worthless without adherence
A perfectly periodized 16-week Ironman build (engine: [04](04-planning-engine-algorithm-design.md)) that the athlete abandons in week 3 produces **zero fitness and zero revenue.** Adherence is the *only* path by which our physiology creates value. Framed sharply: **AmaTri's product is not "a good plan" — it's "a plan you actually complete."** Every section below is in service of that sentence.

---

## 2. The behavior-change canon (the frameworks that explain adherence)

These are the named, evidence-backed models a growth/retention practitioner reasons with. Each ends with **→ AmaTri implication.**

### 2.1 The Fogg Behavior Model — B = MAP
BJ Fogg (Stanford Behavior Design Lab): a behavior occurs only when **Motivation, Ability, and a Prompt converge in the same moment**; if any is missing, no behavior. The central, counter-intuitive insight: **increasing Ability (making it easier) is almost always more effective and durable than pumping Motivation** `[Fogg]`. Motivation is a wave — it spikes at signup and after inspiration, then recedes; you cannot bank on it. His **Tiny Habits** recipe — *"After [anchor], I will [tiny behavior], then [celebrate]"* — engineers each variable: anchor = Prompt, tiny behavior = Ability, celebration = Motivation reinforcement `[Fogg, GoalsAndProgress]`.

- **→ AmaTri:** When an athlete misses a session, resist the urge to *motivate harder* ("crush it!"). Instead **lower Ability cost** (one-tap "move to tomorrow," swap a hard session for easy, shorten it) and **fix the Prompt** (a reliable, well-timed reminder — which we currently can't deliver on iOS). Our `swapDiscipline` / `moveWorkout` / `easeUpcoming` in `lib/adapt.ts` are *Ability* levers. Our missing push channel is a *Prompt* failure. Celebrate immediately on completion (we do — `Celebration.tsx` + `haptic('success')`).

### 2.2 The Hooked Model — Trigger → Action → Variable Reward → Investment
Nir Eyal's four-phase loop for habit-forming products `[Eyal, Amplitude-Hook]`:
1. **Trigger** — external (notification, email) that hands off, over time, to **internal** triggers (an emotion: "I'm stressed, I'll go train"). The goal is to graduate the user from external to internal.
2. **Action** — the simplest behavior done in anticipation of reward (open app → see today's session → tap "Done"). Governed by B=MAP.
3. **Variable Reward** — reward with *variability* sustains engagement (Skinner's intermittent reinforcement; dopamine responds to *surprise*). Predictable rewards habituate and go flat.
4. **Investment** — the user puts something *in* (data, streak, PR history, followers) that (a) makes the next loop easier/better and (b) raises switching cost.

- **→ AmaTri, honestly assessed:**
  - **Trigger:** external is *broken on iOS* (§3.4); internal trigger ("what's my session today?") exists but relies on the user self-initiating.
  - **Action:** strong — the app answers "what do I do today" in one screen (`TodayTab`).
  - **Variable Reward:** *weak.* Our praise strings rotate (`CheckinSheet` `PRAISE[]`) and celebrations fire on milestones (`stats.ts` `celebrationFor`), but the reward is largely **predictable**. There's a real opportunity for *variable* surprise-and-delight (unexpected coach note, a "you just beat your 10k split from 6 weeks ago" you didn't ask for).
  - **Investment:** *good and compounding* — banked hours, streak, PR history, readiness log, a fitness curve, and followers all accrue (`stats.ts`, `social.ts`). Every logged session makes the plan smarter (`calibrate.ts`) — a virtuous investment loop. **Lean into showing the athlete their accumulating investment** ("142 sessions banked · 87 hours · you'd have paid a coach $X").

### 2.3 Habit formation: cue → routine → reward, and the ~66-day reality
Habits are learned **cue → routine → reward** loops (Duhigg's popularization of the basal-ganglia loop). The durable-habit question — *how long?* — has a real answer and a famous myth:
- **Myth:** "21 days." This traces to Maxwell Maltz's 1960 *Psycho-Cybernetics* observing patients took *"a minimum of about 21 days"* to adjust to a new face — an anecdote, not a study. It is **folklore.**
- **Evidence:** **Lally et al. (2010, *Eur. J. Social Psych.*)** tracked 96 people forming a daily habit: **median 66 days to automaticity, range 18–254**, and **only ~48% reached the plateau** at all `[Lally]`. Simple behaviors (a glass of water) automate faster than complex ones (a 50-minute run). Crucially, **missing one day did not measurably harm** the formation trajectory — a single lapse is not fatal. This is the empirical backbone of "forgiving plans."

- **→ AmaTri:** Our retention model must assume **the habit is not set until ~week 9**, i.e., across the exact window (month 2–3) where subscription churn peaks. Two design consequences: (1) **the first ~9 weeks need the most scaffolding** (prompts, streaks, coach touch); (2) **one missed day must never read as failure** — Lally says it doesn't matter; our streak logic already encodes this (`stats.ts`: a rest day is "kept," today stays "pending," a single planned-but-undone day breaks it only in the *past*). Good instinct; extend it (streak freeze) in §5.

### 2.4 Implementation intentions & habit stacking (the cheapest adherence win in the literature)
**Implementation intentions** (Gollwitzer): pre-committing *when, where, and how* — an **"if [situation], then [behavior]"** plan — dramatically raises follow-through. The Gollwitzer & Sheeran (2006) meta-analysis: **94 studies, 8,000+ participants, effect size d ≈ 0.65** (medium-large) *on top of* existing goal intentions `[Gollwitzer-Sheeran]`. For *physical activity* specifically the effect is real but more modest and stronger when paired with reinforcement `[PLOS-One-PA]`. **Habit stacking** (anchoring a new behavior to an existing routine — "after my morning coffee, I lay out my kit") is the Tiny-Habits operationalization.

- **→ AmaTri:** We ask *how many* sessions per week (`FrequencyStep`) but **never ask when/where.** Adding a lightweight "**When will you usually train? (morning / lunch / evening) and where?**" step turns each planned session into an if-then plan and lets reminders fire at the *right* moment (also feeding send-time optimization). This is a **high-leverage, low-effort** backlog item (§5) — one of the best-evidenced interventions in all of behavior change, and we collect *none* of it today.

### 2.5 Self-Determination Theory (SDT) — the framework that matters most for endurance
Ryan & Deci: motivation lies on a continuum from **amotivation → extrinsic → intrinsic**, and self-determined (autonomous) motivation requires three basic psychological needs `[Ryan-Deci]`:
- **Autonomy** — acting from personal choice, not coercion.
- **Competence** — feeling effective, making visible progress.
- **Relatedness** — feeling connected to others.

The exercise-domain evidence is specific and useful `[Teixeira-2012, Edmunds]`:
- **Identified regulation** ("I train because being fit matters to me") best predicts **short-term adoption**;
- **Intrinsic motivation** ("I train because I love it") best predicts **long-term maintenance** — *exactly the retention window that kills fitness apps.*
- **How to feed each need in-product:** Competence ← **structure, positive feedback, realistic goals**; Autonomy ← **meaningful choices, minimal pressure, rationale-giving**; Relatedness ← **connection, belonging, being seen.**

- **→ AmaTri (this is our deepest moat, framed correctly):**
  - **Competence** is our strongest card: a *realistic, achievable* plan (the injury-aware, 80/20-disciplined engine that *won't* leave you cooked), visible progress (`ProgressTab` fitness curve, PRs, banked hours), calibrated pace targets that *update as you improve* (`calibrate.ts`), and honest praise. **Every "your plan adjusted because you're ahead / because you were sore" message is a competence hit.**
  - **Autonomy** is served by *choice with rationale*: "Let AmaTri decide" vs "I'll choose" (`FrequencyStep`), swap/move/skip verbs, weakness focus, rest-day preference. **The forgiving plan is autonomy-support in code** — it treats the athlete as a competent adult managing a life, not a soldier who failed inspection.
  - **Relatedness** is our **weakest** need today: `FriendsTab` (follow, kudos, race cohort) is nascent and requires knowing usernames. The "coach relationship" (§2.9, §3.5) is the other relatedness channel and is under-exploited.
  - **Beware over-extrinsic-ifying.** SDT's dark warning: piling on badges/points/streaks can **crowd out** the intrinsic love of training (§2.7). For serious age-groupers this is a real risk — they don't want to feel *gamed.* Reward *mastery and meaning*, not just compliance.

### 2.6 Transtheoretical Model (Stages of Change) — meet the athlete where they are
Prochaska & DiClemente: change moves through **Precontemplation → Contemplation → Preparation → Action → Maintenance**, with **Relapse** an expected part of the cycle (on relapse, **~85% fall back only to Contemplation/Preparation, not all the way to Precontemplation**) `[Prochaska, RuralHealthInfo]`.

- **→ AmaTri:** A triathlete who signs up for a 70.3 is already in **Preparation/Action** — unusually far along vs a generic fitness app (an advantage: our users self-select into intent). The design job is **Maintenance and graceful Relapse handling.** When someone lapses for two weeks, they have *not* reverted to zero motivation — meet them at "Preparation" with a *"let's realign your plan to today"* (`rebuildFromToday` already does this beautifully) rather than a guilt trip or a from-scratch restart. **Relapse is a stage to design for, not a failure to punish.**

### 2.7 Loss aversion, streaks & endowed progress (power tools with sharp edges)
- **Loss aversion** (Kahneman & Tversky): losses hurt ~2× as much as equivalent gains feel good. **Streaks weaponize this** — a 180-day Duolingo user is motivated by *not losing 180*, far more than by *reaching 181* `[Shuttleworth]`. Duolingo grew DAU from ~5M (2020) to **~47.7M (2025)** with ~10.9M paid subs, and ran **600+ experiments on streaks alone** `[Shuttleworth, Trophy]`.
- **Streak forgiveness is the craft.** Duolingo found that *selling* streak freezes cheapened them; **"Earn Back"** (re-earn a lost streak by doing extra) retained better because it preserved the *feeling of having earned it* `[Shuttleworth]`. The lesson: **protect the streak, but make forgiveness feel earned, not bought.**
- **The dark side (take seriously).** Streaks are strongest in the **first ~30 days**; past that they curdle into **anxiety, guilt, and compulsion** — a documented pattern where the app is used *to avoid a bad feeling*, not for joy `[UXMag, TheBrink]`. A hard reset-to-zero is the **"broken-streak → quit" cliff**: the endowment is gone, so why continue? For an *injury-aware* brand, a streak that guilts a sore athlete into training is **directly counter to our promise.**
- **Endowed progress effect** (Nunes & Drèze): people are more motivated to finish a goal they've been given *artificial* early progress on (a loyalty card pre-stamped with 2 of 10 feels closer than 0 of 8). Framing a plan as "**you're already 15% of the way to the start line**" beats "0/112 sessions."

- **→ AmaTri:** We have streaks (`stats.ts`), milestones, and celebrations — good. **We do not have a streak freeze / earn-back / rest-day-aware protection** beyond "rest days count as kept." Add **forgiveness mechanics** (§5) *before* leaning harder on streaks, or we'll manufacture the exact injury-guilt our brand exists to prevent. **Cap streak salience** for serious athletes (surface consistency as a *trend*, not a fragile number that screams). Use **endowed progress** framing on the plan ("15% to race day").

### 2.8 The Fresh-Start Effect & temporal landmarks
Dai, Milkman & Riis (2014, *Management Science*): people pursue aspirational behavior more right after **temporal landmarks** that create a "new mental accounting period" — relegating past failures to the old self. Field evidence: **gym visits +33.4% at the start of a new week**, diet searches **+82.1% at the start of a new year** `[Dai-Milkman-Riis]`.

- **→ AmaTri:** Fresh starts are **free re-engagement triggers.** Every Monday ("new training week"), month-start, birthday, *and especially post-race* ("your next chapter") is a moment to re-activate a lapsing athlete — *if* we can reach them. Frame plan *rebuilds* as fresh starts, not admissions of failure. Ties directly to the seasonality point (§1.3): don't just survive January, ride every small landmark.

### 2.9 Temptation bundling, commitment devices & accountability
- **Temptation bundling** (Milkman, Minson & Volpp): pair a "should" (train) with a "want" (a page-turner audiobook allowed *only* at the gym). Result: **+51% gym visits** (full treatment) initially, **decaying over time** (esp. after holidays), but **61% chose to pay for the commitment device** afterward `[Milkman-Volpp]`. Honest read: real effect, **decays**, but reveals genuine demand for self-control tools.
- **Commitment devices** (stickK, Beeminder): pre-committing money/reputation to a goal. Powerful for the already-motivated; can backfire (or feel coercive) if over-applied — an **autonomy risk** under SDT.
- **Accountability** is the throughline of why human coaching works: someone is *watching and cares.* It's a **relatedness** delivery mechanism. Runna's #1 structural gap is **no default human accountability** (per [runna-competitive-analysis.md](../research/runna-competitive-analysis.md) §5.7).

- **→ AmaTri:** The **coach voice** (§3.5) is our software-scale accountability proxy — "your coach noticed you missed two swims" is relatedness + accountability at ~$0. **Social accountability** (a training partner sees your feed; "3 others training for your race") is the other channel (`social.ts`). Temptation bundling is a lighter-weight idea (e.g., "pair your turbo sessions with a show") — nice-to-have, not core. Avoid heavy financial commitment devices; they clash with our autonomy-supportive, injury-kind brand.

### 2.10 Social proof, network effects & UGC
Cialdini's **social proof** ("others like me are doing this") plus **network effects** are retention multipliers. Strava is the canonical case: **social visibility changes consistency** — people who know their training is *seen by people whose opinion matters* behave more consistently. Data point: apps with **social streaks average 5.69-day streaks vs 4.25 without**; Strava users engage **35+ times/month**, driven by kudos/segments/clubs `[Strava-StriveCloud, Trophy-Strava, Tapestry]`. The flip side: network effects are a **cold-start problem** — thin networks don't retain.

- **→ AmaTri:** Social proof is *already* in onboarding-adjacent copy ("N others training for [race]," `social.ts` cohort) and is Runna's proven lever. But our social graph is **empty at cold-start** and **hard to populate** (username-only add). Relatedness/network is our biggest *upside* and biggest *build* — see §5.

---

## 3. AmaTri's retention surface, assessed against the science (code-grounded)

What habit machinery actually exists in the repo today, mapped to the frameworks above, with the honest gaps.

### 3.1 Activation & onboarding — time-to-value and the first-workout race
**What exists (strong):**
- **Welcome (`WelcomeScreen.tsx`)** — a promise-first hero ("Every stroke, pedal, and stride — *planned*"), a self-drawing swim→bike→run route, a single CTA ("Create your plan"). Low-friction, confidence-first — the right *tone* (matches Runna's "design for confidence, not speed").
- **Onboarding (`components/onboarding/Onboarding.tsx`)** — ~10 adaptive steps (race → [custom] → [date] → level → frequency → strength → schedule → PRs → injuries → review), with a **progress bar** and steps that **skip when inapplicable** (real event carries its own date). Good Ability design (steppers, presets, chips, "let AmaTri decide" defaults).
- **★ Value-before-account, value-before-paywall.** The **plan is generated *before* the account is created** — the account is the *last* step (`AccountStep`), after the athlete watches the plan "forge" (`LoadingAnimation`). This is the single best conversion pattern (show the outcome, then ask). We do it.
- **★ The finish-time hook is built.** `ReviewStep` renders `projectRace()` (`lib/predict.ts`): *"Your projected finish: X:XX — about N faster than racing at today's fitness."* This is Runna's highest-leverage conversion moment, and **we own the engine.** It delivers *competence* (SDT) and *time-to-value* before any commitment.
- **Injury intake** (`InjuriesStep`) — free-text → AI-parsed injuries → visible "we'll train around" list. This is a **trust/competence** moment unique to us (Runna has nothing like it).

**Gaps / risks (activation is the whole ballgame — §0.2):**
- **No when/where question** → no implementation intentions, and reminders can't be well-timed (§2.4). *High-leverage miss.*
- **No guaranteed, friction-free *first workout* moment.** Runna previews an achievable first easy run and explains the run *types*. We drop the athlete into a full plan; the **first completed session** (the true activation event) isn't explicitly engineered or celebrated as "day one." **The activation metric should be "first session completed," and onboarding should sprint toward it.**
- **No activation instrumentation.** We cannot currently measure onboarding completion rate, step drop-off, or time-to-first-workout. (See §3.6.)
- **No trial/paywall exists yet** (consistent with the runna doc's roadmap) — so trial-to-paid isn't yet a lever we can pull or measure.

### 3.2 The forgiving, adaptive plan — adherence as a first-class feature
**What exists (this is our differentiated retention core, in `lib/adapt.ts` + `lib/readiness.ts`):**
- **A single miss is absorbed, not crammed** (module doc: *"a single miss is absorbed, not crammed; skip vs move are distinct"*). This is the anti-"broken-week-cliff" design.
- **Distinct verbs for life:** `moveWorkout` (will do later), `setStatus`/skip (won't do), `swapDiscipline` (do a different sport — undoable), `logInstead` (did something else), `easeUpcoming` (dial back hard sessions), `rebuildFromToday` (realign to still hit race day, **preserving history/streaks/PRs**). These are **Ability levers** (B=MAP) and **autonomy-support** (SDT) in code.
- **★ Closed-loop adaptation** (`assessAdaptation`): reads the trailing two weeks and offers to **ease** the next week if the athlete missed ≥40% or sessions felt consistently hard — or an **"ahead"** encouragement (deliberately *without* piling on load, "that's how people get hurt"). **This is the "the plan adjusts to you" promise made real** — a competence + relatedness signal Runna is criticized for lacking.
- **★ Daily readiness** (`lib/readiness.ts` + `ReadinessSheet.tsx`) — a 10-second morning check (sleep/legs/energy) that **auto-eases today's hard session when readiness < 45.** The toast — *"Rough morning noted — we softened today's hard work"* — is a textbook competence/relatedness/injury-kindness moment, and **the exact thing Runna never did** (per the competitive doc, their #1 complaint).

**Gaps:**
- **Adaptation is user-triggered, not proactive.** `assessAdaptation` surfaces a suggestion, but nothing *reaches out* after a rough patch (no notification, no coach nudge). The moat only works if the athlete *sees* it — and our reach channel is broken (§3.4).
- **No explicit missed-session recovery moment.** After a skip, there's no gentle, immediate "no problem — want to move it to tomorrow?" prompt. The verbs exist; the *proactive offer* doesn't.

### 3.3 Streaks, milestones, celebrations & progress (the reward layer)
**What exists (`lib/stats.ts`, `Celebration.tsx`, `CheckinSheet.tsx`, `TodayTab.tsx`):**
- **Forgiving streak** (`computeStreak`): rest days count as "kept," **today stays "pending"** (a not-yet-done today never breaks the streak), only past undone days break it. Shown on Today, Check-in, and friends' cards. **This is already Lally-aligned forgiveness** — good.
- **Milestone celebrations** (`celebrationFor`): streak milestones (3,5,7,10,14,21,30,50,75,100), **first brick** ("you've unlocked your bike-to-run legs" — a lovely sport-specific rite), and **new-longest-session PRs.** Paired with a tasteful confetti **`Celebration`** burst and **`haptic('success')`** — multi-sensory reward.
- **Investment/progress** (`ProgressTab` via `trainingStats`): an EWMA **fitness curve**, banked hours/count, biggest week, longest session. Strong **investment** surface (Hooked) and **competence** surface (SDT).
- **Calibrated, variable praise** (`CheckinSheet` `PRAISE[]`, rotated) — light variability.

**Gaps (against §2.7):**
- **No streak protection beyond rest days** — no freeze, no earn-back, no "you were sick, we held it." A genuine multi-day life event (travel, illness) **resets to zero → quit cliff.** Highest-value forgiveness gap.
- **Reward is mostly *predictable*** (Hooked's variable-reward is under-built). Milestones are fixed thresholds; praise is a small fixed set. Opportunity for genuine *surprise* (unexpected PR callouts, "6 weeks ago this pace was your threshold — today it's easy").
- **Streak could over-pressure serious athletes** — keep it a *trend/consistency* story, not a fragile number that induces guilt (brand risk for an injury-aware app).

### 3.4 Notifications & re-engagement — the broken Prompt (our #1 hole)
**What exists (`lib/notify.ts` + `Notifications.tsx`):**
- Local **training reminders** via the **Notification Triggers API (`TimestampTrigger`)** — schedules the next ~4 days of "Time to train" nudges at a user-chosen hour, idempotent per-day tag, only for days with an unfinished session.

**The problem (severe):**
- **`TimestampTrigger` is Chromium/Android-only.** The code **explicitly no-ops on iOS Safari and Firefox** (`triggersSupported()` gate; the UI even says *"Scheduled reminders fire on Chrome/Android. On iOS they'll arrive once web-push support lands"*). **For the iPhone-carrying age-grouper — our core user — the primary habit Prompt does not fire.** In B=MAP terms, the Prompt is *absent*, so the behavior doesn't occur regardless of motivation/ability.
- **No server-side push at all.** There is a Strava webhook but **no web-push subscription, no push service, no VAPID, no scheduled server jobs.** So: no re-engagement pushes, no win-back, no fresh-start nudges, no proactive readiness/adaptation prompts. The entire **external-Trigger** stage of the Hooked loop is missing for most users.
- **iOS PWA web push has been possible since iOS 16.4 (2023)** for *installed* PWAs — so this is a **buildable gap**, not a platform impossibility. It is the highest-leverage retention investment we can make (see §5).

**Also missing:** any **email/lifecycle** channel (welcome, onboarding-incomplete, first-workout nudge, week-1 recap, missed-session, win-back, race-week hype, post-race re-entry). Lifecycle messaging is the backbone of subscription retention and we have *none.*

### 3.5 The coach voice — accountability & relatedness at software scale
**What exists (`app/api/coach/route.ts`, `CoachSheet.tsx`, `lib/adapt.ts` `summarizeForCoach`):**
- A **cheap, optional AI coach** (Haiku/Gemini flash-lite, ~fraction-of-a-cent/call, 40/hr rate-limited). The **system prompt is excellent tone design**: *"encouraging… never hype… no 'crush it', no exclamation-mark spam… motivate through clarity and respect… you are not a doctor."* Grounded in the athlete's real data (`summarizeForCoach`: race, phase, today's session, injuries).
- Empty-state **starter prompts** anchored to today's session ("How should I pace my [today's workout]?").
- **AI-written "why this plan" summary + per-phase notes** (`apiPlanSummary`, enriched post-build) — a competence/rationale (autonomy-support) surface.

**Why this matters:** The coach voice is our **relatedness + accountability** delivery mechanism — the thing Runna is dinged for lacking (no default human coach). Empathy after a miss, calibrated praise, and "the plan adjusts to *you*" are *retention* copy, not decoration. Tone is a lever: research on notifications and coaching shows *respectful, personalized, specific* messaging outperforms hype `[Braze, MoEngage]`.

**Gaps:**
- **The coach is purely reactive (chat).** It never *initiates* — no proactive "noticed you were sore, today's easy" or "two swims missed, want to rebalance?" A proactive coach note (delivered via the push channel we lack) would convert the coach from a *tool* into a *relationship.*
- **The rich `summarizeForCoach` / adaptation context is under-broadcast** — it powers chat answers but not lifecycle touches.

### 3.6 Instrumentation — the silent blocker
There is **no analytics/event-tracking layer** in the repo (no Amplitude/Mixpanel/PostHog, no event schema, no cohort tooling). Consequences:
- **We cannot compute a single number in §4** — not a retention curve, not activation rate, not North-Star, not step-level onboarding drop-off, not notification opt-in, not churn.
- Every experiment in §5 is **un-measurable** until this exists. **This is the true prerequisite** — it's cheap, it's foundational, and nothing else can be optimized without it. It belongs at the top of the backlog alongside push.

### 3.7 Haptics & micro-feedback
`lib/haptics.ts` provides semantic tactile feedback (`success`, `select`, `warning`, etc.), honoring reduced-motion and no-op on unsupported hardware. Fired at completion, selection, and milestones. This is **competence-signal polish** (the app *feels* responsive and rewarding) — a small but real contributor to the reward layer and perceived quality (which feeds "quality retention").

---

## 4. Measuring retention — loops, curves, and AmaTri's North-Star

You cannot manage what you don't measure, and for a **weekly-cadence sport** the standard SaaS metrics need translation.

### 4.1 The metric families to track
- **N-day (classic) retention** — % of a cohort active on exactly day N. Standard, but **too strict for a weekly sport** (a triathlete training Tue/Thu/Sat is *perfectly adherent* yet "inactive" on D-many). Use it for install-level health, not as the core.
- **Unbounded / rolling retention** — % active *on or after* day N. Kinder to irregular cadence; better for us than strict N-day.
- **Bracket / weekly retention** — % of a cohort active in **week N.** **This is the right primary cadence for AmaTri.** WAU (weekly actives) and week-over-week retention beat DAU here.
- **Stickiness (DAU/MAU)** — good for daily apps (messaging 50%+, gaming 20–50%). For a weekly sport, **WAU/MAU is the honest stickiness ratio** — expect and target something healthy on a *weekly* basis, not a Duolingo-style daily one. Don't cargo-cult DAU/MAU.
- **The retention *curve shape*** — is the north star of diagnosis: does it **flatten** (you have a core), and does it **smile** (resurrection)? (§1.1) `[Amplitude-7pct, Sequoia-Retention]`.
- **Subscription retention / churn** — monthly logo churn, trial-to-paid, month-3 survival, LTV. The revenue truth.
- **Quality vs feature vs network retention** (Reforge framing): *quality* (does the core loop keep working), *feature* (does a specific feature retain its adopters), *network* (do connected users retain better). Track social-connected vs solo cohorts explicitly — SDT predicts connected retains better.

### 4.2 Leading indicators (predict churn early — act in the 2-week window)
- **Activation:** *first session completed within 48h of signup* (the true aha), and *≥3 sessions in first 14 days* (the empirically strongest early signal — sub-3 churns 3–4×) `[RetentionCheck]`.
- **Habit-window survival:** still adherent at week 9 (the Lally horizon).
- **Engagement depth:** post-session check-ins logged, readiness check-ins, coach interactions, follows/kudos.
- **Adaptation usage:** did a lapsing athlete *use* a move/swap/ease/rebuild rather than silently churn? (A "used forgiveness" event should predict *higher* retention — verify.)
- **Notification opt-in %** and **notification → session conversion.**

### 4.3 Proposed North-Star Metric (NSM)
> **North-Star: Weekly Adherent Athletes (WAA)** — the count of athletes who **complete ≥60% of that week's planned sessions (minimum 2 completed)** in a given week.

Why this and not the alternatives:
- **It is the value moment, not a vanity proxy.** Logins, opens, and DAU measure *presence*; WAA measures *training actually done* — the thing that produces both fitness and the felt value that renews a subscription. ("Completed workouts / weeks-adhered, not logins.")
- **Right cadence.** A weekly window fits triathlon's rhythm; "≥60%, min 2" tolerates a normal missed session (forgiveness, Lally) without rewarding a single token workout.
- **Leading indicator of the business.** WAA is upstream of subscription retention (adherent athletes renew) and of the fitness outcome (adherent athletes get faster → competence → intrinsic motivation → stay). It aligns the whole team on *helping athletes train*, which is the honest mission.
- **Composable** (breadth × depth × value, Amplitude-style): breadth = # athletes; depth = sessions completed; value = % of plan honored.

**Supporting / input metrics (the tree under the NSM):**
- **Activation rate:** % of new athletes with **first session completed ≤48h** and **≥3 sessions in 14 days.**
- **W1→W2→…→W9 cohort retention** (the habit-formation ramp) + curve-flattening check.
- **Plan adherence %** distribution (per athlete per week).
- **Resurrection rate:** % of lapsed (2+ inactive weeks) athletes who return to WAA (the smile).
- **Notification opt-in %** and **prompt→session conversion.**
- **Social-connected cohort retention vs solo** (network-retention check).
- **Subscription:** trial-to-paid, monthly churn, month-3 survival, LTV.

**Guardrail metrics (so we don't dark-pattern our way to the number):**
- **Injury/overtraining self-reports & "felt hard" RPE trend** — WAA must not be bought by pushing sore athletes (that betrays the brand and, per §2.7, backfires).
- **Notification opt-out / uninstall after push** — Prompt fatigue check.
- **Streak-anxiety proxy** (sessions completed *late at night* or self-reported "only did it for the streak") — watch for compulsion.

### 4.4 The retention loop to engineer
The compounding loop we want: **complete a session → visible progress + honest praise + accruing investment (streak, banked hours, PR, sharper paces) → coach/social reflection → well-timed prompt for the next session → complete it.** Today the loop **breaks at the "well-timed prompt" edge** (no iOS/server push) and is **thin at "social reflection"** (empty network). Fixing those two edges is the highest-leverage retention work available (§5).

---

## 5. Retention feature backlog, ranked by leverage

Leverage = (impact on the North-Star / churn) × (how much we already have) ÷ (build cost). Ranked. Each maps to the science above and the code in §3.

1. **Analytics / event instrumentation (PostHog/Amplitude/Mixpanel).** *Prerequisite for everything.* Define the event schema (signup, onboarding step, first-workout, session-completed, check-in, readiness, adaptation-used, notification-sent/opened, follow/kudos, churn). Without it, §4 is unmeasurable and every item below is un-A/B-able. **Cheap, foundational, do first.** `[Amplitude, Reforge]`
2. **★ Server-side + iOS web push (fix the broken Prompt).** Implement web-push (VAPID) with a scheduled sender; iOS PWA push has worked since 16.4. Unlocks: session reminders that *actually fire*, proactive readiness/adaptation nudges, fresh-start pings, win-back. **This is the #1 retention gap** — the external Trigger of the Hooked loop for our core user. Pair with the existing `lib/notify.ts` local path as a fallback. `[Eyal, Fogg]`
3. **Lifecycle messaging (push + email).** Welcome → onboarding-incomplete → **first-workout nudge** → week-1 recap → **missed-session "let's move it"** → week-9 "habit locked" → **race-week hype** → **post-race re-entry + next race** → win-back. Each is a named behavioral moment (fresh-start, relapse-handling, accountability). Backbone of subscription retention; we have *none.* `[RetentionCheck, Braze]`
4. **★ Streak forgiveness: freeze + earn-back + illness/travel hold.** Before leaning harder on streaks, add Duolingo-style **earn-back** (re-earn a lost streak, don't sell it) and auto-protect during logged blackout/illness. Kills the **broken-streak → quit cliff** and keeps streaks *on-brand* (injury-kind, not guilt-inducing). Extends existing `computeStreak`. `[Shuttleworth, Lally]`
5. **Engineer + celebrate the first completed session.** Make "day one" an explicit, achievable, *celebrated* activation moment (an easy first session, a "you're training with AmaTri now" beat). The <3-sessions-in-14-days cliff is the sharpest churn signal — sprint the athlete to session #1, then #3. Instrument `first-workout` as the activation event. `[RetentionCheck]`
6. **When/where scheduling → implementation intentions + send-time optimization.** One added onboarding question ("usual training time & place") turns every session into an if-then plan (d≈0.65 evidence) *and* lets push fire at the right moment. Tiny build, top-tier evidence. `[Gollwitzer-Sheeran]`
7. **★ Proactive coach touches (turn the tool into a relationship).** Use the existing `summarizeForCoach`/`assessAdaptation` context to *initiate*: "noticed you were sore — today's easy," "two swims missed, want to rebalance?", a Monday plan-ahead note, a post-session surprise PR callout. Delivered via #2. Converts the coach from reactive chat → **relatedness + accountability** engine. `[Ryan-Deci, Runna-doc §7.4]`
8. **Variable, surprising rewards (upgrade the Hooked reward).** Beyond fixed milestones: unexpected "6 weeks ago this pace was threshold — today it's easy," longest-ride-this-month, negative-split callouts, occasional coach kudos. Variability sustains dopamine where predictable praise habituates. `[Eyal]`
9. **Densify the social graph (relatedness at scale).** Frictionless friend discovery (contacts/Strava import), auto-join **race cohorts** as real groups (not just a count), leaderboards *within* a cohort, richer feed. Solve cold-start. Track connected-vs-solo retention. **Biggest upside + biggest build.** `[Strava-StriveCloud, Cialdini]`
10. **Surface the accruing investment & endowed progress.** "142 sessions · 87 hours banked · you're 41% to the start line · you'd have paid a coach ~$X." Makes the Hooked *investment* and *competence* visible; endowed-progress framing ("you're already 15% there") beats "0/112." `[Nunes-Dreze]`
11. **Post-race re-entry + multi-race season (manufacture the smile).** A structured "you finished — here's your recovery and your next chapter" flow converts the natural post-race lapse into a **resurrection** (the smiling curve) instead of a cliff. `[Sequoia-Retention]`
12. **Value-before-paywall trial + honest billing.** When monetization ships: annual-anchored trial (Health & Fitness uses 5–9-day trials; ~50–60% trial-to-paid median), plan+finish-time shown pre-paywall (we already build the plan first), and **humane cancel/pause** (Runna's self-inflicted Trustpilot wound — don't repeat it). `[RevenueCat, Runna-doc §7B.3]`
13. **Injury-safety as explicit, repeated reassurance.** Surface the readiness/adaptation "we softened this because you were sore / capped intensity for your Achilles" as recurring *competence + trust* messaging — our differentiated moat, said out loud. `[Runna-doc §7C.1]`
14. **Temptation bundling nudge (nice-to-have).** Light suggestion to pair indoor/turbo sessions with a saved show/audiobook. Real but decaying effect; low priority vs 1–11. `[Milkman-Volpp]`

---

## 6. Ethical guardrails — retain without becoming a dark pattern

Our target user is a *serious, self-motivated age-grouper* who will feel — and resent — manipulation. For an **injury-aware** brand, several standard growth tactics are actively off-brand. Non-negotiables:

- **Never guilt a sore or injured athlete into training.** A streak or push that pressures someone whose `readinessBand === "low"` directly contradicts the product's reason to exist. Forgiveness mechanics (§5.4) and readiness-gating protect this.
- **Reward mastery, not just compliance** (avoid overjustification). Keep extrinsic layers (badges/streaks) *supporting* the intrinsic love of training, never *supplanting* it — SDT says the intrinsic drive is what retains for years. Let serious athletes **dial down** gamification.
- **Prompts are invitations, not sirens.** Respect frequency limits (>a few pushes/week erodes trust `[MoEngage]`), send-time optimization, easy opt-out, and the **coach voice** ("respect, not hype"). Notification fatigue → opt-out → the Prompt channel dies.
- **No fear-based streak/loss mechanics that manufacture anxiety.** Streaks as a *consistency trend*, freeze/earn-back forgiveness, and no shame states. The compulsion literature is a warning, not a playbook `[UXMag, TheBrink]`.
- **Humane billing** (pause/cancel/refund done right). Trust is a retention asset; the fastest way to churn *and* generate brand damage is a hostile cancel flow (Runna's documented mistake).
- **The honest test:** every retention feature should make the athlete *actually fitter and healthier.* If a mechanic boosts WAA while worsening the guardrails (injury reports, opt-outs, streak-anxiety proxies), it's a dark pattern — kill it. Our North-Star and guardrails (§4.3) exist precisely to enforce this.

---

## 7. Sources

**Behavioral science (frameworks & primary research)**
- Fogg Behavior Model (B=MAP): https://www.thebehavioralscientist.com/articles/fogg-behavior-model ; Tiny Habits summary: https://goalsandprogress.com/tiny-habits-fogg-behavior-model-explained/
- Nir Eyal, Hooked model: https://amplitude.com/blog/the-hook-model
- Lally et al. (2010), habit formation (median 66 days): https://onlinelibrary.wiley.com/doi/abs/10.1002/ejsp.674 ; 21-day myth explainer: https://taskcoach.ai/blog/habit-formation-real-curve-lally-66-days/
- Gollwitzer & Sheeran (2006) implementation intentions meta-analysis (d≈0.65): https://cancercontrol.cancer.gov/sites/default/files/2020-06/goal_intent_attain.pdf ; PA-specific meta-analysis (PLOS ONE): https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0206294
- Self-Determination Theory in exercise (Teixeira et al., systematic review): https://link.springer.com/article/10.1186/1479-5868-9-78 ; Edmunds et al. SDT exercise test: https://selfdeterminationtheory.org/wp-content/uploads/2014/04/2006_Edmundsetal-1.pdf
- Transtheoretical Model / Stages of Change: https://www.ruralhealthinfo.org/toolkits/health-promotion/2/theories-and-models/stages-of-change ; StatPearls: https://www.ncbi.nlm.nih.gov/books/NBK556005/
- Fresh-Start Effect (Dai, Milkman & Riis 2014, *Management Science*): https://faculty.wharton.upenn.edu/wp-content/uploads/2014/06/Dai_Fresh_Start_2014_Mgmt_Sci.pdf
- Temptation bundling (Milkman, Minson & Volpp): https://pubsonline.informs.org/doi/10.1287/mnsc.2013.1784
- Overjustification / crowding-out effect: https://en.wikipedia.org/wiki/Overjustification_effect ; gamification & intrinsic motivation meta-analysis: https://link.springer.com/article/10.1007/s11423-023-10337-7

**Retention benchmarks & product analytics**
- Sendbird / app retention benchmarks (D1/D7/D30): https://www.pushwoosh.com/blog/increase-user-retention-rate/ ; D7/D30 by category: https://prooflytics.io/blog/d7-d30-retention-benchmarks-by-app-category
- Mobile retention benchmarks 2026 (13 verticals): https://www.core-mba.pro/tool-hub/mobile-app-retention
- Fitness app churn (RetentionCheck, ~9.2%/mo, first-14-days signal, January effect): https://retentioncheck.com/churn-benchmarks/fitness-apps
- RevenueCat State of Subscription Apps (churn, trial-to-paid, month-3): https://www.revenuecat.com/state-of-subscription-apps ; Adapty health-&-fitness benchmarks: https://adapty.io/blog/health-fitness-app-subscription-benchmarks/
- Amplitude 7% retention rule / North-Star: https://amplitude.com/blog/7-percent-retention-rule ; https://amplitude.com/blog/product-north-star-metric
- Retention curve shape / smiling curve: https://articles.sequoiacap.com/retention ; https://www.indiehackers.com/post/does-your-cohort-retention-curve-smile-8c574ccdcb
- DAU/MAU stickiness benchmarks: https://vmobify.com/blog/dau-mau-stickiness-benchmarks
- North-Star metric for subscription apps: https://www.revenuecat.com/blog/growth/north-star-metrics-subscription-growth

**Case studies & engagement mechanics**
- Duolingo streaks (Jackson Shuttleworth / Lenny's Podcast; loss aversion, Earn Back, 600+ experiments): https://www.getrecall.ai/summary/lennys-podcast/behind-the-product-duolingo-streaks-or-jackson-shuttleworth-group-pm-retention-team ; https://trophy.so/blog/duolingo-gamification-case-study
- Strava network effects / social streaks (5.69 vs 4.25 days; 35+ sessions/mo): https://www.strivecloud.io/blog/app-engagement-strava ; https://trophy.so/blog/strava-gamification-case-study
- Streak dark patterns / hot-streak design (anxiety past ~30 days): https://uxmag.com/articles/the-psychology-of-hot-streak-game-design-how-to-keep-players-coming-back-every-day-without-shame ; https://www.thebrink.me/gamified-life-dark-psychology-app-addiction/
- Push notification best practices (frequency, send-time, fatigue): https://www.moengage.com/learn/push-notification-best-practices/ ; https://www.braze.com/resources/articles/push-notifications-best-practices

**Internal**
- Competitive reference: [docs/research/runna-competitive-analysis.md](../research/runna-competitive-analysis.md)
- Engine & adaptivity: [lib/planEngine.ts](../../lib/planEngine.ts), [lib/adapt.ts](../../lib/adapt.ts), [lib/readiness.ts](../../lib/readiness.ts), [lib/stats.ts](../../lib/stats.ts), [lib/predict.ts](../../lib/predict.ts), [lib/notify.ts](../../lib/notify.ts), [lib/social.ts](../../lib/social.ts), [lib/haptics.ts](../../lib/haptics.ts)
- Surfaces: [components/onboarding/Onboarding.tsx](../../components/onboarding/Onboarding.tsx), [components/WelcomeScreen.tsx](../../components/WelcomeScreen.tsx), [components/app/CheckinSheet.tsx](../../components/app/CheckinSheet.tsx), [components/app/ReadinessSheet.tsx](../../components/app/ReadinessSheet.tsx), [components/app/CoachSheet.tsx](../../components/app/CoachSheet.tsx), [components/app/FriendsTab.tsx](../../components/app/FriendsTab.tsx), [app/api/coach/route.ts](../../app/api/coach/route.ts)

*Benchmark honesty: retention figures vary widely by vendor, methodology, cohort, and date. Treat every number here as order-of-magnitude for prioritization, not as a target to hit precisely. Re-verify against our own instrumented cohorts (§5.1) once they exist — our numbers are the only ones that matter.*
