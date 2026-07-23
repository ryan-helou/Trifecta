# iOS runbook — Trifecta on a device, then TestFlight

**Purpose:** the copy-paste steps to take Trifecta from web app → running on your iPhone →
TestFlight beta. This is **Path A** (the test + update loop) from
[app-store-epic.md](app-store-epic.md): the app loads the live Railway site, so **a Railway
deploy is an app update** — no static export, no OTA service, no auth refactor.

> **What's already done (by the agent, committed to `feat/ios-app-store`).** Capacitor 8.4.2
> is installed, the **`ios/` native project is generated** (SwiftPM — no CocoaPods), the config
> points at Railway, and the **real brand icon + light/dark splash** are baked into the asset
> catalog. Node 22 is available via nvm. **All that's left is the stuff that physically needs you:
> accept the Xcode license, sign with your Apple ID, and run on your iPhone.** Steps 0, 3, 4 below.

---

## 0. Activate Xcode (needs your password — the agent can't sudo)

Once `Xcode_26.6_Apple_silicon.xip` finishes expanding:

```sh
# move Xcode into place (adjust the source path if it expanded elsewhere)
mv ~/Downloads/Xcode.app /Applications/        # or ~/Downloads/Xcode_26.6_Apple_silicon/Xcode.app

open -a Xcode                                    # first launch → installs components (admin password)

sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept                  # ← until you do this, even `git` is blocked by the xcrun shim
```

Then in **Xcode ▸ Settings ▸ Accounts**, add your **Apple ID** (needed to sign the app).

*Have an iPhone + USB cable ready. You do NOT need the paid account to run on your own device
(free Apple ID works); you DO need it for TestFlight (step 4).*

---

## 1. Apple Developer Program — ✅ PURCHASED

Bought 2026-07-23 (C$119/yr, Enrollment ID **C9543JM5Z7**). Approval pending ~1–3 days; you'll
get an email. Gates TestFlight + HealthKit, **not** running on your own device — so step 3 works now.

---

## 2. Capacitor + the iOS project — ✅ DONE (by the agent)

Already installed and committed, so you skip this entirely. For reference, what was run:
`npm i @capacitor/core @capacitor/ios` + `-D @capacitor/cli @capacitor/assets` → `npx cap add ios`
→ `npx cap sync ios` → `npx @capacitor/assets generate --ios`. The `ios/` folder is in the repo.

- **After any web/native change** you only need `npx cap sync ios` (regenerates the copied web
  assets + config). Regenerate icons with `npm run assets:native && npx @capacitor/assets generate --ios`.
- **Bundle ID** is `app.trifecta.mobile` (in `capacitor.config.ts` and the Xcode project). It's
  hard to change once on the App Store — tell me before your first TestFlight upload if you want a
  reverse-domain you own (e.g. `com.<you>.trifecta`) and I'll rename it everywhere.

---

## 3. Run it on your iPhone (free Apple ID — no $99 needed yet)

```sh
npx cap open ios          # opens ios/App/App.xcodeproj in Xcode (SwiftPM — no .xcworkspace)
```

In Xcode:
1. Plug in the iPhone; select it as the run destination (top bar).
2. Select the **App** target → **Signing & Capabilities** → check **Automatically manage
   signing** → set **Team** to your personal Apple ID (add it under Xcode ▸ Settings ▸ Accounts).
3. Hit **▶ Run**. First run: on the iPhone, trust the developer cert under
   **Settings ▸ General ▸ VPN & Device Management**.

✅ **Result:** Trifecta running on your iPhone, loading the live Railway site. This is the M0
smoke test — proves the shell works. (Free-Apple-ID builds expire after **7 days**; that's fine
for a smoke test — TestFlight in step 4 removes that limit.)

---

## 4. TestFlight (needs the paid account from step 1)

1. **App Store Connect** (<https://appstoreconnect.apple.com>) → **Apps ▸ +** → create the app
   record (name "Trifecta", the bundle ID from step 2, your SKU).
2. In Xcode, set the run destination to **Any iOS Device (arm64)** → **Product ▸ Archive**.
3. When the Organizer opens: **Distribute App ▸ TestFlight (Internal Only)** → upload.
4. Build processing takes **~1 h**. Then in App Store Connect → **TestFlight** tab:
   - Add yourself + friends as **Internal Testers** (up to 100, **no review**, they get the
     build immediately once processed).
   - For a wider beta later: add **External Testers** via a public link (one-time lightweight
     **Beta App Review**, ~14 h for the first build of a version).

✅ **Result:** you + friends install Trifecta from TestFlight and use it against live data.

> **90-day expiry:** each uploaded build expires 90 days after upload. Re-archive + upload at
> least quarterly to keep a beta alive (a Railway deploy does *not* reset this — only a new build).

---

## 5. The update loop (this is the "update it" goal)

| You changed… | What to do | Testers get it |
|---|---|---|
| **Anything in the web app** (React/UI/copy/plan logic) | just **deploy to Railway** (your normal flow) | **instantly** — the app loads the live site |
| **Native** (Capacitor config, app icon, a plugin, Info.plist) | `npx cap sync ios` → Archive → upload to TestFlight | ~1 h (internal testers) |
| **Public release** | submit for App Store review | after review (~24–48 h) |

In Path A you almost never touch Xcode — your existing Railway deploy *is* the update channel.
The day you go for the public App Store (Path B), the bundled build can't hot-reload from a URL,
so you'll add **Capgo OTA** to keep instant web updates. Until then, you don't need it.

---

## 6. When you're ready for the public App Store (Path B — later)

Not now, but so it's written down. See [app-store-epic.md](app-store-epic.md) §2 M-B for detail:
1. **Static export target** — env-gated `output: 'export'` build → bundle into `webDir` (must NOT
   change the Railway server build, which needs the API routes).
2. **Bearer-token auth** — the bundled origin is `capacitor://localhost`, so same-origin cookies
   die; switch to `Authorization: Bearer` (the HMAC token infra already exists in
   `lib/auth-server.ts`), store the token in the iOS **Keychain**, enable **CORS**. Fold in the
   known P0 auth fixes here.
3. **Capgo OTA** (`@capgo/capacitor-updater`, ~$12/yr) for instant web updates on the bundled app.
4. **HealthKit** (`@capgo/capacitor-health`) — the native capability that clears Guideline 4.2
   and replaces Strava as the data spine.
5. **Compliance** — Privacy Policy + ToS pages, in-app account deletion (Guideline 5.1.1(v)),
   accurate privacy nutrition labels.
6. **Submit** for full review.
