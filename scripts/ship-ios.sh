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

echo "==> gate 1: engine invariant tests (plan correctness)"
# shellcheck disable=SC1090
( cd "$REPO" && source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm test )

echo "==> gate 2: iOS self-test on the simulator"
"$REPO/scripts/verify-ios.sh"

echo "==> gates passed — building + uploading to TestFlight (fastlane beta)"
cd "$REPO/ios/App" && fastlane beta
