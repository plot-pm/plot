#!/usr/bin/env bash
# Shared body for a tracker-write wrapper: resolve its own directory, require
# a readable plan file as $1, run the bundle named by $2 with the remaining
# args, print its stdout, and print the worst-outcome summary line. Sourced by
# plot-issue-status.sh and plot-plan-state.sh, which differ only in which
# bundle they call and with what flags — this is that duplication named and
# paid for once rather than carried twice.
#
# Call as: plot_tracker_write <plan file> <bundle> [flags...]
# Exits 2 (having printed `summary: tracker=failed`) on a missing/unreadable
# plan file or a failing bundle; otherwise exits 0 after the summary line.
fail_as() { echo "$(basename "$0"): $1" >&2; echo "summary: tracker=failed"; exit 2; }

plot_tracker_write() {
  local plan_file=$1 bundle=$2; shift 2
  local script_dir=$(cd "$(dirname "${BASH_SOURCE[1]}")" && pwd)
  [ -n "$plan_file" ] && [ -f "$plan_file" ] || fail_as "usage: $(basename "$0") <plan file> [flags...]"

  local meta=$(bash "$script_dir/plot-plan-meta.sh" "$plan_file" 2>/dev/null) || meta=""
  [ -n "$meta" ] || fail_as "cannot parse '$plan_file'"

  local repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || repo_root=$(pwd)
  local out=$(printf '%s' "$meta" | PLOT_SCRIPTS_DIR="$script_dir" PLOT_REPO_ROOT="$repo_root" \
    node "$script_dir/board/$bundle" "$@"); local rc=$?
  [ -n "$out" ] && printf '%s\n' "$out"
  [ "$rc" = 0 ] || fail_as "the bundle failed"

  # THE WORST OUTCOME NAMES THE RUN: one failed write among several is a failed
  # report, because the person reading the summary is the one who repairs it.
  local summary=none word
  for word in written no-target unaskable failed; do
    printf '%s\n' "$out" | cut -f2 | grep -qx "$word" && summary=$word
  done
  echo "summary: tracker=$summary"
}
