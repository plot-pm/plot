#!/usr/bin/env bash
# A DESK MARKER IS NEVER COMMITTED. `PLOT-BLOCKED*` and `PLOT-CORRECTION.md` are
# messages between one agent and one person about one desk. The fleet reads a
# `PLOT-BLOCKED*` file in a desk's tree as "waiting on a person", so a marker
# that reaches `main` puts every desk cut from `main` into that state.
#
# Measured 2026-10-02: the agent on `bug/the-scan-drops-its-largest-cost`
# committed its question as `PLOT-BLOCKED.md` (`38523a4e`), the merge of #1196
# carried it onto `main`, and it stayed there until `76ed5428` removed it.
# `main` had carried one twice before (`7b6e15c8`, #741; `dab631d4`, #821).
#
# It reads what git TRACKS, never the working tree: an untracked marker at a
# desk is the marker doing its job.
#
# Usage: check-desk-markers.sh [repo-root]   (default: this repository)
set -euo pipefail

root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

found=$(git -C "$root" ls-files -z \
  | tr '\0' '\n' \
  | grep -E '(^|/)(PLOT-BLOCKED[^/]*|PLOT-CORRECTION\.md)$' || true)

if [ -n "$found" ]; then
  echo "::error::a desk marker is committed. It belongs to one desk, and on main it reads as waiting on a person at every desk."
  printf '%s\n' "$found" | sed 's/^/  /'
  echo "Remove it from the branch: git rm --cached <path>, then commit. Answer the question it asks in the PR or to the operator."
  exit 1
fi

echo "desk markers: no PLOT-BLOCKED* or PLOT-CORRECTION.md file is tracked."
