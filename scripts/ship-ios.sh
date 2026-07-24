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

echo "==> gate: iOS self-test on the simulator"
"$REPO/scripts/verify-ios.sh"

echo "==> gate passed — building + uploading to TestFlight (fastlane beta)"
cd "$REPO/ios/App" && fastlane beta
