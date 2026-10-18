#!/usr/bin/env bash
# Plot helper: reflect a plan's phase on the issues it answers, through the
# tracker port's planStateWrite.
# Usage: plot-plan-state.sh <plan file> --phase <draft|approved|delivered|released> \
#          --plan-link <link> [--version <v>]
# Output: one `<issue>\t<written|no-target|unaskable|failed>\t<reason>` line per
#         owed write, then a machine-countable summary:
#             summary: tracker=<none|written|no-target|unaskable|failed>
#         `none` means no write was owed: the plan names no issue.
#         Exit 0 on every write outcome, `failed` included; 2 when the plan or
#         the bundle cannot be read.
#
# THE MECHANICAL HALF, reached by four callers: plot-idea after its draft PR,
# the approve and deliver controllers after their record lands, and
# /plot-release after its Released write. One wrapper, so the bundle's stdin
# has one writer.
#
# IT DECIDES NOTHING. Which writes a plan owes is `planStateWrites`
# (packages/domain/src/rules/issue-status.ts), reached through
# board/plot-plan-state.mjs; the write goes through the tracker connector.
# This script reads the plan for its issues, same as plot-issue-status.sh.
#
# THE CALLER RESOLVES THE LINK AND PHASE, as flags: the plan's address
# differs by phase (the idea-branch PR link at draft, the plan file on the
# default branch otherwise) and the phase a plan file alone cannot always
# name (a spike approval) — only the calling command knows either.
#
# A WRITE THAT FAILS IS REPORTED, NEVER RAISED. It closes nothing, creates
# nothing and comments nothing beyond the one marked comment this write owns.
#
# macOS bash 3.2 throughout.
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

plan_file="${1:-}"
if [ -z "$plan_file" ] || [ ! -f "$plan_file" ]; then
  echo "plot-plan-state: usage: plot-plan-state.sh <plan file> --phase <phase> --plan-link <link> [--version <v>]" >&2
  echo "summary: tracker=failed"
  exit 2
fi
shift

meta=$(bash "$script_dir/plot-plan-meta.sh" "$plan_file" 2>/dev/null) || meta=""
if [ -z "$meta" ]; then
  echo "plot-plan-state: cannot parse '$plan_file'" >&2
  echo "summary: tracker=failed"
  exit 2
fi

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || repo_root=$(pwd)

out=$(printf '%s' "$meta" | PLOT_SCRIPTS_DIR="$script_dir" PLOT_REPO_ROOT="$repo_root" \
  node "$script_dir/board/plot-plan-state.mjs" "$@")
rc=$?
[ -n "$out" ] && printf '%s\n' "$out"
if [ "$rc" != 0 ]; then
  echo "summary: tracker=failed"
  exit 2
fi

# THE WORST OUTCOME NAMES THE RUN: one failed write among several is a failed
# report, because the person reading the summary is the one who repairs it.
summary=none
for word in written no-target unaskable failed; do
  printf '%s\n' "$out" | cut -f2 | grep -qx "$word" && summary=$word
done
echo "summary: tracker=$summary"
exit 0
