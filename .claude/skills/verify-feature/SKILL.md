---
name: verify-feature
description: >-
  Trifecta's concrete test gates — the exact commands + Capacitor/Maestro specifics that
  the universal `testing` protocol runs when verifying work in THIS repo. Reach for it
  whenever you're about to verify, test, or ship a Trifecta change: the plan-engine
  invariants (`npm test`), the iOS simulator self-test (`scripts/verify-ios.sh`), the
  vision eye-test on its screenshots, and the gated release (`scripts/ship-ios.sh`), plus
  the hard-won gotchas for driving the Capacitor WKWebView with Maestro. Use it together
  with the `testing` skill (which decides how much rigor the change warrants); this one
  tells you what to actually run here.
---

# Trifecta test gates

This is the project-specific half of testing: **what to run in Trifecta**. For **how much
to run** (sizing a change, the foolproof always-rules, the deep protocol for big
features), use the universal `testing` skill — this skill assumes you've sized the change
there and now need Trifecta's concrete commands.

The whole point is that the machine tests itself so Ryan isn't the bottleneck
([[bias-toward-automation]]). The self-test harness already caught a login-blocking bug
that manual "verification" missed — trust the gates, not a glance.

## Which gate for which change

- **Plan engine / training logic / correctness** (`lib/planEngine.ts`, `workouts.ts`,
  `paces.ts`, `zones.ts`, `adapt.ts`, `calibrate.ts`, load/readiness math) → **engine
  invariants**.
- **UI / native shell / a user flow / auth / onboarding** (`components/**`,
  `lib/tokenStore.ts`, `lib/api.ts`, Capacitor config, native plugins) → **simulator
  self-test + eye test**.
- **Both** → both. **API-only** (`app/api/**`) → curl the live/local endpoint for status
  + shape; add the relevant gate above if it changes plan/auth behavior.

## Engine invariants — `npm test`

Deterministic, no simulator. `test/engine.test.ts` asserts what a coach's eye judges:
determinism, positive durations + valid zones, frequency honored, safe load ramp (<35%
week-over-week between load weeks) with deloads present, taper before the race, phase
order `base→build→peak→taper`, ≥50% easy/polarized intensity, and injury-aware load
reduction.

- Run `npm test`; it must be green.
- **Added/changed engine behavior? Add an invariant for it** — old asserts don't test new
  work. Calibrate any threshold to the engine's real output first (a throwaway `tsx`
  probe), with margin, so a correct plan never false-fails.

## iOS simulator self-test — `scripts/verify-ios.sh`

Drives the real app in the WKWebView on a booted simulator via Maestro, end-to-end,
headless, exit-coded, with screenshots in `artifacts/ios/`. This replaces "install it on
my phone and click around."

- Run `scripts/verify-ios.sh` (full: build Path-B + install + run every real flow in
  `maestro/`). `SKIP_BUILD=1` reuses the last build while iterating a flow. Test login:
  `simtest_qa` / `simpass123`.
- **Added/changed a screen or flow? Add or update a Maestro flow** in `maestro/` (mirror
  `maestro/login.yaml`). Prove it green on **≥3 fresh-install runs** before it joins the
  gate; if you can't stabilize it, prefix the filename with `_` to exclude it (like
  `_onboarding-wip.yaml`) and say so — never ship a flaky gate.

### Maestro-on-Capacitor gotchas (apply them; they cost real hours to learn)

- Maestro sees the WKWebView via the **accessibility tree**: match visible **text /
  aria-label / input placeholder**, never DOM `id`/CSS.
- Text is a **full-string regex** — `"Sign in"` only matches an element whose whole text
  is exactly that; use `.*Sign in.*` to match a substring, and watch for ambiguity (a
  substring can hit a subtitle instead of the button — use the exact string for
  unambiguous buttons).
- **Type into inputs by placeholder** (`tapOn: "ironmike"`) then `inputText`.
- **Submit forms with `pressKey: Enter`** — the submit button can drop out of the a11y
  snapshot right after the keyboard dismisses.
- **Below-the-fold buttons** need `scrollUntilVisible` before `tapOn`.
- Guard every screen transition with `extendedWaitUntil` (cold launch + animations beat
  the default wait). Inspect a stuck screen with `maestro hierarchy`.

## Vision eye-test

`verify-ios.sh` saves a screenshot per screen. **Open each one** and judge it like Ryan's
eye would — layout, alignment, overflow/cut-off text, broken images, contrast, empty/error
states, "shipped or broken." Assertions prove text exists; only looking proves it looks
right. (Fully-headless auto-vision would need an `ANTHROPIC_API_KEY`, not currently set —
until then you are the vision layer on every ship, so actually look.)

## Gated release — `scripts/ship-ios.sh`

For shipping to TestFlight only: **gate 1** `npm test` → **gate 2** `verify-ios.sh` → then
`fastlane beta` (auto-increments the build number). A failing gate aborts the upload —
that's the safety, don't bypass it. Web-only changes deploy via a push to `main` (Railway
auto-deploys); no build needed.

## Cross-refs

- Sizing + always-rules + deep protocol: the universal `testing` skill.
- Domain grounding for engine invariants: [AGENTS.md](../../../AGENTS.md) + the knowledge
  base ([docs/knowledge/README.md](../../../docs/knowledge/README.md)), especially load
  management (03) and training-load/readiness (02).
- After verifying + merging: update the board via [[update-notion]] and the vault session log.
