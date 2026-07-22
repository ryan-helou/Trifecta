# Runna — Deep Competitive Analysis (reference for building AmaTri)

> **What this is.** Runna is the closest thing to AmaTri's business model in an adjacent
> niche: a consumer app that replaces a $100+/month human running coach with an
> affordable, adaptive, phone-first training plan. They did for **running** what we are
> doing for **triathlon**. This document is the standing reference — consult it whenever
> we design a feature, a screen, a plan-engine behaviour, or a pricing/onboarding
> decision. It captures how Runna works, why it won, what users love, what they hate, and
> the concrete playbook for AmaTri.
>
> **Compiled:** 2026-07-21. **Method:** multi-source web research (press, professional
> reviews, Runna's own support/press pages, business/funding databases, and community
> sentiment reported second-hand — Reddit is not directly fetchable but its themes are
> well-documented by TechRadar, Tom's Guide, and review roundups). Figures that conflict
> across sources are shown as dated ranges, not false precision. Sources are listed at the
> end and cited inline as `[n]`.

---

## 0. TL;DR — the 12 things that actually matter

1. **Runna sells structure, not tracking.** The entire product is "follow a plan a coach
   would give you." It is deliberately *not* a run-logger. That focus is the whole reason
   it works. `[TomsGuide, Autonomous]`
2. **The wedge is price × credibility.** A real coach is £100–£300/mo. Runna is ~£10–£20/mo
   and is fronted by a credible head coach (Ben Parker, 7× Ironman). "Real coaching,
   affordable" is the pitch. `[Sifted, Welltodo]`
3. **Coach-designed, algorithm-personalised.** Plans are built on principles from
   experienced human coaches; an algorithm then tailors paces, progression and adaptation
   to the individual. This "human credibility + software scale" framing is central to both
   their marketing and their defence against injury criticism. `[TechRadar-injury]`
4. **Onboarding is a masterclass** — ~30 screens / ~12 min, Instagram-story style, and it
   **shows you your plan and a "with/without Runna" finish-time before the paywall.**
   "Design for confidence, not speed." `[UXCollective]`
5. **They meet runners on their watch.** Deep push-to-device integration (Apple Watch,
   Garmin, COROS, Suunto, Fitbit) with **live audio pace coaching**. The watch, not the
   phone, is the run-time surface. `[Runna-support, DCRainmaker]`
6. **Adaptivity is the headline feature and the biggest weakness.** Plans reshuffle around
   completed/missed sessions and post-run feedback ("Not Feeling 100%", plan realignment).
   But the loudest complaint is that plans **don't downshift enough for daily fatigue and
   run too aggressive**, especially for beginners. `[Autonomous, TechRadar-injury]`
7. **Injury/overtraining is the open flank.** A visible wave of Reddit/TikTok posts about
   people getting hurt on AI plans. No plan-level regulation off HR/power/elevation.
   **This is the single biggest gap a competitor can exploit.** `[TechRadar-injury, DCRainmaker]`
8. **Explosive, capital-efficient growth.** Founded 2021; ~3k paid subs in 2023 →
   estimated ~$40M annualised revenue run-rate by early 2025; profitable since 2023; only
   ~£8M raised; ~150 staff. `[Sifted, DCRainmaker, Stysin]`
9. **Apple App of the Year finalist (2024)** and **acquired by Strava (April 2025)** —
   distribution into 120–150M+ athletes. Strava's own training plans were static and
   unused; Runna was the fix. "This isn't an efficiency play." `[Strava-press, Sifted]`
10. **Feature breadth is real but bounded.** Couch-to-5K → marathon (+ ultra), with
    **strength & mobility sessions woven into the running calendar**, race-time predictor,
    personalised workout briefings, community. Running only — no multisport. `[Runna.com, RunningWestward]`
11. **Where Runna is weak on purpose or by neglect:** no true readiness/auto-regulation,
    thin for very advanced athletes, plan-rigidity risk, and repeated **billing/customer-service
    complaints** on Trustpilot. `[Trustpilot, Autonomous]`
12. **AmaTri's thesis in one line:** *be "Runna for triathlon" — same consumer polish and
    adaptive-plan wedge, but multisport-native and genuinely injury-aware — in a niche
    where no Runna-quality player exists.*

---

## 1. Company, business model & the Strava acquisition

### Origin & founders
- **Founded 2021** in London by **Dom Maskell** (CEO, ex-McKinsey, tech) and **Ben Parker**
  (head coach, 7× Ironman / ultra athlete). University best friends. `[Welltodo, The-Sun]`
- **The MVP was a PDF generator.** v1 (under the name "RunBuddy") emailed you a training
  plan ~15 minutes after you filled a form; ~a dozen paying customers. Ben was already
  running a manual coaching business with up to ~40 online clients; Dom's insight was to
  automate it. This is the classic "sell the manual service first, then automate it" path.
  `[Welltodo, I-Did-A-Runner podcast]`
- Both founders made **Forbes 30 Under 30**. `[Forbes]`

### Funding & efficiency
- Total raised **~£8M** (some sources ~$9.8M): pre-seed ~$0.7M → seed ~$2.35M → later
  round; investors include **Eka Ventures, JamJar, Venrex, Creator Ventures**. `[Sifted, Crunchbase-style]`
- **Profitable since ~2023.** ~150 employees at acquisition. This is a *capital-efficient*
  business, not a burn-for-growth one — important context for how AmaTri should think about
  spend. `[Sifted, DCRainmaker]`

### Scale (numbers conflict — treat as a trajectory, not gospel)
- **2023:** CEO cited **~3,000 paid subscribers** (Sifted); a UX case study cited ~7,000
  paying by March 2023 and 48k app-store ratings at **4.9★**. `[Sifted, UXCollective]`
- **Near acquisition (2025):** DC Rainmaker cited **~90,000 members** and estimated ~$10.7M
  ARR *on that basis* — but a separate analyst estimate put **iOS+Android revenue at ~$3.5M/month
  (~$40M annualised run-rate) by March 2025.** `[DCRainmaker, Stysin]`
- **Takeaway:** exact current numbers are undisclosed and estimates vary widely, but the
  direction is unambiguous — a few thousand subs in 2023 to a *~$40M-run-rate, hundreds-of-thousands-of-subscribers*
  business by 2025. Explosive, ~2-year ramp.

### The Strava acquisition (April 2025)
- **Announced 17 April 2025**; **price undisclosed** (one press estimate floated ~£150M;
  DC Rainmaker openly questioned whether Strava overpaid). `[Strava-press, UXCollective, DCRainmaker]`
- **Strategic rationale (this is the instructive part):** Strava had **120–150M+ users** but
  its own training plans were *static, document-based, and barely used*. Runna was the
  engagement fix. Strava's CEO Michael Martin: **"This isn't an efficiency play"** — framed
  as growth investment, apps to **stay separate "for the foreseeable future,"** invest in
  the Runna team, operate "independent but integrated." `[Sifted, Strava-support]`
- **Post-acquisition moves so far:** a **Strava + Runna bundle at $149.99/yr** (up to ~60%
  cheaper than buying both); **localisation into 7 new languages** (Sept 2025) — the first
  big initiative, explicitly credited to Strava's infra; and updated Strava sync showing
  plan progress/milestones. Strava also shipped its own "Athlete Intelligence," creating
  some internal overlap. `[Strava-press, Forbes-Sept, RunningGenie]`
- **Why it matters for us:** the acquisition *validates the category* and confirms the moat
  is **the adaptive-coaching engagement layer**, not tracking. It also means the running
  niche is now consolidated under a giant — reinforcing that AmaTri's opening is the
  **underserved multisport niche**, not head-on running.

---

## 2. Why Runna is so successful — the 8-pillar formula

1. **Ruthless focus.** They did one job — structured running plans — extremely well, and
   refused to be a general tracker. Clarity of purpose drove product quality and
   marketing. `[TomsGuide, DCRainmaker]`
2. **A real market tailwind.** Running is the **fastest-growing sport globally**, heavily
   Gen Z; ~43% of Strava users said they wanted to conquer a big race in 2025. They rode a
   wave. `[Strava-press]`
3. **Priced against the right anchor.** Not "another £10 app" — "a coach for 1/10th the
   price." The comparison set is human coaching (£100–£300/mo), which makes £10–£20/mo feel
   like a steal. `[Autonomous, RunWithRachel]`
4. **Credibility + scale.** A named, decorated head coach makes the plans feel
   *trustworthy*; the algorithm makes them *scalable and cheap*. Neither alone would work.
   `[Welltodo, TechRadar-injury]`
5. **Best-in-class onboarding & UX.** Confidence-building funnel, plan shown before paywall,
   4.9★ at scale. Conversion and first-run success are engineered, not accidental (see §3.1).
   `[UXCollective]`
6. **They live on the watch.** Push-to-device + live audio coaching removes phone
   dependence mid-run and makes the plan feel like a coach in your ear. `[Runna-support]`
7. **A habit/engagement loop.** Post-run feedback, personalised workout briefings, streaks,
   community ("X others training for this race") — the app keeps pulling you back, which is
   what actually retains subscribers. `[RunningWestward, UXCollective]`
8. **Timing + distribution luck/skill.** App of the Year finalist → Strava acquisition →
   150M-athlete funnel. They built something acquirable by the category's 800-lb gorilla.
   `[Strava-press]`

---

## 3. How the product works (mechanics, in detail)

### 3.1 Onboarding & conversion funnel `[UXCollective]`
- **~30 screens, ~12 minutes**, but it *feels* light — opens with a **4-screen
  Instagram-Story-style auto-play carousel** (≤9 words per headline, imagery over text).
- **Core question sequence (the personalization inputs):**
  1. Set a **goal** (get fit / first race / PB / return from injury)
  2. Pick a **race / event** (specific event & date)
  3. **Self-select ability level**
  4. Choose **preferred running days / frequency / availability**
  5. **Predict current performance** (e.g., current 5K/half time) → seeds pace targets
  6. Units (km / miles)
- **Conversion psychology worth stealing:**
  - **Show the outcome before the ask:** an **estimated race time "Without Runna: 1:59 /
    With Runna: 1:51"** framing — concrete, personalised benefit.
  - **Plan (and first easy-run) shown *before* the paywall.** You see value, then pay.
  - **Social proof inline:** "230 others training for this event," diverse-runner imagery,
    the (then) 47k-member community referenced as credibility.
  - **Anxiety-first micro-copy:** addresses injury fear, "am I too slow," scheduling — a
    validation gate confirms "you're the right fit" if you enter a slow/unrealistic pace.
  - **"Design for confidence, not speed."** The flow is intentionally longer than a
    minimal signup because commitment + confidence beats raw speed for retention.
- **Post-onboarding:** explainer of the **4 run types** with short coach videos, then a
  first-workout preview (usually an easy run) to guarantee an achievable first session.

### 3.2 Plan generation & the "human coach vs AI" model
- Inputs: experience level, goal distance/event & date, target time, weekly availability,
  preferred long-run day, strength frequency, units. `[DCRainmaker, Autonomous]`
- Runna's official framing: **"Plans are designed by highly experienced coaches using
  proven training principles; an algorithm then tailors and adapts those coach-designed
  plans to each runner based on progress, feedback, and real-world performance."** Some
  press has simplified this to "human coaches write the plans, AI monitors" — the truth is
  **coach-designed templates/principles + algorithmic personalisation & daily adaptation.**
  `[TechRadar-injury, RunningWestward]`
- **Starting point is calibrated to declared fitness** — initial weekly mileage, longest
  run and pace targets are set from your ability answers so the *first* session is
  appropriate. `[Runna-support]`

### 3.3 Workout structure `[Autonomous, TomsGuide]`
- Plans are periodised and built from a small, legible vocabulary of session types:
  - **Easy / recovery runs**
  - **Long runs**
  - **Tempo** sessions
  - **Intervals / speed work**
  - **Optional strength & mobility**
- Most workouts carry **explicit pace targets or ranges** (with effort-based options when
  pace isn't appropriate). Sessions can be **moved without breaking the plan**.
- **Personalised "Workout Briefings"** — every session gets a briefing, and "no two
  customers receive the same briefing." (i.e., the *purpose/coaching text* is itself a
  personalised surface, not boilerplate.) `[RunningWestward]`

### 3.4 Adaptivity (the headline feature — and the fault line)
- **What it does:** adapts *around* completed sessions so one skipped run doesn't derail
  the plan; **post-run feedback prompts** feed back into the plan; **"Not Feeling 100%"**
  lets you dial back when ill/achy/busy; **plan realignment** and skip/rearrange/extend/rebuild
  options for missed sessions; future plans build on prior training rather than starting
  fresh. `[RunningWestward, Runna-support]`
- **What it does *not* do well (documented criticism):** it does **not auto-regulate off
  daily readiness** — sleep debt, life stress, HRV, or "my legs are cooked today." Pace
  targets are tied to the *plan's* progression, not to *today's* state, so sessions can
  feel **"too spicy" early**, and long-run paces feel like "work" not "easy." If pace feels
  unachievable, **the onus is on the user to manually downshift.** `[Autonomous, TechRadar-injury]`

### 3.5 Coaching voice & content
- Tone described as **"encouraging, direct, not preachy."** Coach videos in onboarding,
  briefings per workout, audio cues. There is **no default 1:1 human coach** — a noted gap
  for accountability when motivation dips. `[RunningGenie, Autonomous]`

### 3.6 Integrations & run-time experience
- **Watches:** Apple Watch, Garmin, COROS, Suunto, Fitbit — Runna **creates/schedules the
  workout, pushes it to the device**, the watch runs & records it, and the result **syncs
  back**. `[DCRainmaker, Runna-support]`
- **Live audio coaching:** real-time pace guidance ("speed up / slow down," distance left,
  target vs actual, recovery countdown) on **phone, Apple Watch, and via Garmin audio
  prompts.** This is a *core* felt-value feature. `[Runna-support]`
- **Caveat that reveals a limit:** with Garmin, **only running workouts sync — strength,
  yoga, etc. don't transfer either direction.** `[Runna-support]`
- **Music:** Spotify / Apple Music playlists matched to the run. `[TomsGuide]`
- **Strava:** deep sync; post-acquisition it now surfaces plan progress, milestones,
  workout analysis on the Strava activity. `[Forbes-Sept]`
- **Notably absent from the *plan logic*:** elevation, heart-rate, and power are **not**
  first-class inputs to plan construction/regulation (DC Rainmaker's specific critique). `[DCRainmaker]`

### 3.7 Race prep & feature breadth
- **Coverage:** Couch-to-5K → 5K/10K/half/marathon → **ultra**; fully periodised. `[Runna.com, DCRainmaker]`
- **Strength & mobility** are **woven into the running calendar** (not a separate silo) —
  a real differentiator and injury-prevention story. `[Runna.com, Autonomous]`
- **Race-Time Predictor / estimated race time**, adjustable. `[Runna-support]`
- **Newer / roadmap (2025–26):** personalised workout briefings; **race-calendar planning /
  schedule plans ahead**; **post-race recovery** setup; expanded audio cues **including
  nutrition reminders**; clearer strength layout; 7-language localisation. `[RunningWestward, Forbes-Sept]`
- **Community:** in-app community + the large Reddit/Discord following used as social proof.

### 3.8 Pricing (as of 2025–26)
- **~$17.99–$19.99/mo**, or **~$109.99–$119.99/yr (~$9.17–$9.99/mo effective)**; UK
  ~£15.99/mo or ~£9.99/mo annual. **7-day (first-week) free trial**, cancel anytime.
  `[TechDepot, DCRainmaker, RunWithRachel]`
- **Strava + Runna bundle: $149.99/yr, annual-only** (no monthly). `[Strava-press]`
- Positioned explicitly as **"a fraction of a private coach ($100+/mo)."** `[Autonomous]`

---

## 4. What users LOVE (praise themes)

- **Removes decision fatigue** — "tells me exactly what to do today," daily clarity. `[Autonomous]`
- **Structure that actually gets beginners to the start line** — repeatedly credited with
  turning "serial quitters" into consistent runners and getting people to a first 5K/10K
  the way generic watch coaching didn't. `[BrightSide, Medium-Maya]`
- **Best-in-class for a "virtual coach"** — Tom's Guide's top pick for a coaching app,
  "excellent for beginners." `[TomsGuide]`
- **Watch integration + live audio pacing** feels premium and coach-like. `[Runna-support, TomsGuide]`
- **Strength/mobility built in** — training *the right systems*, not just "run more." `[Autonomous]`
- **Clean, confidence-building UX**; 4.9★ at ~48k+ ratings. `[UXCollective]`
- **Great value vs a human coach.** `[RunWithRachel, Autonomous]`

## 5. What users COMPLAIN about / WISH it had (the gaps — our opportunity map)

> These are the exploitable weaknesses. Each maps to a concrete AmaTri advantage in §6.

1. **Plans run too aggressive / "too spicy" too early**, especially for beginners who
   "don't yet understand the limits of their own bodies." Speed sessions and long-run paces
   feel too hard relative to daily state. `[Autonomous, TechRadar-injury]`
2. **Injury & overtraining discourse** — a visible influx of Reddit/TikTok posts about
   people getting hurt (stress fractures, shin splints, illness) on AI plans. Experts:
   "AI training plans are not yet ready for complex scenarios applied at scale to general
   populations." No peer-reviewed proof of higher injury rates, but the *perception* is a
   real brand risk for the whole category. `[TechRadar-injury]`
3. **Doesn't adapt to daily readiness** — no auto-downshift for fatigue/sleep/stress; the
   user must self-regulate, which defeats the "coach" promise for the people who most need
   a coach. `[Autonomous]`
4. **No HR / power / elevation in the plan logic** — a serious-athlete critique; plans are
   pace-and-schedule driven, not physiology-regulated. `[DCRainmaker]`
5. **Thin for advanced runners** — sweet spot is beginner→intermediate; very experienced /
   high-mileage athletes "should look elsewhere." `[TechRadar-review, Autonomous]`
6. **Rigidity risk** — people who follow it too literally can overtrain; "use as guidance,
   not a rulebook." `[Autonomous]`
7. **No default 1:1 human accountability** — easy to ignore when motivation drops. `[Autonomous]`
8. **Plan-centric only** — "not for anyone who just wants to track day-to-day runs." Also
   requests to **track other activities (e.g. walking)** and to **pause/resume cleanly for
   injury/illness.** `[TomsGuide, Yahoo/Trustpilot]`
9. **Customer service & billing** — recurring Trustpilot complaints: being **locked out of
   annual subscriptions**, refund/support requests **ignored**. Operational, but corrosive
   to trust. `[Trustpilot, TechRadar-review]`
10. **Post-Strava ecosystem lock-in / roadmap uncertainty** — one company now owns your run
    history *and* your coaching; big-company focus may slow the roadmap. `[RunningGenie]`

## 6. Professional / press verdict (the balanced read)

- **Tom's Guide:** best running app **for a virtual coach**; excellent for beginners;
  playlists; broad watch support. Con: **not for day-to-day tracking** — it's a plan. `[TomsGuide]`
- **DC Rainmaker:** clean, well-refined, sustainable business, good watch integration — but
  **"AI training-plan apps are a dime a dozen"**; the tech isn't uniquely defensible; **no
  elevation/HR/power** in plans; expects eventual folding into Strava. The value Strava
  bought was **"staff and a modest but sustainable user base,"** not proprietary tech. `[DCRainmaker]`
- **TechRadar:** solid personalised experience, but ran the **injury-risk** investigation —
  the sharpest published critique of the *category*. `[TechRadar-injury, TechRadar-review]`
- **Autonomous / long-form reviews:** genuinely useful *as guidance*; the recurring caveat
  is **intensity and lack of daily adaptation** — some runners must actively downshift to
  stay healthy. `[Autonomous]`

---

## 7. THE AMATRI PLAYBOOK — copy / avoid / exploit

> Mapped onto our actual codebase so this is a build reference, not generic advice.
> Key files: [lib/planEngine.ts](../../lib/planEngine.ts),
> [components/onboarding/Onboarding.tsx](../../components/onboarding/Onboarding.tsx),
> [components/app/CheckinSheet.tsx](../../components/app/CheckinSheet.tsx),
> [components/app/CoachSheet.tsx](../../components/app/CoachSheet.tsx),
> [app/api/coach/route.ts](../../app/api/coach/route.ts).

### 7A. COPY (steal these — they're proven)

1. **The onboarding funnel structure.** Story-style carousel → goal → race/event → ability
   → availability → **current fitness (recent times / CSS / FTP)** → units. We already
   collect most of this; the win is **sequencing + tone**: confidence-first micro-copy,
   ≤9-word headlines, imagery over text, and a first session guaranteed to be achievable.
2. **Show the finish-time hook *in onboarding*, before the paywall.** We already have
   [`estimateRaceSeconds()`](../../lib/planEngine.ts) — surface a **"Your projected finish:
   X:XX:XX"** and ideally a "with a structured plan vs winging it" delta. This is Runna's
   single best conversion lever and **we already own the engine for it.**
3. **Show the plan (and week 1) before asking to pay.** Value first, paywall second.
4. **Personalised "Workout Briefings."** We already attach `purpose`/`cue` text to every
   workout and segment in [planEngine.ts](../../lib/planEngine.ts). Elevate these into
   coach-voiced, context-aware briefings ("because you flagged a calf niggle, today stays
   Z2"). Optionally generate via the existing Haiku coach path for the *briefing text only*
   (cheap, high perceived value) — keep the plan itself deterministic.
5. **A real post-session feedback loop.** After each workout: how did it go (easy/right/hard),
   RPE, any pain. This is the *input* that makes adaptivity feel like coaching. Wire it into
   [CheckinSheet.tsx](../../components/app/CheckinSheet.tsx) and let it actually move the plan.
6. **"Not Feeling 100%" / life-happens controls.** Runna's flexibility verbs — *rearrange,
   skip, extend, rebuild-to-same-date* — are table stakes. We already have **blackout
   dates** in [planEngine.ts](../../lib/planEngine.ts) (`applyBlackouts`); extend that into
   first-class, in-app "I'm sick / travelling / cooked this week" actions.
7. **Live audio pacing + push-to-watch.** Our biggest *product* gap vs Runna. We have
   Strava sync but not workout-push or in-ear pacing. Prioritise **structured-workout export
   to Garmin/Apple Watch** and audio cues; this is what makes it feel like a coach.
8. **Community/social proof.** "X athletes training for [this race]," friends, leaderboards.
   We already have a [FriendsTab](../../components/app/FriendsTab.tsx) — lean in.
9. **Pricing anchor.** Sell against a **tri coach ($150–$400/mo)** and clunky incumbents
   (TrainingPeaks/TriDot). Annual plan with a free trial; consider that ~$100–$120/yr is the
   proven sweet spot Runna validated.
10. **Race-calendar / plan-ahead + post-race recovery** — both are on Runna's own roadmap
    because users want them. We already model race week and taper; add multi-race seasons
    and a structured post-race re-entry.

### 7B. AVOID (their mistakes = our positioning)

1. **Don't ship plans that feel "too spicy."** Runna's #1 complaint. Our engine's **80/20
   intensity discipline and per-phase caps** already guard against this — *make that a
   marketing promise*, not just an implementation detail.
2. **Don't ignore daily readiness.** This is Runna's biggest hole. See §7C.1 — it's our
   headline differentiator, not a nice-to-have.
3. **Don't let customer service/billing rot.** Trustpilot pain is self-inflicted brand
   damage. Get billing, cancellation, and pause/refund flows *right and humane* from day 1.
4. **Don't become a generic tracker** — but *do* answer the "let me log other stuff / pause
   cleanly for injury" requests Runna fumbled. We already have **injury modelling**; make
   pause/resume graceful.
5. **Don't over-raise / over-hire.** Runna hit ~$40M run-rate on ~£8M and 150 people, and
   was *profitable*. Our deterministic, ~$0/plan engine ([planEngine.ts](../../lib/planEngine.ts))
   is a **structural cost advantage** — protect it. Keep LLM usage on the cheap perimeter
   (briefings, coach chat), never in the core plan path.
6. **Don't pretend to serve elites.** Pick beginner→committed-age-grouper, like Runna picked
   beginner→intermediate. Depth for pros can come later.

### 7C. EXPLOIT (the gaps — where AmaTri wins)

1. **★ Injury-aware, readiness-adaptive planning — our flagship moat.** Runna's open flank
   is exactly our existing strength: [planEngine.ts](../../lib/planEngine.ts) already does
   **`injuryMods()`** (zone caps + volume multipliers + sport substitution per injury
   severity) and **low-impact substitution** (shift load off a hurt sport onto swim/bike).
   **No running app auto-regulates like this.** Build the daily-readiness layer on top
   (check-in / soreness / sleep / HRV → downshift today's session) and **own the message
   "the training app that won't get you injured."** This is the sharpest wedge available.
2. **★★ Multisport is a category Runna structurally cannot enter.** Runna is running-only
   and just got absorbed into Strava. Triathletes are underserved by consumer-grade apps —
   the incumbents (TrainingPeaks, TriDot, TrainerRoad-for-bike) are expensive, clunky, and
   coach/desktop-oriented. AmaTri already owns **swim + bike + run + bricks + transitions +
   per-sport balancing + equipment substitution (no-pool/no-gym)** in
   [planEngine.ts](../../lib/planEngine.ts). **"Runna for triathlon" is an open lane.**
3. **Physiology-driven plans.** DC Rainmaker's critique of Runna (no HR/power/elevation) is
   a spec for us: our paces model already derives **CSS (swim), FTP (bike), run zones**
   ([lib/paces.ts], used across [planEngine.ts](../../lib/planEngine.ts)). Regulate off
   power/HR where Runna won't.
4. **True multi-limiter periodisation.** We already bias volume to a `focusDiscipline` and
   balance three sports; Runna only balances *within* running. Lean into "fix your
   limiter" as a tri-specific coaching story.
5. **Equipment/logistics realism.** No pool this week? Traveling? Our engine already
   substitutes (dryland swim, etc.). Triathletes hit these constraints constantly — make it
   a visible selling point.
6. **Honest adaptivity.** Because our plan is deterministic and cheap to regenerate, we can
   **rebuild the whole plan around a life event instantly** at ~$0 — something an
   LLM-per-plan competitor can't do economically.

---

## 8. Concrete build backlog seeded by this research

Ranked by leverage (impact × how much of it we already have):

1. **Onboarding finish-time hook** — surface `estimateRaceSeconds()` as a "your projected
   time" moment mid-onboarding, before paywall. *(High impact, engine already exists.)*
2. **Daily readiness check-in → auto-downshift** — extend
   [CheckinSheet.tsx](../../components/app/CheckinSheet.tsx) to feed soreness/sleep/RPE into
   a "regulate today's session" pass over the week. *(This is the moat.)*
3. **Post-session feedback loop** — easy/right/hard + pain flag after each workout, feeding
   adaptivity and briefings.
4. **Coach-voiced Workout Briefings** — upgrade `purpose`/`cue` into personalised briefings
   (optionally Haiku-generated text, deterministic plan).
5. **"Life happens" controls in-app** — rearrange / skip / extend / rebuild-to-same-date,
   generalising `applyBlackouts`.
6. **Push-to-watch structured workouts + audio pacing** — Garmin/Apple Watch export; the
   biggest felt-value gap vs Runna.
7. **Injury-safety as explicit positioning** — surface the zone/volume capping already in
   `injuryMods()` as user-facing reassurance ("we capped your run intensity because of your
   Achilles").
8. **Race-calendar / multi-race season + post-race re-entry.**
9. **Community/social proof surfaces** — "N athletes training for [race]," friend leaderboards.
10. **Pricing/trial** — annual-anchored, free trial, sold against tri-coach + incumbents.

---

## 9. Open questions to verify before leaning on them

- **Exact current subscriber/revenue numbers** are undisclosed; the ~$40M run-rate and ~90k
  members figures are third-party estimates from different dates — don't quote as fact.
- **Deal price** (~£150M) is an unconfirmed press estimate.
- **How much adaptation is truly automatic vs user-triggered** in Runna is fuzzy in public
  sources — worth a hands-on trial of the app to see the real behaviour before we claim
  "we adapt and they don't."
- **Ultra coverage** — most sources say 5K→ultra; one 2026 source claimed no ultra. Likely
  outdated; verify if it matters.
- **Whether Runna has since added readiness/HR-based regulation** — Strava's "Athlete
  Intelligence" could close this gap; re-check periodically.

---

## 10. Sources

- Strava press — *Strava to Acquire Runna*: https://press.strava.com/articles/strava-to-acquire-runna-a-leading-running-training-app
- Strava + Runna bundle: https://press.strava.com/articles/strava-runna-launch-combined-subscription-bundle
- DC Rainmaker — *Strava Acquires Runna: Quick Thoughts*: https://www.dcrainmaker.com/2025/04/strava-acquires-runna-thoughts-forward.html
- Sifted — *Strava buys Runna: "This isn't an efficiency play"*: https://sifted.eu/articles/strava-buys-runna-deal-fitness-app
- Stysin — *Why Strava Acquired Runna* (revenue estimate): https://stysin.com/p/strava-acquired-runna
- Forbes — *Runna Makes Biggest Change Yet Since Strava Acquisition* (localisation): https://www.forbes.com/sites/andrewwilliams/2025/09/05/runna-makes-biggest-change-yet-since-strava-acquisition/
- Forbes — *What It Means For Subscribers*: https://www.forbes.com/sites/andrewwilliams/2025/04/17/strava-acquires-runna-what-it-means-for-subscribers/
- UX Collective — *How to nail onboarding — a case study of Runna*: https://uxdesign.cc/how-to-nail-onboarding-a-case-study-of-runna-7780ba89c202
- Autonomous — *Runna App Review: What Training With Runna Is Really Like*: https://www.autonomous.ai/ourblog/runna-app-review-what-training-with-runna-is-really-like
- Tom's Guide — *Runna app review*: https://www.tomsguide.com/reviews/runna-app
- Tom's Guide — *Best running apps 2025*: https://www.tomsguide.com/round-up/best-running-apps
- TechRadar — *Are AI training apps like Runna putting you at risk of injury?*: https://www.techradar.com/health-fitness/are-ai-training-apps-like-runna-putting-you-at-risk-of-injury-i-asked-a-real-life-running-coach
- TechRadar — *Runna Review*: https://www.techradar.com/health-fitness/fitness-apps/runna-review
- RunWithRachel — *Runna App Review 2026*: https://runwithrachel.co.uk/runna-app-review/
- Running Westward Ho — *Runna App Updates 2026*: https://www.runningwestwardho.co.uk/post/runna-app-updates-2026-smarter-training-plans-adaptive-coaching-new-features-explained
- The Running Genie — *Is Runna Still Worth It After Strava Acquisition*: https://therunninggenie.com/blog/is-runna-still-worth-it-after-strava-acquisition
- Welltodo — *Ben Parker & Dom Maskell, Co-founders of Runna*: https://www.welltodoglobal.com/post/ben-parker-and-dom-maskell-co-founders-of-runna/
- Runna support (integrations, audio cues, adaptivity, missed runs): https://support.runna.com/
- Runna pricing: https://www.runna.com/pricing
- Trustpilot — Runna reviews: https://www.trustpilot.com/review/runna.com

*Reddit (r/running, r/AdvancedRunning) is not directly fetchable by the research tooling;
its sentiment here is captured via secondary reporting (TechRadar's injury piece explicitly
analyses the running-subreddit/TikTok injury discourse, and review roundups aggregate
community complaints). To go deeper on raw Reddit threads, browse them manually — the themes
above (too-aggressive plans, injury/overtraining, no daily adaptation, billing/support) are
the ones that recur.*
