#!/usr/bin/env bash
#
# Trifecta iOS self-test — the agent's replacement for "install it and click around".
#
# Builds the shippable Path-B app (static export + native shell), installs it on an
# iOS Simulator, and runs the Maestro end-to-end suite headlessly. Exits non-zero if
# any flow fails, so it can gate a release (see scripts/ship-ios.sh).
#
#   scripts/verify-ios.sh              # full: build + install + test
#   SKIP_BUILD=1 scripts/verify-ios.sh # reuse the last build, just reinstall + test
#   SIM_NAME="iPhone 16 Pro" scripts/verify-ios.sh
#
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

SIM_NAME="${SIM_NAME:-iPhone 17}"
BUNDLE_ID="app.trifecta.mobile"
DERIVED="/tmp/tf-sim-build"
APP="$DERIVED/Build/Products/Debug-iphonesimulator/App.app"
ART="$REPO/artifacts/ios"
rm -rf "$ART"; mkdir -p "$ART"

export PATH="$HOME/.maestro/bin:$PATH"
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-180000}"

# 1) boot the simulator (no-op if already booted)
xcrun simctl boot "$SIM_NAME" 2>/dev/null || true
UDID="$(xcrun simctl list devices booted | awk -F '[()]' '/'"$SIM_NAME"'/{print $2; exit}')"
[ -n "$UDID" ] || { echo "!! no booted simulator named '$SIM_NAME'"; exit 1; }
echo "==> simulator: $SIM_NAME ($UDID)"

# 2) build the Path-B bundle + native Debug app (skip with SKIP_BUILD=1)
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  echo "==> building Path-B static export + iOS Debug app"
  # shellcheck disable=SC1090
  source ~/.nvm/nvm.sh && nvm use 22 >/dev/null
  CAP_PATH_B=1 npm run build:static
  # CAP_NO_OTA=1 disables Capgo auto-update for the test build. Without it the plugin
  # downloads the *production* bundle a few seconds after launch and reloads the
  # WebView — so the suite silently exercised the shipped JS instead of the code being
  # verified, and any flow longer than ~10s got yanked back to the welcome screen
  # mid-run. See capacitor.config.ts.
  CAP_PATH_B=1 CAP_NO_OTA=1 npx cap sync ios
  xcodebuild -project ios/App/App.xcodeproj -scheme App -sdk iphonesimulator \
    -configuration Debug -derivedDataPath "$DERIVED" CODE_SIGNING_ALLOWED=NO \
    -destination "id=$UDID" build
fi

# 2b) capability guard. App.entitlements sat in the repo for weeks while the Xcode
# project never referenced it, so the app shipped WITHOUT the HealthKit entitlement:
# the Connect-Apple-Health button rendered, auth silently failed, and the user was
# told to flip a Settings toggle that didn't exist. A simulator run can't catch that
# (HKHealthStore.isHealthDataAvailable() is a hardware check and returns true
# regardless), so assert the wiring statically instead.
echo "==> checking iOS capability wiring"
ENT_REFS=$(grep -c 'CODE_SIGN_ENTITLEMENTS = App/App.entitlements;' ios/App/App.xcodeproj/project.pbxproj || true)
if [ "$ENT_REFS" -ne 2 ]; then
  echo "!! App.entitlements is wired into $ENT_REFS build configs, expected 2 (Debug + Release)."
  echo "   Without it the app is signed with NO HealthKit entitlement and the feature is dead on device."
  exit 1
fi
if ! grep -q 'com.apple.developer.healthkit' ios/App/App/App.entitlements; then
  echo "!! App.entitlements no longer declares HealthKit."
  exit 1
fi
echo "    entitlements wired into both configs ✓"

# 2c) no lazy Capacitor plugin imports in client code.
#
# A dynamic import() of a Capacitor plugin HANGS FOREVER inside the bundled WKWebView.
# This repo has now been bitten FOUR times by the same line of code:
#   lib/tokenStore.ts  -> login hung on "One sec…"
#   lib/notify.ts      -> notifications card never rendered on native
#   lib/health.ts      -> App Store REJECTION, guideline 2.1(a), 2026-07-30:
#                         "Sync with Apple Health button was unresponsive"
#   lib/ota.ts         -> notifyAppReady() never lands, risking a bundle rollback
#
# It is invisible to every runtime gate — the code is reachable, the element renders,
# assertVisible passes — so assert it statically. Plugins must be imported at the top
# level. If you need code-splitting, split something that is not a native bridge.
echo "==> checking for lazy Capacitor plugin imports"
# The second grep drops COMMENT lines. The files that document this trap quote the
# forbidden pattern in order to warn about it — lib/deliverFile.ts says
# `await import("@capacitor/…")` hangs forever' right above its correct static
# imports — and the guard was flagging its own documentation and failing the gate.
# Only the leading-comment case is excluded, so real code is still caught exactly as
# before; a dynamic import is never the first thing on a `//` line.
LAZY=$(grep -rnE "await import\(['\"]@(capacitor|capgo|aparajita)" \
  --include="*.ts" --include="*.tsx" lib/ components/ app/ hooks/ 2>/dev/null \
  | grep -vE "^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*)" || true)
if [ -n "$LAZY" ]; then
  echo "!! dynamic import() of a Capacitor plugin — this hangs forever in the WKWebView:"
  echo "$LAZY" | sed 's/^/     /'
  echo "   Hoist it to a static top-level import (see lib/health.ts for why)."
  exit 1
fi
echo "    no lazy plugin imports ✓"

# 3) clean (re)install — a fresh install also clears any stale WebView storage
xcrun simctl uninstall "$UDID" "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl install "$UDID" "$APP"

# 4) run the Maestro suite (every real flow in maestro/, excluding _diag helpers)
echo "==> running Maestro flows"
set +e
CODE=0
for flow in "$REPO"/maestro/[!_]*.yaml; do
  echo "--- $(basename "$flow")"
  maestro --udid "$UDID" test "$flow" --format junit --output "$ART/$(basename "$flow" .yaml).xml"
  [ $? -ne 0 ] && CODE=1
done
set -e

# 5) collect screenshots + logs from the latest Maestro run
LATEST="$(ls -dt "$HOME/.maestro/tests"/* 2>/dev/null | head -1 || true)"
if [ -n "$LATEST" ]; then
  find "$LATEST" -name '*.png' -exec cp -f {} "$ART/" \; 2>/dev/null || true
  cp -f "$LATEST/maestro.log" "$ART/" 2>/dev/null || true
fi

if [ "$CODE" -eq 0 ]; then echo "==> ✅ iOS self-test PASSED (artifacts: $ART)"; else echo "==> ❌ iOS self-test FAILED (artifacts: $ART)"; fi
exit "$CODE"
