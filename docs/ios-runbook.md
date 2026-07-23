# iOS runbook — Trifecta on a device, then TestFlight

**Purpose:** the copy-paste steps to take Trifecta from web app → running on your iPhone →
TestFlight beta. This is **Path A** (the test + update loop) from
[app-store-epic.md](app-store-epic.md): the app loads the live Railway site, so **a Railway
deploy is an app update** — no static export, no OTA service, no auth refactor.

> **Where things run.** The repo scaffolding (`capacitor.config.ts`, `mobile-shell/`) is done
> and committed. **Everything below must run on a Mac with full Xcode** — it can't be done from
> the dev sandbox (Command Line Tools only, Node 20). Do these on your primary Mac.

---

## 0. Prerequisites (the two current blockers)

- [ ] **Full Xcode.app** — install from the Mac App Store (~10 GB, this is the big one), then:
  ```sh
  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
  sudo xcodebuild -license accept
  ```
  (This box only has Command Line Tools, so `xcodebuild` is missing — that's why native builds
  can't happen here.)
- [ ] **Node 22+** — Capacitor 8 requires it (you're on Node 20). With nvm:
  ```sh
  nvm install 22 && nvm use 22
  ```
- [ ] **An iPhone + its USB cable**, and the Apple ID you'll use signed into Xcode.

*You do NOT need the paid Apple Developer account for step 3 (running on your own device with a
free Apple ID). You DO need it for step 4 (TestFlight).*

---

## 1. (Parallel, do now) Enroll in the Apple Developer Program

- [ ] Enroll **Individual** at <https://developer.apple.com/programs/enroll/> — **$99/yr**.
- [ ] Complete identity verification in the **Apple Developer** app (gov ID + selfie).
- [ ] Realistic wait: **~1–3 days**. This is the longest-latency, lowest-effort item and it
  gates TestFlight + HealthKit — so start it before anything else. It runs off the critical path.

---

## 2. Add Capacitor + generate the iOS project

From the repo root (`~/Developer/AmaTri`), on Node 22:

```sh
# install the Capacitor runtime + CLI + iOS platform
npm install @capacitor/core @capacitor/cli @capacitor/ios

# generate the native iOS project (reads capacitor.config.ts — already in the repo)
npx cap add ios

# copy web assets (the mobile-shell/ offline fallback) + config into the native project
npx cap sync ios

# generate the real app icon + splash into the native project from resources/
# (resources/icon.png + splash*.png are already committed; regenerate with `npm run assets:native`)
npm install --save-dev @capacitor/assets
npx @capacitor/assets generate --ios
```

This creates an `ios/` folder (the native Xcode project). Commit it — it's part of the repo now.
The icon/splash come from `resources/` (Trifecta brand mark, opaque 1024², App-Store-valid).

> **Bundle ID decision:** `capacitor.config.ts` sets `appId: "app.trifecta.mobile"`. This is
> hard to change once on the App Store. If you own a domain you'd rather use as the
> reverse-domain (e.g. `com.<you>.trifecta`), change it **before** the first TestFlight upload.

---

## 3. Run it on your iPhone (free Apple ID — no $99 needed yet)

```sh
npx cap open ios          # opens ios/App/App.xcworkspace in Xcode
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
