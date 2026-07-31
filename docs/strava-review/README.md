# Strava Developer Program — review submission pack

Everything needed to submit Trifecta for an athlete-capacity increase past 10.

## When to submit

Strava's form auto-denies apps under the 10-athlete cap:

> "We require apps to have reached the 10-athlete limit on the Standard tier
> before we review requests for additional capacity. Applications that have
> not met this threshold will be denied."

Current cap: 10. Check `Number of athletes currently connected` at
<https://www.strava.com/settings/api> — only submit once it reads **10 / 10**.

## Form

<https://share.hsforms.com/1VXSwPUYqSH6IxK0y51FjHwcnkd8>

### Pre-fill

| Field | Value |
|---|---|
| First name | Ryan |
| Last name | Helou |
| Email | ryan.helou@gmail.com |
| Company Name | Trifecta |
| API Application Name | Triathlon |
| Strava Client ID | 267057 |
| Additional Apps | *(none — one app shared between Trifecta and AmaComp)* |
| Number of Currently Authenticated Users | *(read from the API dashboard at submission time)* |
| Number of Intended Users | 5,000 (12-month projection) |
| Support URL | https://amatri-production.up.railway.app/support |

### Application Description

The version submitted 2026-07-31 was tuned against Strava's own approval
signals — see `docs/strava-review/notes.md` for the research.

> Trifecta is an adaptive triathlon training platform for Olympic, 70.3, and
> Ironman athletes. It is **complementary to Strava**: Strava is where athletes
> record and share their sessions; Trifecta is the periodised, day-by-day
> training plan that adapts around their actual performance. The Strava
> integration is read-only and closes the training loop, so an athlete's
> Garmin/Wahoo/COROS/Apple Watch workout that lands on Strava automatically
> marks off the planned session and feeds our readiness/load model (CTL, ATL,
> TSB / Fitness, Fatigue, Form). Without Strava, athletes have to check off
> sessions manually — with Strava, it happens the moment their watch syncs.
>
> **WE DO NOT ROUTE STRAVA DATA THROUGH AI OR ANY THIRD PARTY.** No LLMs, no
> intermediary platforms, no analytics vendors, no other users. Strava data
> stays between our server and the athlete's own Trifecta account. Trifecta
> does have one optional AI feature (Google Gemini) for interpreting the
> athlete's own free-text injury notes; it never receives Strava data,
> activity metrics, workout history, HR/power, or athlete identity. That
> feature is off by default and requires an explicit in-app consent toggle
> to enable.
>
> **DATA USE**
> - Scope: `read, activity:read_all` (minimum required to close the training loop).
> - Per activity we read: sport type, start time (local + UTC offset),
>   moving/elapsed time, distance, average HR, and average power only when it
>   comes from a real meter (`device_watts=true`). Also activity name for display.
> - We do not upload activities, do not create kudos/comments, do not write to
>   Strava in any way.
>
> **STORAGE & PRIVACY**
> - Strava tokens and activity summaries stored in our own Postgres on Railway,
>   keyed to the user's Trifecta account.
> - Athletes disconnect at any time from Profile → Connections (drops tokens).
> - Deauthorization webhook shipped: when an athlete revokes the app from
>   strava.com/settings/apps, we drop their tokens server-side within seconds.
>
> **TECHNICAL PRACTICES**
> - Push-subscription for activity create/update and athlete deauth (not polling).
> - Token refresh is single-flighted per user to avoid the concurrent-refresh
>   race that would invalidate an athlete's tokens.
> - Backfill on connect capped at 14 days; manual "Sync now" capped at 21 days
>   — both well inside the 15-min/day rate limit.
> - Read-only: no upload, no activity mutation, no social actions.
>
> **BRAND**
> - Athletes connect via a "Connect with Strava" affordance in Profile →
>   Connections. If Strava's brand review would prefer the official button
>   asset from the brand-guidelines kit, we'll swap it immediately.

### Compliance checkboxes (verify before ticking)

- [ ] API Agreement — <https://www.strava.com/legal/api>
- [ ] API Policy — <https://developers.strava.com/docs/getting-started/>
- [ ] Brand Guidelines — <https://developers.strava.com/guidelines>

Notes:
- **Deauthorization handling**: shipped (commit 5d7f63d, 2026-07-31) — see
  `app/api/strava/webhook/route.ts`. Handles athlete update with
  `updates.authorized="false"` per API policy.
- **Brand mark**: current UI uses a monochrome summit chevron placeholder next
  to "Connect with Strava". If Strava's brand review flags this, swap to their
  official "Connect with Strava" button asset per guidelines.

## Screenshot pack

Captured against the seeded `trifectademo` account on an iPhone 17 Pro Max
simulator (6.9", 1320×2868 — same rig as the App Store shots).

Rebuild them by running:

```bash
# 1. Unconnected state — captures the "Connect with Strava" button
scripts/screenshots-strava.sh unconnected

# 2. Seed a fake connected state + Strava actuals into trifectademo's plan
#    (uses a dummy strava_connections row — no Strava slot consumed)
eval "$(railway variables --service Postgres --kv | grep '^DATABASE_PUBLIC_URL=' | sed 's/^/export /')"
DATABASE_PUBLIC_URL="$DATABASE_PUBLIC_URL" npx tsx scripts/seed-strava-shots.ts

# 3. Connected state + workout with Strava actuals
scripts/screenshots-strava.sh connected

# 4. Restore trifectademo to its pre-seed state (do this — the demo account is
#    shared, and the seeded rows will drift the App Store screenshot flow too)
DATABASE_PUBLIC_URL="$DATABASE_PUBLIC_URL" npx tsx scripts/restore-strava-shots.ts
```

Why the seed instead of a real OAuth connect: the connected shot only exercises
the read UI (`/api/strava/status` → `connected:true`, plan workouts with
`actuals.source: "strava"`). No actual Strava traffic is needed for the shot
pack, so we skip OAuth and don't burn a slot on Ryan's app.

Files:

| File | Shows | Phase |
|---|---|---|
| `unconnected-strava-profile-card.png` | "Connect with Strava" button (Profile → Connections) | A |
| `connected-strava-profile-card.png` | "Strava connected" state with Last synced + Sync/Disconnect | B |
| `connected-strava-today.png` | Today tab with a Strava-synced session marked done | B |
| `connected-strava-plan.png` | Plan tab showing a "(Strava)" bonus session card | B |
| `connected-strava-workout-detail.png` | Workout detail with actuals from Strava (name, duration, distance, HR) | B |
