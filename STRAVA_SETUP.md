# Strava device sync — setup

Auto-completes a planned session when a matching activity lands on Strava. Strava
is the hub most watches sync into (Garmin, COROS, Wahoo, Apple Watch via apps), so
this one connection covers them.

All the code is built. It stays dormant until the env vars below are set, so it's
safe to deploy before you finish this. Two things need **you** (they need your
Strava account):

## 1. Create the Strava API app

1. Go to https://www.strava.com/settings/api and create an app.
   - Heads up (your own past finding): as of 2026 Strava requires a paid dev
     subscription (~$12/mo) to create an API app. That's the only cost.
2. Note the **Client ID** and **Client Secret**.
3. Set **Authorization Callback Domain** to just the domain (no scheme/path):
   `amatri-production.up.railway.app`

## 2. Set Railway env vars

| var | value |
| --- | --- |
| `STRAVA_CLIENT_ID` | from the app page |
| `STRAVA_CLIENT_SECRET` | from the app page |
| `STRAVA_WEBHOOK_VERIFY_TOKEN` | any random string (e.g. `openssl rand -hex 12`) |
| `STRAVA_SUBSCRIBE_SECRET` | any random string — guards the one-time subscribe route |
| `APP_URL` *(optional)* | `https://amatri-production.up.railway.app` (only if the auto-detected origin is ever wrong) |

Then redeploy.

## 3. Register the webhook (one time, after deploy)

The app exposes a guarded helper. From your machine:

```bash
# create the subscription (Strava will validate by calling our webhook)
curl -X POST "https://amatri-production.up.railway.app/api/strava/subscribe?secret=YOUR_SUBSCRIBE_SECRET"
# view it
curl "https://amatri-production.up.railway.app/api/strava/subscribe?secret=YOUR_SUBSCRIBE_SECRET"
# delete it (if you ever need to)
curl -X DELETE "https://amatri-production.up.railway.app/api/strava/subscribe?secret=YOUR_SUBSCRIBE_SECRET&id=SUB_ID"
```

A successful create returns `{ "status": 201, "result": { "id": … } }`. Strava
allows exactly one subscription per app.

## 4. Use it

Profile → **Device sync** → **Connect with Strava** → authorize. On connect we
backfill the last ~2 weeks so recent sessions light up immediately. After that,
finishing an activity auto-checks its planned session (matched by day + sport,
closest duration when there's more than one). "Sync now" is a manual backfill /
safety net for any missed webhook.

## How it works (for future me)

- Tokens live in their own `strava_connections` table (not the user `data` blob,
  which `/api/state` overwrites) — keyed by `user_id`, indexed by `athlete_id` so
  the webhook can find the owner.
- Webhook (`/api/strava/webhook`) fetches the activity, matches it to a planned
  workout, marks it `done` + attaches `actuals`, and writes the plan back
  server-side. Idempotent, so update/retry events are safe.
- Matching + mapping is pure and unit-tested: `npx tsx scripts/test-strava-match.ts`.

## Known limits (v1)

- Tokens are stored plaintext (friends-scale). Encrypt-at-rest is a future nicety.
- If the app is open with a stale plan when a webhook completes a session, a
  client save could overwrite it; reopening the app re-hydrates the fresh state.
- Bricks: a run/bike activity will complete a `brick` session (its leg), which is
  approximate. Fine for v1.
