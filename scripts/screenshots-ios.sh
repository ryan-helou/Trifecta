#!/usr/bin/env bash
#
# Capture App Store screenshots at Apple's required 6.9" size (1320x2868).
#
# Reuses the last simulator build (App.app) — simulator builds are arch-generic, so the
# Debug .app from verify-ios.sh installs on ANY iOS simulator. Boots an iPhone Pro Max
# (6.9"), polishes the status bar (9:41 / full battery / full signal), installs the app,
# runs the Maestro screenshot flow against the seeded demo account, and drops the PNGs
# into fastlane/screenshots/en-US/ where `fastlane deliver` picks them up by resolution.
#
#   scripts/screenshots-ios.sh
#
# Prereqs: an iPhone Pro Max simulator, the reused build at /tmp/tf-sim-build, and the
# `trifectademo` account seeded (npx tsx scripts/seed-demo.ts).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

SIM_NAME="${SIM_NAME:-iPhone 17 Pro Max}"   # 6.9" display => 1320x2868
BUNDLE_ID="app.trifecta.mobile"
APP="/tmp/tf-sim-build/Build/Products/Debug-iphonesimulator/App.app"
OUT="$REPO/ios/App/fastlane/screenshots/en-US"

export PATH="$HOME/.maestro/bin:$PATH"
# cold Pro Max sims can take a while for the XCTest driver to come up — be generous.
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-300000}"

[ -d "$APP" ] || { echo "!! no reusable build at $APP — run scripts/verify-ios.sh first"; exit 1; }

# 1) boot the Pro Max sim and WAIT until it's fully booted (else Maestro's XCTest
#    runner times out attaching to a still-settling sim)
xcrun simctl boot "$SIM_NAME" 2>/dev/null || true
UDID="$(xcrun simctl list devices | awk -F '[()]' '/'"$SIM_NAME"'.*Booted/{print $2; exit}')"
[ -n "$UDID" ] || { echo "!! could not boot '$SIM_NAME'"; exit 1; }
echo "==> simulator: $SIM_NAME ($UDID) — waiting for full boot"
xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1 || true
# free resources: shut down any OTHER booted sims so the driver launches promptly
for other in $(xcrun simctl list devices | awk -F '[()]' '/Booted/{print $2}' | grep -v "$UDID"); do
  xcrun simctl shutdown "$other" 2>/dev/null || true
done

# 2) polished status bar (App Store convention: 9:41, full battery/signal)
xcrun simctl status_bar "$UDID" override \
  --time "9:41" --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100 2>/dev/null || true

# 3) clean (re)install
xcrun simctl uninstall "$UDID" "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl install "$UDID" "$APP"

# 4) run the screenshot flow
echo "==> capturing screenshots"
maestro --udid "$UDID" test maestro/_screenshots.yaml

# 5) collect store-*.png from the latest Maestro run into the deliver folder
LATEST="$(ls -dt "$HOME/.maestro/tests"/* 2>/dev/null | head -1 || true)"
[ -n "$LATEST" ] || { echo "!! no Maestro output dir found"; exit 1; }
rm -rf "$OUT"; mkdir -p "$OUT"
find "$LATEST" -name 'store-*.png' -exec cp -f {} "$OUT/" \;
echo "==> screenshots copied to $OUT:"
for f in "$OUT"/*.png; do
  [ -f "$f" ] || continue
  dims="$(sips -g pixelWidth -g pixelHeight "$f" 2>/dev/null | awk '/pixel/{print $2}' | paste -sd'x' -)"
  echo "    $(basename "$f")  ${dims}"
done
