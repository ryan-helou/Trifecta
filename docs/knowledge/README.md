# Trifecta Knowledge Base

> The eight realms of expertise Trifecta must master to become a category-defining
> triathlon coaching product. Each doc is a **canonical, code-grounded reference** —
> not a blog post. It pairs the real domain science / engineering with an honest
> audit of what our codebase does today (cited to `file:line`) and a set of
> **decision rules to read _before_ building in that realm**.

**Standing rule:** before you design or change anything that touches one of these
realms — a plan-engine behaviour, a load/readiness feature, injury logic, a device
integration, an onboarding/retention mechanic, a screen, or the platform/security
posture — **read the relevant doc's §4 (Principles & decision rules) first.** This is
wired into [AGENTS.md](../../AGENTS.md) so every session honours it. Keep these docs
current as the code and the field evolve (each carries a "Last researched" date).

Last full research pass: **2026-07-22** · 8 docs · ~4,560 lines · every "How this maps
to Trifecta" section cites real functions in the engine.

---

## The eight realms

| # | Doc | What it governs | Read before you… |
|---|-----|-----------------|------------------|
| 1 | [Exercise Physiology & Periodization](01-exercise-physiology-and-periodization.md) | The science that makes a plan *correct*: energy systems, zones, periodization, taper, the multisport interference effect, female/masters physiology | change phase structure, zones, intensity distribution, taper, or session design |
| 2 | [Training-Load Quantification & Readiness](02-training-load-and-readiness.md) | The math that makes a plan *adapt*: TSS/TRIMP/sRPE, CTL/ATL/TSB (PMC), ACWR, HRV/readiness, race prediction | build load tracking, a fitness/fatigue/form chart, readiness scoring, or adaptivity |
| 3 | [Injury & Load Management + Biomechanics](03-injury-and-load-management.md) | Our stated wedge: injury epidemiology, tissue-specific loading, safe progression, return-to-load, liability & scope-of-practice | touch injury handling, load ramps, deloads, pain/red-flag logic, or medical copy |
| 4 | [Planning-Engine Algorithm & Systems Design](04-planning-engine-algorithm-design.md) | How the deterministic engine is built & evolved: constraints, scheduling, personalization, adaptivity, testing, the ~$0/plan economics | modify `lib/planEngine.ts`, add engine features, or decide rules-vs-LLM |
| 5 | [Wearable & Data Ecosystem](05-wearable-and-data-ecosystem.md) | Getting real athlete data in: Garmin/Apple/Strava/Whoop/Oura APIs, FIT/TCX/GPX, aggregators, the PWA constraint, sync reliability | add a device integration, ingest activity/recovery data, or design multi-source sync |
| 6 | [Behavioral Science & Retention](06-behavioral-science-and-retention.md) | Why users stay: churn benchmarks, habit science, activation, notifications, streaks, the North-Star metric | build onboarding activation, notifications, streaks, social, or any retention feature |
| 7 | [Product & UX Design](07-product-and-ux-design.md) | How it feels: onboarding UX, athlete dataviz, mobile-first/PWA UX, IA, motivational design, accessibility | design or restyle any screen, chart, flow, or the design system |
| 8 | [Software Platform, Reliability & Security](08-software-platform-and-security.md) | Keeping it up & legal: this forked Next.js, PWA offline/sync, Railway/Postgres scale, GDPR/FTC health-data compliance, AppSec | change infra, data model, auth, the service worker, or anything touching health data |

---

## Cross-cutting themes (where multiple realms converged)

Independent agents, researching different realms, kept landing on the same few truths.
These are the highest-signal findings:

1. **The engine plans from *prescription*, never from *reality*.** Load/fitness are
   computed off the *planned* zone, not what the athlete actually did — even though we
   already collect RPE, feel, and Strava actuals. (Realms 1, 2, 4.)
2. **The flagship moat — "readiness-adaptive vs Runna" — is now *visible* but still
   *inert*.** ✅ The fitness–fatigue–form chart shipped 2026-07-27 (`lib/load.ts`: sRPE,
   exact-EWMA CTL/ATL/TSB, form bands; rendered on Today + Progress). ⚠️ **But planning
   never reads it.** Verified 2026-07-28: `pmc` / `formStateFor` / CTL / ATL / TSB appear
   in `TodayTab.tsx` and `ProgressTab.tsx` and in **no engine file** — not `planEngine.ts`,
   not `adapt.ts`. `assessAdaptation()` still decides purely on 14-day miss-rate and
   session strain. `rampRate()` is exported and consumed by nothing. So the app can tell an
   athlete "you're Deep in it" and hand them the identical week. The chart was half the
   job; wiring form into the adaptation decision is the other half. (Realms 2, 4, 7.)
3. **We're injury-*aware* but not injury-*safe* or rehab-*aware*.** No start-date/
   trajectory on injuries (flat tax, not a recovery curve), no pain sensor, mechanism-
   blind severity (tendinopathy wants load; bone stress wants offload), and the "won't
   get you injured" pitch raises a liability bar (disclaimer/PAR-Q/red-flags) we don't
   meet. (Realms 3, 7, 8.)
4. **The data foundation for "adaptive" is thin.** We ingest Strava *summary only* and
   **zero recovery data** (HRV/RHR/sleep); `lib/fit.ts` is an encoder, not a decoder.
   The PWA blocks Apple HealthKit outright and Garmin's API is closed — so recovery data
   likely comes via Oura/Whoop direct + an aggregator. (Realms 2, 5.)
5. **Our best, most differentiated code is the forgiving adaptation logic** in
   `lib/adapt.ts` (ease when behind, *refuse to add load on good days*). It's clinically
   wise AND a textbook retention asset — but it never proactively reaches out. (Realms
   3, 6.)

## Top actionable findings (bugs & gaps the research caught)

Ranked, roughly, by leverage-per-effort:

- 🔴 **P0 security — forged-session account takeover.** `lib/auth-server.ts` falls back to
  a public hard-coded signing secret if `SESSION_SECRET` is unset. Verify it's set in
  Railway *today*. (Doc 8.)
- 🔴 **Health data → LLM, mislabeled.** `/api/intake` sends free-text injury/medical text
  to **Google Gemini** (not "Claude Haiku" as documented); free tier may train on it →
  GDPR Art. 9 + FTC Health Breach exposure. Needs a no-training tier + consent + DPA. (Doc 8.)
- 🟠 **Taper bug (full-Ironman).** `baseFraction`'s 3-week taper is non-monotone
  (0.42 → 0.55 → 0.32) — eases, loads back up, then eases. One-line fix + a property test. (Doc 4.)
- ✅ **`weeklyHoursCap` not enforced** — FIXED 2026-07-28 (session budget + post-build
  enforcement, so the cap *shapes* the week rather than truncating its tail).
- 🟠 **"No two hard days back-to-back" not implemented** — still open, now **measured**
  (2026-07-28, walking the real calendar incl. empty days): **6 Z4+ adjacencies** in an
  Oly plan, **10** in a 70.3, **14** in a full — with 2–5 three-in-a-row runs. Doc 4's
  diagnosis was exactly right, including that swim quality carries `hard:false` so a Z4
  CSS set doesn't even enter the same-day penalty — which is why `CSS Threshold Set Z4`
  dominates the measured adjacent pairs. Note: long-ride→long-run adjacency (17–31 per
  plan) is *deliberate* and must stay allowed. (Doc 4.)
- 🔴 **Sweet-spot zone mislabel — re-rated from 🟠 on 2026-07-28.** Not a cosmetic dot
  problem: a **niggle** sets `capZone: 3`, which routes to `bikeSweetSpot` at **88–94%
  FTP**, so the injury cap reduces the label and not the load. Also shows the athlete
  "76–90% FTP" and "88–94% FTP" on the same screen. (Doc 1 §5.)
- 🔴 **NEW 2026-07-28 — no rest-day floor.** A guaranteed day off is opt-in; the −1000
  guard is behind `restDayPreference != null`. Harmless at the 6-session default, but at
  8 sessions/week a 70.3 plan yields **14 off days in 147 with a 30-day unbroken streak**
  (containing a 188-min brick followed next day by a 120-min run); at 11 sessions, **6 off
  days in 224**. Most damaging default in the engine for an injury-aware product. (Doc 1.)
- ✅ **iOS notifications silently no-op** — FIXED 2026-07-27 via
  `@capacitor/local-notifications` (real OS-scheduled reminders; static import — a lazy
  `import()` of a Capacitor plugin hangs forever in the bundled WKWebView). **Analytics
  also shipped** (self-hosted `lib/analytics.ts` + `/api/events`, allowlisted names,
  numbers/booleans/short-enums only). *Caveat: an actual notification firing at its
  scheduled hour has not been observed — that needs a wall-clock wait.* (Doc 6.)
- 🟡 **No clock seam / zero tests** in the engine — `generatePlan` reads `Date.now()`
  internally, blocking golden tests for the product's core. (Doc 4.)
- 🟡 **Strength (halves overuse injury; Lauersen 2014) is off by default and un-nudged.** (Doc 3.)
- 🟡 **Interference effect unguarded** — heavy strength can stack on a hard-run day. (Doc 1.)

See each doc's §5 for its full, prioritized roadmap.

---

## How to use & maintain these

- **Reading:** start with the TL;DR, then §4 (decision rules) for how-to-build guidance,
  then §3 for what our code does today. §1–2 are the deep reference.
- **Grounding:** every "How this maps to Trifecta" section cites `file:line`. When you
  change that code, update the doc.
- **Freshness:** the fast-moving realms are 5 (device APIs/policies) and 8 (Next.js
  version + compliance law). Re-research those before relying on specifics older than a
  few months; each doc carries a "Last researched" date.
- **New realms:** the two Tier-3 "company" realms not yet documented here (market/pricing/
  GTM, and legal/brand/community) can be added as docs 09+ when we build into them.
