#!/usr/bin/env bash
#
# Trifecta iOS "test-then-ship" — the whole point of the self-test harness.
#
# Runs the simulator self-test FIRST and only uploads to TestFlight if it passes, so a
# broken build (e.g. the login hang the harness caught) can never reach testers. This
# is what lets the agent ship without a human plugging in a phone.
#
#   scripts/ship-ios.sh
#
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"

# fastlane (Ruby) needs a UTF-8 locale. Without it xcpretty parses xcodebuild's output as
# US-ASCII and dies on the first non-ASCII byte — "invalid byte sequence in US-ASCII" —
# and because gym pipes through it under `set -o pipefail`, xcpretty's crash fails the
# whole archive even though xcodebuild is still building happily. Killed a good build 9
# this way on 2026-07-29. scripts/asc-review-status.sh already sets these for the same
# reason; the ship path was missing them.
export LC_ALL="${LC_ALL:-en_US.UTF-8}"
export LANG="${LANG:-en_US.UTF-8}"

echo "==> gate 1: engine invariant tests (plan correctness)"
# shellcheck disable=SC1090
( cd "$REPO" && source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test )

echo "==> gate 2: iOS self-test on the simulator"
"$REPO/scripts/verify-ios.sh"

# Re-sync for SHIPPING before archiving. verify-ios.sh syncs with CAP_NO_OTA=1 (so the
# simulator exercises the working tree instead of the shipped bundle), and `cap sync`
# writes that into ios/App/App/capacitor.config.json. fastlane only archives what is
# already there — so without this step, gate 2 passing is exactly what guarantees the
# uploaded build has "CapacitorUpdater": { "autoUpdate": false } baked in, i.e. a store
# build that can never take an OTA fix again. Sync the real shipping config back.
echo "==> re-syncing shipping config (Path B, OTA enabled)"
# shellcheck disable=SC1090
( cd "$REPO" && source ~/.nvm/nvm.sh && nvm use 22 >/dev/null \
    && CAP_PATH_B=1 npm run build:static \
    && CAP_PATH_B=1 npx cap sync ios )
if grep -q '"autoUpdate": false' "$REPO/ios/App/App/capacitor.config.json"; then
  echo "!! shipping config still has autoUpdate:false — refusing to upload an un-OTA-able build."
  exit 1
fi
echo "    OTA enabled in the shipping config ✓"

echo "==> gates passed — building + uploading to TestFlight (fastlane beta)"
cd "$REPO/ios/App" && fastlane beta
