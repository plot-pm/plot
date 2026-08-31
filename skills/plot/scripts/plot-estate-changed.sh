#!/usr/bin/env bash
# Plot helper: has the estate changed since the last time this run asked?
# Usage: plot-estate-changed.sh <state-file>
# Exit:  0 = changed (or cannot tell) → ASK.   1 = unchanged → the held answer stands.
#
# The shell half of the master agent's entry point. `plot-ask.mjs` answers the
# QUESTION; this answers "is a second ask owed?", which is the same measurement
# taken where a skill can act on it.
#
# WHY A SEPARATE SCRIPT rather than a flag on plot-ask.mjs. A skill runs each
# bash block in its own process, so the in-process memory the entry point offers
# a JS caller cannot survive between two steps of a gate. The digest goes to a
# file instead; the file's SCOPE is what replaces the object's lifetime.
#
# A MEASUREMENT, NEVER A TIMER. The key is a hash of what the scan reads — every
# remote ref's SHA and every plan file's content. A cache keyed on elapsed time
# answers "was it recent?" when the question is "did it change?", and those
# differ in the one direction that matters: the delivery gate's own fix is
# exactly the case where the estate moved and the clock did not care. A phase
# flip changes plan bytes; the push that follows moves a ref. Both are seen.
#
# IT FAILS TOWARD ASKING. Every path that cannot take a measurement exits 0, so
# the caller scans. A guard that failed toward "skip" would turn a delivery
# guard into a claim that the guard had run — the failure this repo names when
# it insists a gate is not a rule. Skipping a scan costs minutes; skipping the
# gate costs a half-landed delivery nobody notices.
#
# WHAT IT DELIBERATELY DOES NOT MEASURE: the git host's open-PR set. The scan
# asks the host which PRs are open, and that is a fact on a server this script
# cannot observe without paying the very network call the guard exists to avoid.
# That omission is what BOUNDS the state file's lifetime rather than being a
# hole in it — the caller writes it under a per-run path and deletes it after,
# so the only changes possible between two asks are the ones the caller itself
# made, and those are local.
#
# Designed for small-model consumption: one argument, two exit codes, no output
# on the success path.

set -uo pipefail

state="${1:-}"
if [ -z "$state" ]; then
  echo "usage: plot-estate-changed.sh <state-file>" >&2
  exit 0   # cannot tell → ask
fi

root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root" || exit 0

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLAN_DIR="$(bash "$HERE/plot-config.sh" get "Plan directory" "docs/plans/" 2>/dev/null)"
PLAN_DIR="${PLAN_DIR%/}"
[ -n "$PLAN_DIR" ] || PLAN_DIR="docs/plans"

# The SHA, not the ref name: a branch force-pushed between two asks keeps its
# name and is a different estate.
refs=$(git for-each-ref --format='%(refname) %(objectname)' refs/remotes/origin 2>/dev/null | LC_ALL=C sort)

# Content, not mtime: a checkout or a `touch` moves mtime without changing what
# the scan would read, and the scan reads plan CONTENT — phase, records, branch
# lines. Hashing this repo's 183 plans costs milliseconds.
plans=$(find "$PLAN_DIR" -maxdepth 1 -name '*.md' -type f 2>/dev/null | LC_ALL=C sort | xargs shasum 2>/dev/null)

# Both empty means nothing could be measured — no git, no plans. Never treat
# that as "unchanged": a cache that agreed with itself here would serve a stale
# answer exactly where it knows least.
if [ -z "$refs" ] && [ -z "$plans" ]; then
  exit 0
fi

digest=$(printf 'refs\n%s\nplans\n%s\n' "$refs" "$plans" | shasum -a 256 | awk '{print $1}')
[ -n "$digest" ] || exit 0

previous=""
[ -f "$state" ] && previous=$(cat "$state" 2>/dev/null)

# Written BEFORE the verdict, so an interrupted run leaves the newest
# measurement rather than a stale one that would suppress the next ask.
mkdir -p "$(dirname "$state")" 2>/dev/null
printf '%s\n' "$digest" > "$state" 2>/dev/null || exit 0

if [ -n "$previous" ] && [ "$previous" = "$digest" ]; then
  exit 1   # unchanged → the held answer stands
fi
exit 0     # changed, or nothing held → ask
