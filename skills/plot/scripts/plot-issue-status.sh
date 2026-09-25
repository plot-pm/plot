#!/usr/bin/env bash
# Plot helper: write a finished plan's issue status through the tracker port.
# Usage: plot-issue-status.sh <plan file>
# Output: one `<issue>\t<written|no-target|unaskable|failed>\t<reason>` line per
#         owed write, then a machine-countable summary:
#             summary: tracker=<none|written|no-target|unaskable|failed>
#         `none` means no write was owed: the plan names no issue, its phase is
#         not Delivered or Released, or that phase's status word is not set.
#         Exit 0 on every write outcome, `failed` included; 2 when the plan or
#         the bundle cannot be read.
#
# THE MECHANICAL HALF, reached by two callers: plot-deliver.sh after its push,
# and /plot-release step 4 after the `Released` write. One wrapper, so the
# bundle's stdin has one writer.
#
# IT DECIDES NOTHING. Which writes a plan owes is `issueStatusWrites`
# (packages/domain/src/rules/issue-status.ts), reached through
# board/plot-issue-status.mjs; the write goes through the tracker connector, which
# is the only caller of `plot-host.sh issue-status`. This script reads the plan
# and the two config keys, and does not prefilter: a plan naming no issue is the
# rule's answer to give, not this script's.
#
# A WRITE THAT FAILS IS REPORTED, NEVER RAISED. The plan is delivered; the
# tracker holds a copy of one fact about it. It closes nothing, creates nothing
# and comments nothing.
#
# macOS bash 3.2 throughout.
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

plan_file="${1:-}"
if [ -z "$plan_file" ] || [ ! -f "$plan_file" ]; then
  echo "plot-issue-status: usage: plot-issue-status.sh <plan file>" >&2
  echo "summary: tracker=failed"
  exit 2
fi

delivered=$(bash "$script_dir/plot-config.sh" get "Tracker delivered status" '' 2>/dev/null) || delivered=""
released=$(bash "$script_dir/plot-config.sh" get "Tracker released status" '' 2>/dev/null) || released=""

meta=$(bash "$script_dir/plot-plan-meta.sh" "$plan_file" 2>/dev/null) || meta=""
if [ -z "$meta" ]; then
  echo "plot-issue-status: cannot parse '$plan_file'" >&2
  echo "summary: tracker=failed"
  exit 2
fi

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || repo_root=$(pwd)

out=$(printf '%s' "$meta" | PLOT_SCRIPTS_DIR="$script_dir" PLOT_REPO_ROOT="$repo_root" \
  node "$script_dir/board/plot-issue-status.mjs" --delivered "$delivered" --released "$released")
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
