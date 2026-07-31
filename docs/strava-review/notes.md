# What Strava actually rewards / punishes in the review

Research done 2026-07-31 before submitting Trifecta (client id 267057).
Sources: Strava's own [developer program KB](https://communityhub.strava.com/developers-knowledge-base-14/our-developer-program-3203),
[the June 2026 program update](https://communityhub.strava.com/insider-journal-9/an-update-to-our-developer-program-13428),
[the API FAQ](https://communityhub.strava.com/developers-knowledge-base-14/strava-api-faq-12906),
community threads on approvals/denials.

## What reviewers explicitly say they look for

1. **Complementary experience** — the app should complement Strava, not replace
   or route around it. Lead with this in the description.
2. **Athlete privacy** — no sharing with third parties, no unauthorized use,
   never expose data to other users.
3. **API-compliant technical practices** — webhooks not polling, proper
   token/deauth handling, minimal scope, efficient calls.
4. **Brand compliance** — official "Connect with Strava" button asset per the
   brand guidelines kit.
5. **Real growth** — currently at the 10-athlete cap with genuine users.

## What triggers denial (call these out proactively, not just avoid them)

- **NEW rule (2026):** apps routing Strava data through **third-party AI tools /
  LLMs / intermediary platforms** are being rejected. If your app has any LLM
  feature, explicitly disclaim that Strava data is not sent through it.
- **Doesn't complement Strava** — e.g. clones Strava's social/leaderboard, or
  is generic analytics with no unique athlete value.
- **Inefficient API usage** — polling when webhooks would work, hitting daily
  rate limits with a small user base (Strava's docs literally say if you have
  <100 users and are hitting rate limits, "the problem is most likely
  inefficient usage").
- **Privacy/security concerns** — exposing athlete data to other users,
  aggregating across athletes without opt-in, unsecured storage.
- **Non-compliance with API Agreement / API Policy / brand guidelines** — any
  of the three checkboxes unchecked is auto-fail-adjacent.

## What Trifecta specifically should say

- **Lead with "complementary to Strava"**, define the split (Strava records +
  socialises; Trifecta plans + adapts). Done.
- **Proactively disclaim the AI rule**: our Gemini feature only sees
  user-typed injury notes, never Strava data, and it's opt-in. Done.
- **Volunteer the technical evidence**: webhook subscription, deauth handler,
  single-flighted refresh, minimal scope, capped backfill. Done.
- **Read-only** stated multiple times. Done.
- **Brand asset**: pre-offer to swap in the official button if they'd prefer
  it. The current in-app affordance is a monochrome placeholder chevron.

## Timeline expectations

- No SLA published.
- Community reports: 1 week best case, 2-4 weeks typical, 6-8 weeks worst.
- Strava does NOT provide individual feedback on rejections. If denied, we
  read between the lines and resubmit.
