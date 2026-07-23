# 07 — Product & UX Design

> **What this is.** The canonical design brief for Trifecta: the opinionated, codebase-grounded
> reference anyone consults *before* they design a screen, a flow, or a chart. It covers the
> hard part of a training app — turning periodization, training load, zones, readiness and race
> prediction into something a time-crunched age-grouper reads at a glance and *wants* to open
> tomorrow. It is specific to Trifecta's actual UI (file paths throughout), and it names the
> best-in-class patterns we copy (TrainingPeaks, Intervals.icu, WHOOP, Strava, Garmin, Zwift,
> Runna) and the traps we avoid.
>
> **Compiled:** 2026-07-22. **Method:** read of the live app (`app/`, `components/`, `lib/`) plus
> UX research (NN/g, WCAG 2.2, fitness-app case studies, wearable UI breakdowns). Grounded in the
> `Paper` design system (`app/globals.css`) as it stands on the `polish/onboarding-colour-racedate`
> branch. Sibling docs cross-referenced inline; sources listed at the end.
>
> **Read alongside:** [02 — Training Load & Readiness](02-training-load-and-readiness.md) (what the
> charts *mean*), [04 — Planning Engine](04-planning-engine-algorithm-design.md) (the data model the
> UI renders), [05 — Wearable & Data Ecosystem](05-wearable-and-data-ecosystem.md) (the watch/run-time
> surface), [06 — Behavioral Science & Retention](06-behavioral-science-and-retention.md) (why the
> emotional design choices matter), and the standing competitive reference
> [docs/research/runna-competitive-analysis.md](../research/runna-competitive-analysis.md).

---

## 0. TL;DR — the 14 things that actually matter

1. **The product's one job is "what do I do today, and why."** Everything else (plan, progress,
   social) is secondary. `TodayTab.tsx` is the home screen and it already answers this well:
   greeting → race countdown → coach note → readiness → today's session → up-next → week-at-a-glance.
   Protect that hierarchy; don't let secondary features climb it.
2. **We are `Paper`, not a HUD.** The design system (`app/globals.css`) is deliberately monochrome:
   white paper, black ink, hairline grays, an editorial high-contrast serif for numerals. **The only
   colour in the product is meaning** — three discipline hues (swim/bike/run) and a five-step zone
   ramp. Restraint *is* the brand. Every new colour must earn its place by encoding data.
3. **Account creation is the last step, and that's correct.** The flow is welcome → questions →
   watch-it-build → account (`app/page.tsx` → `WelcomeScreen` → `Onboarding`). Deferred signup lifts
   activation 10–30%. Do not move the paywall/signup earlier.
4. **The "with-a-plan finish time" is our single best hook, and it fires before signup.** `ReviewStep`
   (`Onboarding.tsx:1145`) shows a projected finish and time-saved *before* the account. This mirrors
   Runna's onboarding masterclass. Make it the emotional peak; never bury it.
5. **The signature animation is no longer the "Reactor."** `components/Reactor.tsx` is now a static
   logo `<img>` (animation stripped, props kept for back-compat). The real signature motion lives in
   `WelcomeScreen.tsx`'s self-drawing race route and `RaceCourse` during plan-build. Update mental
   models accordingly; the doc/skill references to "the animated Reactor" are stale.
6. **`IntervalBar.tsx` is our strongest dataviz and the template for the rest.** A zone-coloured,
   duration-proportional timeline where bar *height* also encodes intensity — dual-encoded, glanceable,
   the TrainingPeaks/Zwift "read a session in one look" pattern. Reuse this visual language everywhere.
7. **We have readiness but not load.** There is a daily readiness check (`ReadinessSheet.tsx`,
   `lib/readiness.ts`) — the thing Runna never built — but **no CTL/ATL/TSB (fitness/fatigue/form)
   trend chart.** The Progress "Fitness" line (`ProgressTab.tsx:159`) is a simplified banked-work curve,
   not a Performance Management Chart. That's the biggest dataviz gap *and* it's our stated moat. See §4.
8. **Zone colour must survive colour-blindness — and mostly does, because we double-encode.** Z3 amber
   and Z4 orange are close in hue; we get away with it because a `Z3`/`Z4` numeral rides alongside the
   colour almost everywhere. Keep the numeral. Never ship a chart where hue is the *only* signal.
9. **Missed workouts are handled with grace, not guilt.** Skip / move / swap / "did something else"
   (`WorkoutDetail.tsx`) and a positively-framed rest day ("Recovery is where you get stronger,"
   `TodayTab.tsx:153`). This is the retention-correct posture (see §7). Do not add streak-shame.
10. **Touch targets are mostly fine, with sharp exceptions.** Nav, cards and primary buttons are
    generous; but 36px steppers and the tiny `✕` remove buttons sit below Apple's 44pt guidance. WCAG 2.2
    floor is 24px — we clear it — but "clears the legal floor" ≠ "comfortable one-handed." See §8.
11. **No dark mode exists.** `html { color-scheme: light }`, `theme_color: #ffffff`. That is a
    deliberate `Paper` choice, but it's a real gap for an app people open at 5am and on OLED phones.
    Decide it on purpose (§1, §8), don't leave it as an accident.
12. **The guided `WorkoutPlayer` is a genuinely native-grade feature.** Full-screen, giant timer, TTS
    + beep cues, wake-lock, haptics, next-step peek (`WorkoutPlayer.tsx`). This plus `.FIT` export
    (`WorkoutDetail.tsx:104`) is how a PWA closes the perception gap with native — lean into it.
13. **Mobile-first is in the bones.** Safe-area insets, `max-w-md` column, thumb-anchored CTAs,
    `haptic()` on every meaningful tap, `prefers-reduced-motion` respected globally
    (`globals.css:290`). This is above the bar for the category; keep the discipline.
14. **Five bottom-tabs is the ceiling — and Friends is the weakest of the five.** `BottomNav.tsx`
    ships Today/Plan/Progress/Friends/Profile. Social is unproven for our user; watch its
    engagement and be ready to demote it into Profile to buy back a tab for load/insights.

---

## 1. Design philosophy & the `Paper` design system

### 1.1 The thesis
Trifecta's design language is codified in the header comment of `app/globals.css`: **"Minimal,
monochrome, white-based. Black ink on white, hairline grays, and no colour at all — the restraint IS
the identity. Depth comes from tonal steps and thin borders, never from glow or gradients. Numbers
(splits, paces, countdowns) stay the hero, set like a watch dial."**

This is a strong, ownable position in a category of neon-gradient dashboards. It reads as an
*instrument* (a watch, a coach's notebook) rather than a game. Two consequences follow, and both are
correct:

- **Colour is reserved for semantics.** The only hues in the system are the three disciplines and the
  five intensity zones. When everything else is ink-on-paper, a single swim-blue label does real work.
- **Typography carries the emotion.** An editorial high-contrast serif (`--font-display`: Fraunces /
  Iowan Old Style) sets display headings and — critically — the big tabular numerals (countdowns,
  paces, percentages). A neo-grotesque sans carries body. This is the "set like a watch dial" move and
  it's the app's aesthetic signature far more than any animation.

### 1.2 The token system (`app/globals.css`)
Tokens are CSS custom properties exposed to Tailwind via `@theme inline`, so `bg-surface`,
`text-muted`, `border-line`, `text-accent`, `text-swim`, `bg-z4` all resolve. This is the right
architecture — one source of truth, utility ergonomics. The important tokens:

| Group | Tokens | Notes |
|---|---|---|
| Surfaces | `--background` `--surface` `--surface-2` `--surface-3` | White → faint warm grays. Depth by tone, not shadow. |
| Lines | `--line` `--line-soft` | Hairlines. `* { border-color: var(--line) }` sets a global default. |
| Ink | `--text` `--text-muted` `--text-faint` | Near-black → gray → faint gray. |
| **Accent** | `--accent: #111` `--accent-2: #000` `--accent-soft: #333` | **The accent is black.** `.accent-gradient` resolves to a *solid* fill; `.text-gradient` to a single colour. Legacy gradient class-names survive but never render a gradient. |
| Disciplines | `--swim #1c7aa2` `--bike #b06f10` `--run #c5372f` `--strength #6b4fbe` `--rest #9a9a96` | Editorial, legibility-tuned on white; used as both text and fill. |
| Zones | `--z1 #5aa0cf` `--z2 #3f9e63` `--z3 #d3a12b` `--z4 #d67a32` `--z5 #c93f3f` | Field-standard easy→hard: blue→green→amber→orange→red. |
| Status | `--success #3f9a5c` `--warning #c8871f` `--danger #c5372f` | Done / eased / missed. |
| Radii | `--radius-xl .75rem` `--radius-2xl .9rem` | "Precise, considered radii — an instrument, not a bubble." |

**Design-system hygiene note:** the `--z*` block comment still says "a light→dark gray ramp" while the
values are the colour ramp — a stale comment from the pre-colour era. Also worth auditing: `--sun` and
`--tide` are both just `--text-muted`, and `.text-gradient`/`.accent-gradient` are misnomers. None are
bugs, but they are the kind of drift that confuses the next designer. Clean them when convenient.

### 1.3 Component primitives
The reusable classes in `globals.css` are the vocabulary; use them before inventing:
- `.card` / `.card-glass` — the second is a solid, hairline-bordered surface with a *very* faint
  machined shadow (`0 1px 2px` + `0 4px 16px -8px`). This is the only permitted elevation. No blur.
- `.btn` `.btn-primary` (black fill, white text) `.btn-ghost` (outline). `:active` nudges 0.5px — a
  tactile press. Primary buttons are full-width and thumb-anchored in every flow.
- `.input` — surface-2 fill, hairline border, focus ring `0 0 0 3px rgba(17,17,17,.10)`. iOS date
  inputs are explicitly de-chromed (`globals.css:190`) — a real cross-platform papercut, already fixed.
- `.chip` / `.chip.is-selected` — pill selectors. The `.is-selected` modifier is intentionally
  *unlayered* so it beats Tailwind's layered utilities and the picked state is actually visible (this
  was a real bug, fixed in commit `df58d9f`). A cautionary tale: selected-state visibility is easy to
  lose to CSS layering.
- `.eyebrow` — small-caps, tracked, muted label. The restrained replacement for HUD-style
  monospace-uppercase readouts. It's everywhere and it's good; keep using it for section kickers.

### 1.4 Motion
Motion is "quiet, purposeful": `fade-up`, `pop-in`, `rise`, `celebrate`, sheet/toast/backdrop
transitions, a nav underline slide, and two ambient `sweep` rotations. Entrance animations are
*staggered by delay* (`animationDelay` inline on Today's cards) so a screen assembles rather than
snaps. **The whole motion layer is killed under `@media (prefers-reduced-motion: reduce)`
(`globals.css:290`)** — a real accessibility win most competitors skip. Rule: any new animation gets a
reduced-motion off-switch in the same commit.

### 1.5 Dark mode: the deliberate gap
There is no dark theme. `html { color-scheme: light }` and the manifest `theme_color`/`background_color`
are both `#ffffff`. For a `Paper` identity this is defensible — but understand the cost: our user opens
this at 5am before a swim and at 10pm logging a session, often on an OLED phone where an all-white app
is a flashbang. WHOOP built its entire glanceable identity on near-black *because* recovery-red pops
against it. We don't have to become WHOOP, but "no dark mode" should be a **decision with a rationale in
this doc**, not a default nobody chose. If/when we add it, the token architecture already supports it:
add a `@media (prefers-color-scheme: dark)` block that re-points the `--*` variables and re-tune the
zone ramp for contrast on a dark field (the amber/orange zones will need lightening). See §8 for the
contrast obligations.

---

## 2. Onboarding UX for a complex domain

Triathlon is a genuinely hard first-run problem: three sports, distances most novices can't visualize,
zones, PRs, FTP, injuries, equipment. The design job is to get a nervous first-timer from install to a
plan they believe in **without teaching them sports science first.** Here's how Trifecta does it and where
it can be sharper.

### 2.1 The flow, as shipped
`app/page.tsx` → `WelcomeScreen` → `Onboarding` (10 steps, some skipped) → `LoadingAnimation` (plan
builds) → `AccountStep`. The `STEPS` array (`Onboarding.tsx:47`):

`race → custom → date → level → frequency → strength → schedule → prs → injuries → review`

with `custom` skipped unless a custom distance is chosen, and `date` skipped when a real event
(catalog pick) already carries its date (`stepActive`, `Onboarding.tsx:165`). A progress bar reflects
only the *active* steps (`visibleCount`), which is the correct way to show progress through a
branching flow.

### 2.2 What's right — keep it
- **Deferred account creation.** The account is the *final* step, after the plan is built and the athlete
  has watched it "forge." Research is unambiguous: showing value before asking to register lifts
  activation 10–30% (Duolingo/TikTok/Pinterest pattern). `AccountStep` even re-states the payoff
  ("Your plan is ready — save it," `Onboarding.tsx:333`). This is textbook and must not regress.
- **The finish-time hook lands pre-signup.** `ReviewStep` renders a projected finish and "≈X faster than
  today's fitness" (`Onboarding.tsx:1186`, from `lib/predict.ts`). This is the emotional turn — "the work
  buys you *this*" — and it's exactly Runna's most-praised onboarding move, reproduced before the paywall.
- **Progressive disclosure done properly.** One question per screen, sensible defaults pre-loaded in the
  `Draft` (`Onboarding.tsx:109`: 1500/40k/10k, 2/2/2 sessions, all equipment on), and "let Trifecta decide"
  escape hatches (auto-frequency, `suggestFrequency`) so a novice never has to *have an opinion* about
  swim-sessions-per-week. NN/g's core onboarding rule — "explain why you need the data, and only ask for
  what's essential" — is satisfied: each `Head` sub-line says why ("This sets your volume… and how fast
  we ramp," `LevelStep`).
- **Real-event catalog + date pre-fill.** Picking a real race (`RaceCatalogPicker`) skips the date
  question and pre-fills it, with a "confirm against the official page" nudge (`DateStep`). This reduces
  input and errors — the progressive-disclosure dividend.
- **Injuries as free text → AI parse.** `InjuriesStep` invites "type it like you'd text a coach" and
  parses to structured injuries, with a graceful "AI is off — your notes are still saved" fallback. This
  is the humane way to ask a scary question, and it degrades safely.
- **Motivational framing throughout.** "What are you training for?", "The road to race day", "We'll
  forge a full day-by-day plan." Coach-voice, not form-voice (see §7).

### 2.3 Where it can be sharper (evaluated honestly)
- **Ten steps is long for the median user.** Runna runs ~30 screens but they're Instagram-story-fast and
  relentlessly single-tap. Our steps are denser (the PR step alone has three sport cards, a unit toggle,
  FTP and maxHR). The fitness-app benchmark is "first value in ~60 seconds." **Audit the flow for a fast
  path:** race → level → date → build, with frequency/strength/schedule/PRs/injuries all defaulted and
  offered as "refine later" in Profile. Every optional step is a drop-off cliff; `strength`, `schedule`,
  `prs`, and `injuries` are all skippable in spirit but currently sit inline in the main spine.
- **The PR step carries the most cognitive load and the most jargon (FTP, max HR).** These matter for
  pace accuracy but terrify novices. Consider: (a) a one-line "don't know these? skip — we'll estimate
  from your level and sharpen as you train" (the calibration engine already does this, see
  `lib/calibrate.ts`), made more prominent; (b) moving FTP/maxHR behind an "advanced" disclosure.
- **No "why triathlon is three sports" orientation.** A true first-timer may not know an Olympic tri from
  a 70.3. The `RaceStep` shows leg distances in discipline colour (good), but there's no "not sure?
  here's the difference" affordance. A single expandable explainer would de-risk the very first choice —
  the one with the highest abandonment stakes.
- **The progress bar has no step labels or count.** "Step 4 of 8" plus a word ("Experience") reduces the
  "how much more of this is there?" anxiety that kills long onboardings. Cheap to add.
- **Back-navigation exists but there's no "save & finish later."** An anon athlete who bails at step 7
  loses everything (state is in-memory `Draft`, not persisted until `AccountStep`). Persisting the draft
  to `localStorage` would let people resume — and would let us *offer* to resume, a re-engagement hook.
- **The `LoadingAnimation` is a deliberate, well-judged delay** (`components/LoadingAnimation.tsx`): a
  progress bar tracking a race-course marker, with rotating build steps ("Applying the 80/20 intensity
  rule…", "Placing your bricks and threshold work…"). This is the *right* kind of fake-work — it teaches
  the athlete what makes the plan credible while the deterministic engine runs in milliseconds. It's
  showmanship in service of trust. Keep it; just make sure it never *feels* like a spinner (it currently
  eases to 100% over a couple seconds — verify it doesn't outlast the user's patience on repeat use).

### 2.4 The onboarding rule-set (for future steps)
1. Default everything. A novice should be able to tap "Continue" through the whole flow and get a good
   plan. Opinions are opt-in.
2. Ask *why* in one muted sub-line under every question. Never ask for data you can't justify.
3. Keep the finish-time hook as the pre-signup climax. New motivational content stacks *around* it.
4. Every new question is a drop-off risk; the bar for adding a step is "the plan is materially worse
   without it, and we can't infer it." Otherwise it belongs in Profile as a refinement.
5. Signup stays last. Forever.

---

## 3. Information architecture & screen-by-screen critique

### 3.1 The IA
Five bottom tabs (`BottomNav.tsx`): **Today · Plan · Progress · Friends · Profile.** This is the
canonical fitness-app shape (a "Today/primary-action" home, a calendar, a stats view, a profile) plus a
social tab. Five is the *maximum* a bottom nav should carry; beyond five, use "More." At 5 tabs each is
20% width ≈ 78px on a 390px phone — a comfortable target.

**Assessment:** the ordering is correct — Today first (the primary job), Plan and Progress flanking it,
Profile last. The soft spot is **Friends occupying a top-level tab before its value is proven.** Social
is a retention *amplifier*, not a core loop, for our data-loving solo age-grouper. If Friends
engagement is thin, demote it into Profile (or a Today card) and reclaim the tab for the load/insights
view §4 argues for. Don't sink UI real estate into an unvalidated bet.

The nav itself is well-built: a champagne underline that *slides* to the active tab (`.nav-indicator`),
an icon "bounce" on activation, `aria-current="page"`, `haptic("select")` on change, and `safe-b`
padding for the home-indicator. This is native-grade nav chrome.

### 3.2 Screen-by-screen critique + target patterns

#### Today (`components/app/TodayTab.tsx`) — the home screen
**What it does:** time-aware greeting + streak → race countdown hero (`RaceCountdown`) or fitness hero →
optional offline banner → coach "why this plan" note → readiness prompt/summary → **Today's session(s)**
→ **Up next** → **week-at-a-glance** card (phase, progress ring, `PhaseBar`, focus).

**Verdict: this is the app's best screen and the reason it works.** It answers "what do I do today?"
above the fold and "what's coming?" right below — the two questions the user actually has. The staggered
`animate-fade-up` gives it a composed, premium assembly. The auto-recalibration toast
(`TodayTab.tsx:29`) surfaces intelligence the user didn't ask for ("We tuned your paces from recent
sessions") — a delightful "the coach is watching" moment.

**Target patterns / sharpen:**
- The readiness prompt only appears when there *is* a session today and none logged (`TodayTab.tsx:105`).
  Good — no nag on rest days. But once logged, the summary row is quite plain; a low-readiness day is the
  highest-value moment to *reassure* ("we softened today's hard set"), and the copy already exists in the
  sheet — surface it here too.
- On a rest day the screen can feel empty (rest card + up-next). This is the ideal spot for the
  missing **load/recovery panel** (§4.6) — "your fitness is trending up; today's rest is banking it."
- Consider a one-glance "week volume" number on the week card (e.g. "4.2 / 6.0 h") beside the
  session-count ring; hours are the currency triathletes actually budget.

#### Plan (`components/app/PlanTab.tsx`) — the calendar
**What it does:** a horizontally-scrolling week-pill selector (race/recovery weeks badged), a week header
with phase + target hours + prev/next steppers + a "This week" jump, a 7-day `DayStrip` (date + up-to-3
zone dots per day), a focus note, then a full vertical **agenda** (each day's sessions as
`SwipeableWorkout` rows).

**Verdict: strong, and correctly chooses list-over-grid for mobile.** A month grid can't show workout
detail on a 390px screen; the vertical agenda + compact `DayStrip` overview is the right small-screen
answer (the "stack vertically, one-thought-per-screen" rule). The week-pills give fast phase navigation
without a date-picker. `scrollIntoView({inline:"center"})` keeps the selected week centered — a nice touch.

**Target patterns / sharpen:**
- The `DayStrip` dots encode `--z{primaryZone}` with reduced opacity for skipped. Good dual signal, but
  three tiny dots is the ceiling of what's legible; a day with a brick + swim + strength truncates. Fine.
- **The phase story is under-told here.** `PhaseBar` (base→build→peak→taper) lives on *Today*, not Plan.
  Plan is where a curious athlete asks "where am I in the arc?" — put a full-width `PhaseBar` at the top
  of Plan, above the week pills, so scrolling weeks maps to phases visually.
- Swipe actions on workout rows (`SwipeableWorkout`) are a native-feel win, but discoverability is the
  classic swipe problem — a first-run coach-mark or a peeking action edge would help users find "skip /
  done" without opening the sheet.

#### Workout detail (`components/app/WorkoutDetail.tsx`) — the single most important dataviz screen
**What it does:** a bottom `Sheet` with: discipline-tinted header, totals (duration/distance/intensity),
**the `IntervalBar` "Shape" silhouette**, a "Why it matters" purpose card, the *written-out structure*
(warm-up / main set / cool-down, with `RepBlock` "×N" groups and per-`Step` zone dot + target pace), a
"How it went" panel once logged, and an action stack (start guided, mark complete, move/swap/skip, `.FIT`
export, ask-the-coach).

**Verdict: this is best-in-class, and it's where our dataviz philosophy is clearest.** The combination of
(1) an at-a-glance `IntervalBar` shape and (2) a fully written, zone-dotted, pace-targeted step list is
exactly how TrainingPeaks and Zwift present a structured workout — a glanceable silhouette *plus*
executable detail. The "Why it matters" card is a differentiator: it turns a workout from a chore into a
*reason*, which is coaching, not logging (§7). The section grouping (`sectionOf`) and the `RepBlock`
"×N" badge over an indented, left-ruled child list is precisely the right way to show interval
repetition without a wall of duplicated rows.

**Target patterns / sharpen:**
- Targets show as `tv.primary` + `Z4`. Excellent — pace *and* zone, dual-encoded. Keep both; never drop
  the zone numeral in favor of colour alone.
- The action stack is long (start, complete, move, swap, did-something-else, skip, export, ask-coach).
  That's a lot of buttons. The primary path (start guided / mark complete) is well-separated at top;
  consider collapsing the four secondary actions behind a single "Adjust" disclosure to reduce the
  visual weight below the fold.
- `.FIT` "Export to watch" is a quietly huge competitive feature (it's how a PWA competes with Runna's
  native watch push). It's currently a ghost button near the bottom. For a Garmin/Wahoo user this is a
  headline capability — give it more prominence for users we know have a device (see 05).

#### The guided player (`components/app/WorkoutPlayer.tsx`) — the run-time surface
**What it does:** full-screen takeover, giant zone-tinted countdown numeral (`clamp(4rem,22vw,7rem)`),
step description + target + cue, next-step peek, transport controls, overall progress bar. Plus
**audio**: TTS step announcements + Web Audio beeps at 3-2-1 and on transition, a **wake-lock** to keep
the screen on, and `haptic()` on transitions. Ends on a `celebrate` trophy → "log this session."

**Verdict: this is the feature that makes Trifecta feel like an app, not a website.** Wake-lock, spoken
cues, and full-screen focus are native-grade and directly attack the PWA perception gap. It also
degrades safely — every audio/wake-lock call is guarded and no-ops where unsupported.

**Target patterns / sharpen:**
- The transport glyphs are text characters (`❚❚`, `▶`, `⏮`, `⏭`). They render, but crisp icon SVGs (we
  have an icon set, `components/app/icons.tsx`) would look less "web." Small polish, visible payoff.
- Audio-cue on/off is a per-session toggle that doesn't persist. Persist it.
- This is a *hands-busy, eyes-occasional* context (you're swimming/riding). The numeral is huge (right),
  but the target pace is `text-base text-muted` — bump target/next-step legibility for a sweaty glance.

#### Progress (`components/app/ProgressTab.tsx`) — the "am I getting fitter?" story
**What it does:** three stat tiles (streak/sessions/hours with `CountUp`), a **"Fitness" area-line
chart**, a **weekly-volume bar chart** (target vs completed), a records list, and a discipline
time-breakdown of horizontal bars.

**Verdict: good bones, but this is where our biggest dataviz opportunity sits (see §4).** The pieces are
well-crafted — the fitness line self-draws via `stroke-dashoffset`, the volume bars grow on mount with
staggered delays, the discipline bars are discipline-coloured with icons. The empty states are humane
("Your fitness curve starts filling as the weeks bank").

**Target patterns / sharpen:**
- **The "Fitness" chart is not a Performance Management Chart.** It's `stats.fitness` — a banked-work
  proxy, single accent line, "rises as you bank training, eases when you rest." Honest, but it under-sells
  the moat. Our whole competitive story (vs Runna) is readiness- and load-aware coaching; Progress is
  where we should *show* CTL/ATL/TSB (fitness/fatigue/form). See §4.6 for the exact target.
- The weekly-volume encoding is subtle: a gray "target" bar with a fill whose height is `done/target`.
  Two athletes can't tell "did I hit target?" at a glance because the fill is a *ratio within* the bar,
  not an overlaid target line. **Prefer the TrainingPeaks/Intervals convention: a solid completed bar
  with a thin target *line/marker* across it** — the "did I hit the mark?" read is then instant.
- Records + discipline breakdown are motivational and correct. The closing coach line ("This is how
  race-day fitness gets built") is exactly the right voice.

#### Onboarding review & welcome — covered in §2. The `WelcomeScreen` self-drawing route
(`components/WelcomeScreen.tsx`) deserves a callout: it inks a swim→T1→bike→T2→run→finish route in the
three discipline colours as one gesture, then breathes a finish marker. It's restrained, on-brand
(motion in service of the "one line, three sports" idea), respects reduced-motion, and anchors the CTA in
the thumb zone. This is how to do a hero animation in a `Paper` system — it *means* something.

---

## 4. Data visualization for athletes (the hard, high-value part)

This is where a training app is won or lost. Our user *loves* data but is time-crunched — so every chart
must pass the **glance test**: the primary answer readable in under a second, detail on demand. The
governing principles (and the `dataviz` skill) apply; below they're specialized to our screens.

### 4.1 The seven things we visualize
1. **A single workout's structure** (segments/zones/intervals) — the "shape."
2. **The weekly plan** (calendar/agenda).
3. **Progress over a plan** (are you getting fitter?).
4. **Training load** — CTL/ATL/TSB (fitness/fatigue/form). *Currently missing.*
5. **Readiness** (daily morning check).
6. **Race prediction** (projected finish).
7. **Phase/periodization** (where in the arc).

### 4.2 Zone colour: the load-bearing palette
Our zone ramp (`--z1..z5`, blue→green→amber→orange→red) is the field standard (Zwift, Garmin, Orange
Theory all converge on it), and being field-standard is itself valuable — a triathlete already reads
"red = VO2." The math behind each zone lives in `lib/zones.ts` (`%FTP`, pace multipliers, CSS offsets,
%HRmax, RPE) so a target is never blank.

**Colour-blindness is the risk, and we mostly mitigate it correctly.** For deuteranope/protanope
viewers, Z2-green vs Z3-amber, and Z4-orange vs Z5-red, are the confusable pairs. We survive because
**the zone numeral rides with the colour nearly everywhere** — `WorkoutCard`'s `Z4` badge,
`WorkoutDetail`'s `Z4` on each step, `IntervalBar`'s `title="Z4"`. This dual-encoding is the correct,
WCAG-aligned pattern ("don't rely on colour alone"). **Rules going forward:**
- Never ship a zone chart where hue is the *only* channel. Add the numeral, a label, or a redundant
  encoding (height, position, texture).
- `IntervalBar` already does the best version: it double-encodes zone as *both* colour *and* bar height
  (`height * (0.5 + zone/5 * 0.5)`, `IntervalBar.tsx:45`). Copy that pattern.
- When we add dark mode, re-check zone contrast on the dark field — amber Z3 (`#d3a12b`) especially will
  need lightening to stay distinct from green and orange.

### 4.3 The workout "shape" — `IntervalBar` (our model component)
`components/app/IntervalBar.tsx` flattens nested segments (expanding `repeat`), converts distance-based
steps to time via nominal speeds, and lays out duration-proportional blocks; rest blocks are shorter and
dimmed. This is the single most useful "read a session at a glance" component and it's the visual DNA we
should extend: **proportional, zone-coloured, dual-encoded, no axes needed.** It's exactly the
Zwift/TrainingPeaks workout-graph convention, correctly rebuilt for a small screen (no labels, just
shape). Reuse it in the Plan agenda (a mini shape on each row) and in the coach's explanations.

### 4.4 The plan calendar — list beats grid on mobile
Covered in §3.2 (Plan). The principle: on a phone, a **vertical agenda + compact 7-day strip** carries
more usable information than a month grid. The `DayStrip` zone-dots are the glanceable layer; the agenda
is the detail layer. This is the correct two-tier structure.

### 4.5 Race prediction — the hook, visualized
`lib/predict.ts` produces `currentSec` / `projectedSec` / `gainSec`. It's rendered as a big serif
tabular numeral with a "≈X faster than today's fitness" line (`ReviewStep`, and the `RaceCountdown` hero
shows a live "Projected" time). This is emotionally the most important number in the product. **Target
pattern:** a small "projection over time" sparkline on Progress — current fitness → projected finish as
the weeks bank — would turn a static number into a *trajectory*, the single most motivating framing
("the line is bending toward your goal"). The data already exists; it's a viz away.

### 4.6 Training load — the missing chart, and our moat
**This is the highest-value gap in the product.** We have readiness (§4.7) but no fitness/fatigue/form
trend. The industry-standard visualization is the TrainingPeaks **Performance Management Chart (PMC)**:
- **CTL (Fitness)** — 42-day exponentially-weighted average of daily load; the slow blue line.
- **ATL (Fatigue)** — 7-day EWMA; the fast red line.
- **TSB (Form) = CTL − ATL** — the "freshness" line; negative in a build (correct), positive on race day.

For Trifecta this chart is *strategic*, not cosmetic: our competitive thesis vs Runna is "genuinely
injury-aware / readiness-adaptive planning" (see the Runna doc §0 and [02](02-training-load-and-readiness.md),
[03](03-injury-and-load-management.md)). A visible load/form chart is the proof of that claim. **Target
pattern, tuned for `Paper` and small screens:**
- Don't ship the busy three-line-plus-bars PMC verbatim — it's a desktop coach's tool and fails the
  glance test. Instead: **one hero number** — today's Form/readiness state in plain language ("Fresh,"
  "Building," "Deep in it") — over **one restrained trend**: an accent CTL line with a subtle ATL shadow,
  and TSB shown as the *fill between them* tinted by state. This is the WHOOP move: compress multi-input
  data into one glanceable answer ("train hard" / "ease off"), detail on tap.
- Colour discipline: Form is the one place a green/amber/red *state* band is justified (it's a
  recovery/readiness signal, and our user already reads WHOOP's green/yellow/red vocabulary). Reuse
  `--success`/`--warning`/`--danger`, and always pair the colour with a word.
- Home it on Progress (the "are you fitter?" screen) and surface *today's* one-word state on Today's
  hero/rest-day card.

### 4.7 Readiness — the thing Runna never built, well-designed already
`ReadinessSheet.tsx` + `lib/readiness.ts`: three 1–3 taps (sleep / legs / energy) → 0–100 score → band
(low/ok/high), and a low score *actually eases today's hard session* (`easeUpcoming`) with an honest
toast ("Rough morning noted — we softened today's hard work"). This is exemplary: **ten seconds, and it
changes the plan.** The viz is minimal by design (a score + a coloured number), which is right for a
10-second interaction — don't over-chart it. The one addition worth making: a **readiness *history*
strip** (last 7–14 days as small coloured cells) on Progress, so the athlete sees the pattern ("I'm
always wrecked on Mondays") — the same data, a trend instead of a moment. This is the Oura/WHOOP
"readiness over time" pattern and it's cheap given we already store `plan.readiness[date]`.

### 4.8 Chart legibility on small screens — the house rules
Synthesized from mobile-dataviz research and our own components:
1. **One screen, one thought.** Each card answers exactly one question. Progress already does this
   (fitness / volume / records / breakdown as separate cards).
2. **Glance first, detail on tap.** Big answer, small support. The `RaceCountdown` hero nails it (huge
   day count, small projection).
3. **≤3–4 colours per view,** and reuse the same colour for the same meaning across the app (we do:
   discipline and zone tokens are global).
4. **Prefer marks that need no axis.** Sparklines, proportional bars, rings, coloured cells — all read
   without gridlines. Our `IntervalBar`, `ProgressRing`, `PhaseBar`, day-dots follow this.
5. **Tabular numerals for anything that changes** (`.tabular-nums` / `tnum`) so numbers don't jitter as
   they animate — already used pervasively. Good.
6. **Animate to explain, not to decorate.** Self-drawing lines and count-ups direct attention to the
   *change*; they're on a reduced-motion switch. Keep that bar.
7. **Never horizontal-scroll a chart the user must read whole.** Trend charts fit the column width;
   only the *selector* (week pills) scrolls.

---

## 5. Prioritized UX backlog

Ranked by (impact on the core loop / competitive moat) ÷ (effort). "Impact" weighs time-to-value,
retention, and the vs-Runna differentiation. Cross-refs point at the section with the detail.

### P0 — do these first (moat + core loop)
1. **Ship the training-load / Form chart.** The single highest-value gap. Turn readiness + completed
   load into a glanceable CTL/ATL/TSB story (one word + one restrained trend, WHOOP-style compression).
   It *is* our differentiation made visible. → §4.6. Depends on [02](02-training-load-and-readiness.md),
   [04](04-planning-engine-algorithm-design.md).
2. **Add a fast-path through onboarding.** Let a user reach a plan in ~60s with everything defaulted;
   push frequency/strength/schedule/PRs/injuries to optional "refine" steps or Profile. Every inline
   optional step is a drop-off cliff. → §2.3.
3. **Fix the weekly-volume chart encoding** on Progress: solid completed bar + thin *target line/marker*
   (not a ratio-fill), so "did I hit target?" is instant. → §3.2 Progress, §4.
4. **Persist the onboarding draft to `localStorage`** so a bail-out mid-flow can resume — and becomes a
   re-engagement hook. → §2.3.

### P1 — high value, moderate effort
5. **Readiness history strip** (7–14 coloured cells) on Progress — the "am I always wrecked on Mondays?"
   pattern from the data we already store. → §4.7.
6. **Elevate `.FIT` export** for users we know have a device; it's how a PWA out-competes Runna's watch
   push. → §3.2 Workout detail, [05](05-wearable-and-data-ecosystem.md).
7. **Move the full `PhaseBar` to the top of Plan** so scrolling weeks maps to the periodization arc. → §3.2 Plan.
8. **Onboarding progress labels** ("Step 4 of 8 · Experience") to cut "how much longer?" anxiety. → §2.3.
9. **First-timer race-type explainer** on `RaceStep` (Olympic vs 70.3 vs 140.6) — de-risk the
   highest-stakes first choice. → §2.3.
10. **Decide dark mode on purpose.** Either commit to `Paper`-light with a written rationale, or ship a
    dark theme (the token architecture supports it) and re-tune zone contrast. → §1.5, §8.

### P2 — polish & de-risking
11. **Bump secondary touch targets** — 36px steppers and tiny `✕` removes to ≥44pt for one-handed
    comfort (they clear WCAG's 24px but not Apple's guidance). → §8.
12. **Swipe-action discoverability** on `SwipeableWorkout` (coach-mark or peeking edge). → §3.2 Plan.
13. **Collapse Workout-detail secondary actions** behind an "Adjust" disclosure. → §3.2.
14. **Projection-over-time sparkline** ("the line is bending toward your goal"). → §4.5.
15. **Watch Friends' engagement;** be ready to demote it out of the bottom nav to reclaim a tab. → §3.1.
16. **Icon-ify the `WorkoutPlayer` transport glyphs**, persist the audio-cue toggle, and boost target/next
    legibility for sweaty glances. → §3.2.
17. **Design-system hygiene:** fix the stale `--z*` "gray ramp" comment, retire the `.text-gradient` /
    `.accent-gradient` misnomers or rename them, and drop the redundant `--sun`/`--tide`. → §1.2.

---

## 6. Mobile-first & PWA-specific UX

### 6.1 What's already right
Trifecta is genuinely mobile-first, not a desktop app squeezed down:
- **Safe areas everywhere.** `.safe-t` / `.safe-b` use `env(safe-area-inset-*)`; Today/Plan/Progress pad
  their tops with `calc(env(safe-area-inset-top) + 1rem)`. Installed on a notched iPhone, nothing hides
  under the notch or home-indicator.
- **A single `max-w-md` column,** so the layout is designed for the phone and merely centers on larger
  screens — the honest mobile-first posture.
- **Thumb-zone CTAs.** Onboarding and Welcome push their primary buttons to the bottom with a
  `flex-1` spacer (`WelcomeScreen.tsx:57`), landing them where the thumb rests.
- **Haptics as a first-class channel** (`lib/haptics.ts`, `haptic("select"|"success"|"warning"|...)`) on
  nav, selection, completion. This is a native-feel signal most web apps never send.
- **`overscroll-behavior-y: none`** kills the rubber-band/pull-to-refresh that screams "browser."
- **`-webkit-tap-highlight-color: transparent`** removes the grey tap flash. Small, but it's the
  difference between "web page" and "app."
- **Gesture ownership:** `.pan-y` / `touch-action` lets the browser keep vertical scroll while the app
  owns horizontal swipe (tabs, workout rows) — no scroll-jank fights.

### 6.2 PWA installation & the perception gap
- **Manifest** (`app/manifest.ts`): `display: standalone`, `orientation: portrait`, name/short_name,
  categories, and 192/512 + maskable icons. This is a correct, installable manifest.
- **`InstallHint.tsx`** detects `beforeinstallprompt` for a custom in-app install button (more effective
  than the browser's default banner), and — crucially — **has a hand-written iOS path** ("tap Share →
  Add to Home Screen"), because iOS Safari doesn't fire `beforeinstallprompt`. It also detects
  `display-mode: standalone` and hides itself once installed. This is the state-of-the-art PWA install
  UX; most PWAs botch the iOS case.
- **Offline:** a service worker (`components/ServiceWorker.tsx`, `scripts/stamp-sw.mjs`) plus an
  `offline` flag surfaced as a Today banner ("showing your saved plan… changes sync when you reconnect,"
  `TodayTab.tsx:76`). The right move: the plan is *local-first*, so a subway swim session still works.

**Closing the perception gap (the PWA's real job):** the features that make Trifecta read as native are
already here — wake-lock during workouts, TTS/beep audio cues, haptics, full-screen standalone display,
install-to-home-screen, offline plan. **Lean into these in marketing and in-product copy** ("runs
full-screen, like a real app," which `InstallHint` already says). The remaining native envy is
push-to-watch (Runna's turf); `.FIT` export is our bridge (§4, [05](05-wearable-and-data-ecosystem.md)).

### 6.3 Performance is UX
`Paper` helps here: no blur, no heavy gradients, solid fills, hairline borders — all cheap to paint. The
`Celebration` confetti is a `<canvas>` that costs nothing when idle and never touches layout
(`Celebration.tsx`). SVG charts are tiny and self-contained. Keep this discipline: a training app is
opened half-awake before dawn; a janky 5am launch is a churned user. Budget: interactive in <2s on a
mid-tier Android, 60fps on the workout timer.

---

## 7. Motivational & emotional design

The difference between a *logger* and a *coach* is voice and grace. Trifecta already leans coach, which is
the retention-correct choice (see [06](06-behavioral-science-and-retention.md)).

### 7.1 The coach voice in UI copy
The microcopy is consistently second-person, warm, and *reason-giving*, not clinical:
- Rest day: "Recovery is where you get stronger. Sleep, hydrate, refuel." (`TodayTab.tsx:153`) — reframes
  the empty state as *progress*, not absence.
- Every workout carries a "Why it matters" purpose card (`WorkoutDetail.tsx:168`) — coaching, not a task.
- Onboarding: "We'll forge a full day-by-day plan… personalized to you"; injuries: "type it like you'd
  text a coach."
- Low readiness: "We'll ease today's hard session so a rough start doesn't set you back."

**Rule:** UI strings state the *why*, address the athlete directly, and never scold. This is the brand's
personality and it's more distinctive than any visual.

### 7.2 Celebrating completion
- `Celebration.tsx` — a restrained, sub-second confetti spark on finishing a session (a bigger "burst"
  for milestones), theme-tinted, reduced-motion-aware. "Restrained by design: a small handful of
  confetti, a quick arc, gone in under a second."
- The guided player ends on a `celebrate` trophy + "That's in the bank." (`WorkoutPlayer.tsx:161`).
- `computeStreak` surfaces a flame streak on Today/Progress — but **note the streak trap below.**

### 7.3 Handling missed workouts — the retention hinge
This is where most fitness apps fail and where Trifecta is *ahead*. Research is blunt: streak-shame and
all-or-nothing framing are what make people quit; the loudest Runna beginner complaint is plans that
don't downshift and then feel punishing. Trifecta's posture:
- **Rich, guilt-free recovery paths** in `WorkoutDetail`: *move day*, *swap sport* ("swap for an easy…"),
  *did something else* (credits what you actually did), *skip* (reversible). Missing a session is a
  *choice with options*, not a failure.
- **The plan adapts around misses** rather than accusing (`lib/adapt.ts`, `easeUpcoming`), and readiness
  *pre-empts* a bad session before it hurts you.
- **Positive rest framing** and **compliance shown as a neutral badge** (`WorkoutCard` `comp.label`),
  not a red X.

**The one risk to manage: the streak.** Streaks are motivating *and* the classic source of "streak
anxiety" — one miss → shame → abandonment. Our streak is currently a plain counter (`computeStreak`).
**Guardrails to add before leaning on it:** design for the comeback — count "banked sessions" as the
hero metric (already on Progress), treat a *logged rest or an eased day* as streak-preserving, and
never render a broken streak as a loss (surface the longest streak and the next opportunity instead).
Consistency over months must always beat perfection over days. → [06](06-behavioral-science-and-retention.md).

### 7.4 Illustration & animation, used with restraint
The `WelcomeScreen` self-drawing route and the `LoadingAnimation` race-course are the two "delight"
moments, and both are earned: they *mean* something (three sports as one line; the plan being forged).
The rule the codebase already follows: **animation is signature, not decoration, and always has a
reduced-motion off-switch.** Don't add ambient motion that doesn't carry meaning.

---

## 8. Accessibility & the a11y gate

### 8.1 Why we already gate on it
The repo ships `axe-core` and `eslint-plugin-jsx-a11y` (see `package-lock.json`), and the `verify-ui`
workflow runs a typecheck **+ an a11y gate** before anything is "done." Accessibility is a *stop
condition*, not a nicety — correct, because our user base skews older age-groupers (presbyopia, and they
train in bright outdoor glare and pre-dawn dark) and because it forces the dual-encoding discipline that
also makes the UI clearer for everyone.

### 8.2 What we do well
- **`prefers-reduced-motion` honored globally** (`globals.css:290`) — every entrance/ambient animation
  and the nav slide are killed. Above the category bar.
- **Colour is never the only signal** for zones (numerals ride along) or status (icons + words). This is
  the WCAG 1.4.1 "use of colour" requirement, satisfied by construction.
- **Semantic affordances:** `aria-current="page"` on the active tab, `aria-label` on icon-only controls
  (steppers "Fewer/More", close "✕", player transport), `aria-hidden` on decorative SVG/emoji.
- **High base contrast:** near-black `#0f0f0f` ink on white is ~19:1 — far past WCAG AAA. `text-muted`
  `#6e6e6b` on white ≈ 5.0:1 (passes AA for body); `text-faint` `#a6a6a2` ≈ 2.6:1 — **only safe for
  large/decorative text, never body.** Audit any `text-faint` used at small sizes.

### 8.3 Where to tighten
- **Touch-target size.** WCAG 2.2 §2.5.8 (AA) sets a 24×24px floor, and we clear it. But Apple's HIG
  (44pt) and Material (48dp) are the *comfort* bar, and several controls sit below it: the 36px steppers
  (`h-9 w-9`, `Onboarding.tsx:438`), the chip-remove `✕`, and some inline text buttons. For a one-handed,
  moving user these are mis-tap risks. Bump the *hit area* (padding/`::before`) even if the visual stays
  small. → P2 backlog.
- **Zone-colour contrast in a future dark mode.** The amber/orange zones are the weak links on any field;
  re-tune on the dark background and re-verify against a deuteranopia simulator (§4.2).
- **Screen-reader labeling of charts.** The SVG charts are `aria-hidden` (fine — they're decorative
  duplicates of numbers shown in text), but as we add the load chart, give it an accessible text summary
  ("Fitness trending up; form fresh") so the *meaning* is available non-visually.
- **Focus-visible states.** The mobile app is touch-first, but installed PWAs get used with keyboards
  and switch devices; verify `:focus-visible` rings exist on all interactive elements (the `.input`
  focus ring is good; audit buttons/cards).
- **Dynamic type / zoom.** Test at 200% browser zoom and large system font — the `clamp()`-based display
  sizes help, but check that fixed `text-[0.66rem]` eyebrows don't fall below legibility for
  presbyopic users.

### 8.4 The rule
Every new screen ships with: colour never the sole signal, reduced-motion respected, icon-only controls
labeled, hit areas ≥44pt, and it passes the axe gate. Non-negotiable — the gate enforces it anyway.

---

## 9. Cross-references & sources

### Sibling knowledge docs
- **[02 — Training Load & Readiness](02-training-load-and-readiness.md)** — the meaning behind the Form
  chart §4.6 argues for; readiness math behind §4.7.
- **[03 — Injury & Load Management](03-injury-and-load-management.md)** — why the readiness-eases-today
  behavior and injury intake exist; the moat §4.6 makes visible.
- **[04 — Planning Engine](04-planning-engine-algorithm-design.md)** — the `Plan`/`Workout`/`Segment`
  data model every screen in §3 renders.
- **[05 — Wearable & Data Ecosystem](05-wearable-and-data-ecosystem.md)** — the watch/run-time surface;
  `.FIT` export (§4, P1) and the push-to-device gap.
- **[06 — Behavioral Science & Retention](06-behavioral-science-and-retention.md)** — the evidence base
  for the coach voice, celebration, and the streak guardrails in §7.
- **[08 — Software Platform & Security](08-software-platform-and-security.md)** — the PWA/service-worker
  plumbing behind §6.
- **Competitive reference:** [docs/research/runna-competitive-analysis.md](../research/runna-competitive-analysis.md)
  — Runna's onboarding masterclass (§2), watch strategy (§6), and the readiness/injury gap that is our
  wedge (§4.6).
- The **`dataviz` skill** codifies the palette/mark/legend rules §4 specializes here.

### Key source files (ground truth for this doc)
`app/globals.css` (design system) · `app/page.tsx` (top-level flow) · `app/manifest.ts` (PWA) ·
`components/onboarding/Onboarding.tsx` · `components/WelcomeScreen.tsx` · `components/LoadingAnimation.tsx`
· `components/Reactor.tsx` (now static) · `components/app/TodayTab.tsx` · `PlanTab.tsx` · `ProgressTab.tsx`
· `WorkoutDetail.tsx` · `WorkoutPlayer.tsx` · `IntervalBar.tsx` · `WorkoutCard.tsx` · `BottomNav.tsx` ·
`ReadinessSheet.tsx` · `widgets.tsx` · `Celebration.tsx` · `InstallHint.tsx` · `lib/zones.ts` ·
`lib/format.ts` · `lib/readiness.ts` · `lib/predict.ts`.

### External research
- Nielsen Norman Group — [Mobile App Onboarding](https://www.nngroup.com/articles/mobile-app-onboarding/)
  (minimize onboarding, explain *why* you ask, defer visual choices, skippable, one-concept-per-card).
- Progressive disclosure & deferred signup — [UXPin](https://www.uxpin.com/studio/blog/what-is-progressive-disclosure/),
  [Digia — mobile onboarding activation](https://www.digia.tech/post/mobile-app-onboarding-activation-retention/)
  (deferred signup lifts activation 10–30%; contextual disclosure 53%→75% completion).
- Fitness-app onboarding benchmarks — [Stormotion](https://stormotion.io/blog/fitness-app-ux/),
  [Tubik — gym app case study](https://blog.tubikstudio.com/case-study-manuva-uiux-design-gym-fitness-app/)
  (first value in ~60s; simplified onboarding → +50% retention in cited studies).
- TrainingPeaks PMC — [A Coach's Guide to ATL, CTL & TSB](https://www.trainingpeaks.com/coach-blog/a-coachs-guide-to-atl-ctl-tsb/),
  [Fitness (CTL)](https://help.trainingpeaks.com/hc/en-us/articles/204071884-Fitness-CTL),
  [Form (TSB)](https://help.trainingpeaks.com/hc/en-us/articles/204071764-Form-TSB).
- WHOOP glanceable readiness UI — [925 Studios design breakdown](https://www.925studios.co/blog/whoop-design-breakdown),
  [WHOOP Recovery 101](https://www.whoop.com/us/en/thelocker/how-does-whoop-recovery-work-101/)
  (compress many inputs to one green/yellow/red answer; dark field so the signal pops).
- Zone-colour convention — [Zwift Power Zone Colors](https://zwiftinsider.com/power-zone-colors/),
  [Ultrahuman — HR zone colours](https://blog.ultrahuman.com/blog/what-are-heart-rate-zone-colours/)
  (blue→green→amber→orange→red is the shared vocabulary).
- WCAG 2.2 target size — [2.5.8 Target Size (Minimum)](https://www.allaccessible.org/blog/wcag-258-target-size-minimum-implementation-guide)
  (24×24px AA floor; Apple 44pt / Material 48dp for comfort).
- Mobile data-viz — [BounDev mobile viz guide](https://www.boundev.com/blog/mobile-data-visualization-design-guide),
  [Kellton — data-viz mistakes](https://www.kellton.com/kellton-tech-blog/data-visualization-best-practices-every-app-developer-should-know)
  (one-screen-one-thought; ≤3–4 colours; touch-optimized).
- PWA UX — [MDN — Best practices for PWAs](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Best_practices),
  [Microsoft Learn — PWA best practices](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/best-practices)
  (custom install UX; offline as an app-like requirement; iOS Safari caveat).
- Retention & streak psychology — [Ogamic — streak anxiety](https://ogamic.com/blog/streak-anxiety-from-fitness-apps),
  [GainStrong — why fitness apps make consistency harder](https://getgainstrong.com/blog/why-fitness-apps-make-consistency-harder)
  (design for the comeback; streak shields / unified streaks; lighter alternatives beat guilt).
- Runna sentiment — [TechRadar review](https://www.techradar.com/health-fitness/fitness-apps/runna-review),
  [Tom's Guide review](https://www.tomsguide.com/reviews/runna-app) (clear plans praised; adaptivity/beginner
  aggression and support are the complaints).

---

*Living document. When you change a screen, update the screen-by-screen critique (§3) and, if you moved a
number or a colour, the design-system section (§1). The backlog (§5) is the running to-do; prune it as
items ship.*
