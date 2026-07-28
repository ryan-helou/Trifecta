#!/usr/bin/env bash
#
# Read-only App Store review state for Trifecta, in a compact machine-readable line.
#
#   scripts/asc-review-status.sh
#   -> STATE=WAITING_FOR_REVIEW ELAPSED_H=90.3 BUILD=8 RELEASE=AFTER_APPROVAL
#
# Wraps `fastlane review_status`. This exists so the scheduled watcher can run ONE
# allow-listed command. A compound `cd … && LC_ALL=… fastlane … | sed …` pipeline does
# NOT match a `Bash(fastlane:*)` permission rule (the rule matches the command prefix,
# and the prefix there is `cd`), so an unattended run stalls forever on a permission
# prompt with nobody present to answer it. One script = one matchable prefix.
#
# Exit codes: 0 ok · 3 cannot cd · 4 ran but output unparseable · other = fastlane's rc.
set -uo pipefail

cd "$(dirname "$0")/../ios/App" || { echo "STATE=ERROR RC=chdir"; exit 3; }

out="$(LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 fastlane review_status 2>&1)"
rc=$?

# fastlane colourises its output; strip ANSI escapes before parsing.
clean="$(printf '%s\n' "$out" | sed -E 's/\x1b\[[0-9;]*[mK]//g')"

if [ "$rc" -ne 0 ]; then
  echo "STATE=ERROR RC=$rc"
  printf '%s\n' "$clean" | tail -20
  exit "$rc"
fi

pick() { printf '%s\n' "$clean" | grep -oE "$1" | head -1 | cut -d= -f2; }

# Prefer the submission line's state; fall back to the version line.
state="$(printf '%s\n' "$clean" | grep -E '^\[?[0-9: ]*\]?:? *submission ' | grep -oE 'state=[A-Z_]+' | head -1 | cut -d= -f2)"
[ -z "$state" ] && state="$(pick 'state=[A-Z_]+')"

elapsed="$(printf '%s\n' "$clean" | grep -oE 'elapsed=[0-9.]+h' | head -1 | tr -dc '0-9.')"
build="$(pick 'build=[0-9]+')"
release="$(pick 'release=[A-Z_]+')"

if [ -z "$state" ]; then
  echo "STATE=ERROR RC=parse"
  printf '%s\n' "$clean" | tail -20
  exit 4
fi

# --- state tracking -------------------------------------------------------
# Done here, not by the calling agent, so an unattended run needs no Write
# permission — the whole check stays one allow-listed Bash command.
STATE_FILE="${ASC_STATE_FILE:-$HOME/.claude/scheduled-tasks/trifecta-review-watch/last-state.txt}"
mkdir -p "$(dirname "$STATE_FILE")" 2>/dev/null
prev="$(cat "$STATE_FILE" 2>/dev/null | head -1 | tr -d '[:space:]')"
prev_state="${prev%%|*}"
notified7d="no"
case "$prev" in *"|NOTIFIED_7D"*) notified7d="yes" ;; esac

changed="no"
if [ -n "$prev_state" ] && [ "$prev_state" != "$state" ]; then
  changed="yes"
fi

# 7-day mark, only while still queued, only once.
alert7d="no"
if [ "$state" = "WAITING_FOR_REVIEW" ] && [ "$notified7d" = "no" ]; then
  if awk "BEGIN{exit !(${elapsed:-0} >= 168)}"; then
    alert7d="yes"
    notified7d="yes"
  fi
fi

new_line="$state"
[ "$notified7d" = "yes" ] && new_line="$state|NOTIFIED_7D"
printf '%s\n' "$new_line" > "$STATE_FILE"

echo "STATE=${state} ELAPSED_H=${elapsed:-0} BUILD=${build:-unknown} RELEASE=${release:-unknown} PREV=${prev_state:-none} CHANGED=${changed} ALERT_7D=${alert7d}"
