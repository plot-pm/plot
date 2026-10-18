#!/usr/bin/env bash
# Plot helper: write a finished plan's issue status through the tracker port.
# Usage: plot-issue-status.sh <plan file>
# Output: one `<issue>\t<written|no-target|unaskable|failed>\t<reason>` line per
#         owed write, then a machine-countable summary:
#             summary: tracker=<none|written|no-target|unaskable|failed>
#         `none` means no write was owed: the plan names no issue, its phase is
#         not Approved, Delivered or Released, or that phase's status word is not set.
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

approved=$(bash "$script_dir/plot-config.sh" get "Tracker approved status" '' 2>/dev/null) || approved=""
delivered=$(bash "$script_dir/plot-config.sh" get "Tracker delivered status" '' 2>/dev/null) || delivered=""
released=$(bash "$script_dir/plot-config.sh" get "Tracker released status" '' 2>/dev/null) || released=""

source "$script_dir/plot-tracker-write.sh"
plot_tracker_write "$plan_file" plot-issue-status.mjs --approved "$approved" --delivered "$delivered" --released "$released"
exit 0
