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

plan_file="${1:-}"
shift || true

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/plot-tracker-write.sh"
plot_tracker_write "$plan_file" plot-plan-state.mjs "$@"
exit 0
