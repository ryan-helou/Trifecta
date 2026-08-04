#!/usr/bin/env bash
#
# Capture App Store screenshots at Apple's required 6.9" size (1320x2868).
#
# Reuses the last simulator build (App.app) — simulator builds are arch-generic, so the
# Debug .app from verify-ios.sh installs on ANY iOS simulator. Boots an iPhone Pro Max
# (6.9"), polishes the status bar (9:41 / full battery / full signal), installs the app,
# runs the Maestro screenshot flow against the seeded demo account, and drops the PNGs
# into fastlane/screenshots-raw/en-US/.
#
# These are the RAW device captures — the ingredients, not the shipped artwork. Wrap
# them in the marketing frames (and put them where deliver looks) with:
#
#   scripts/screenshots-ios.sh && node scripts/gen-store-frames.mjs
#
# Prereqs: an iPhone Pro Max simulator, the reused build at /tmp/tf-sim-build, and the
# `trifectademo` account seeded (npx tsx scripts/seed-demo.ts).
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

# A DEDICATED 6.9" device, created on demand, rather than the stock "iPhone 17 Pro Max".
#
# This machine runs more than one simulator job at a time (a verify run, an OTA e2e).
# Those target the stock device by name or by UDID, and they install over the SAME bundle
# id — so sharing it means simctl calls wedge behind each other and, worse, the capture
# can photograph somebody else's build. That happened: an OTA test reinstalled its own
# App.app mid-capture. A private device costs a few seconds to create and removes the
# whole class of collision.
SIM_NAME="${SIM_NAME:-Trifecta Shots 6.9}"
SIM_DEVICETYPE="${SIM_DEVICETYPE:-com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max}"
BUNDLE_ID="app.trifecta.mobile"
APP="/tmp/tf-sim-build/Build/Products/Debug-iphonesimulator/App.app"
# RAW captures — deliberately NOT fastlane's screenshots/ dir. What ships to the App
# Store are the marketing frames built from these by scripts/gen-store-frames.mjs; a
# bare simulator capture sitting in the deliver folder would upload itself alongside
# them. Raw in, framed out, one directory each.
OUT="$REPO/ios/App/fastlane/screenshots-raw/en-US"

# Reference point for the staleness check at the end — anything collected must be newer.
STAMP="$(mktemp -t tf-shots-stamp)"
EXPECTED_SHOTS=6   # keep in sync with the takeScreenshot steps in maestro/_screenshots.yaml
trap 'rm -f "$STAMP"' EXIT

export PATH="$HOME/.maestro/bin:$PATH"
# cold Pro Max sims can take a while for the XCTest driver to come up — be generous.
export MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-300000}"

[ -d "$APP" ] || { echo "!! no reusable build at $APP — run scripts/verify-ios.sh first"; exit 1; }

# 1) boot the Pro Max sim and WAIT until it's fully booted (else Maestro's XCTest
#    runner times out attaching to a still-settling sim)
#
# Resolve the UDID by NAME first, in whatever state the device is in. The old version
# booted and then grepped the device list for a line matching both the name AND
# "Booted" — a race: `simctl boot` returns while the device is still "Booting", so the
# grep found nothing and the script died with "could not boot" on a device that was in
# fact coming up perfectly well.
UDID="$(xcrun simctl list devices available | awk -F '[()]' '/'"$SIM_NAME"' \(/{print $2; exit}')"
if [ -z "$UDID" ]; then
  RUNTIME="$(xcrun simctl list runtimes | awk '/^iOS /{print $NF; exit}')"
  echo "==> creating dedicated simulator '$SIM_NAME' ($RUNTIME)"
  UDID="$(xcrun simctl create "$SIM_NAME" "$SIM_DEVICETYPE" "$RUNTIME")"
fi
[ -n "$UDID" ] || { echo "!! could not create/find '$SIM_NAME'"; exit 1; }
xcrun simctl boot "$UDID" 2>/dev/null || true   # already-booted is not an error
echo "==> simulator: $SIM_NAME ($UDID) — waiting for full boot"
# Poll the device list rather than `simctl bootstatus -b`. bootstatus can hang for tens
# of minutes on a device that is ALREADY reporting Booted — it did exactly that here,
# twice, and with the script's output piped it looked like a silent stall rather than a
# wedged subprocess. Polling is bounded and tells us the same thing.
for _ in $(seq 1 90); do
  xcrun simctl list devices | grep -q "$UDID.*Booted" && break
  sleep 2
done
xcrun simctl list devices | grep -q "$UDID.*Booted" || { echo "!! '$SIM_NAME' never reached Booted"; exit 1; }

# Shutting down the OTHER booted simulators frees resources and helps the Maestro driver
# attach promptly — but it also kills whatever is running on them, and this machine is
# routinely running another simulator job (an OTA e2e, a verify run) at the same time.
# Opt-in only: SHUTDOWN_OTHER_SIMS=1 scripts/screenshots-ios.sh
if [ "${SHUTDOWN_OTHER_SIMS:-0}" = "1" ]; then
  for other in $(xcrun simctl list devices | awk -F '[()]' '/Booted/{print $2}' | grep -v "$UDID"); do
    echo "==> shutting down other simulator $other (SHUTDOWN_OTHER_SIMS=1)"
    xcrun simctl shutdown "$other" 2>/dev/null || true
  done
fi

# 2) polished status bar (App Store convention: 9:41, full battery/signal)
xcrun simctl status_bar "$UDID" override \
  --time "9:41" --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100 2>/dev/null || true

# 3) clean (re)install
xcrun simctl uninstall "$UDID" "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl install "$UDID" "$APP"

# 4) run the screenshot flow
#
# The session to open is looked up live and handed to Maestro, because the flow taps it
# by name and the plan engine picks different sessions every day. The old flow hardcoded
# "Technique & Drills"; it matched on the day it was written and silently stopped
# matching afterwards. See scripts/demo-session.ts for why it is the NEXT session and
# not today's.
SHOT_SESSION="$(npx tsx scripts/demo-session.ts)" || {
  echo "!! could not read the demo session to open — reseed: npx tsx scripts/seed-demo.ts"; exit 1; }
echo "==> capturing screenshots (opening session: $SHOT_SESSION)"

# Clear the raw folder BEFORE the run, not after. A failed capture used to leave the
# previous run's shots sitting there, and gen-store-frames.mjs would cheerfully build
# artwork out of them — stale screenshots dressed up as fresh ones, which is the exact
# failure this whole pipeline exists to prevent. Now a failed capture leaves an empty
# directory and the generator refuses to run.
rm -rf "$OUT"; mkdir -p "$OUT"

maestro --udid "$UDID" test -e SHOT_SESSION="$SHOT_SESSION" maestro/_screenshots.yaml

# 5) collect store-*.png from the latest Maestro run into the raw folder
LATEST="$(ls -dt "$HOME/.maestro/tests"/* 2>/dev/null | head -1 || true)"
[ -n "$LATEST" ] || { echo "!! no Maestro output dir found"; exit 1; }
find "$LATEST" -name 'store-*.png' -exec cp -f {} "$OUT/" \;

# Every shot must come from THIS run. "Newest directory under ~/.maestro/tests" is a
# guess, and it guesses wrong whenever a previous run was interrupted or another job
# left a directory behind. Getting that wrong doesn't fail loudly — it silently ships
# screenshots of an older build, which is precisely how the store ended up showing
# training-phase names the app had already stopped using.
STALE=0
for f in "$OUT"/*.png; do
  [ -f "$f" ] || continue
  [ "$f" -nt "$STAMP" ] || { echo "!! $(basename "$f") predates this run — stale Maestro output"; STALE=1; }
done
[ "$STALE" = "0" ] || { echo "!! refusing to publish stale captures from $LATEST"; exit 1; }

COUNT="$(ls "$OUT"/store-*.png 2>/dev/null | wc -l | tr -d ' ')"
[ "$COUNT" = "$EXPECTED_SHOTS" ] || {
  echo "!! captured $COUNT shots, expected $EXPECTED_SHOTS — the flow ended early"; exit 1; }

# Provenance, so a frame set can always be traced back to the build and the app state it
# was shot from. gen-store-frames.mjs requires this file to exist.
cat > "$OUT/capture.json" <<JSON
{
  "capturedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "commit": "$(git rev-parse --short HEAD 2>/dev/null || echo unknown)",
  "simulator": "$SIM_NAME",
  "session": "$SHOT_SESSION",
  "app": "$APP"
}
JSON

echo "==> screenshots copied to $OUT:"
for f in "$OUT"/*.png; do
  [ -f "$f" ] || continue
  dims="$(sips -g pixelWidth -g pixelHeight "$f" 2>/dev/null | awk '/pixel/{print $2}' | paste -sd'x' -)"
  echo "    $(basename "$f")  ${dims}"
done
echo "==> next: node scripts/gen-store-frames.mjs"
