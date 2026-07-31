#!/usr/bin/env bash
#
# Capture the screenshot pack Strava's Developer Program review requires:
#   1) "Connect with Strava" button (unconnected Profile state)
#   2) "Strava connected" card (post-OAuth)
#   3) Places where Strava data appears in the app (Today, Plan, workout detail)
#
# Runs against the seeded `trifectademo` account on the 6.9" iPhone Pro Max sim
# (same rig as scripts/screenshots-ios.sh). Two phases because the OAuth click has
# to happen out-of-band — Strava's authorize page opens in the WKWebView and needs
# Ryan's Strava cookie, which Maestro shouldn't touch.
#
# Usage:
#   scripts/screenshots-strava.sh unconnected   # captures phase A
#   scripts/screenshots-strava.sh connected     # captures phase B (after you connect)
#
# Between the two runs:
#   1) Sign in as trifectademo on https://amatri-production.up.railway.app
#   2) Profile → Connect with Strava → authorize (uses one of your 10 slots)
#   3) Hit "Sync now" so bonus sessions appear
#   4) Then run this again with `connected`
#
# When done, tear the connection down:
#   curl -X DELETE -b "ip_session=…" https://amatri-production.up.railway.app/api/strava/status
set -euo pipefail

PHASE="${1:-unconnected}"
case "$PHASE" in
  unconnected|connected) ;;
  *) echo "usage: $0 [unconnected|connected]"; exit 2 ;;
esac

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

SIM_NAME="${SIM_NAME:-iPhone 17 Pro Max}"
BUNDLE_ID="app.trifecta.mobile"
APP="/tmp/tf-sim-build/Build/Products/Debug-iphonesimulator/App.app"
OUT="$REPO/docs/strava-review"

export PATH="$HOME/.maestro/bin:$PATH"
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-300000}"

[ -d "$APP" ] || { echo "!! no reusable build at $APP — run scripts/verify-ios.sh first"; exit 1; }

# boot Pro Max sim
xcrun simctl boot "$SIM_NAME" 2>/dev/null || true
UDID="$(xcrun simctl list devices | awk -F '[()]' '/'"$SIM_NAME"'.*Booted/{print $2; exit}')"
[ -n "$UDID" ] || { echo "!! could not boot '$SIM_NAME'"; exit 1; }
echo "==> simulator: $SIM_NAME ($UDID) — waiting for full boot"
xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1 || true
# free resources
for other in $(xcrun simctl list devices | awk -F '[()]' '/Booted/{print $2}' | grep -v "$UDID"); do
  xcrun simctl shutdown "$other" 2>/dev/null || true
done

# polished status bar (9:41, full battery/signal)
xcrun simctl status_bar "$UDID" override \
  --time "9:41" --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100 2>/dev/null || true

# clean install
xcrun simctl uninstall "$UDID" "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl install "$UDID" "$APP"

echo "==> capturing (phase: $PHASE)"
maestro --udid "$UDID" test maestro/_strava-review.yaml

LATEST="$(ls -dt "$HOME/.maestro/tests"/* 2>/dev/null | head -1 || true)"
[ -n "$LATEST" ] || { echo "!! no Maestro output dir found"; exit 1; }
mkdir -p "$OUT"
# name shots by phase so re-runs don't clobber the other phase's set
find "$LATEST" -path '*/takeScreenshot/*.png' -print0 | while IFS= read -r -d '' src; do
  base="$(basename "$src")"
  cp -f "$src" "$OUT/${PHASE}-${base}"
done
echo "==> shots copied to $OUT:"
ls -la "$OUT"/*.png 2>/dev/null | awk '{print "   ",$NF}'
