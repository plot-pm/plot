#!/usr/bin/env bash
# Measure how long a working agent stays quiet.
#
# READ-ONLY, AND IT DECIDES NOTHING. This is the measurement
# `an-idle-agent-is-not-a-stalled-one` asks for before any end condition reads a
# transcript: *what interval counts as no output on a live session?* A threshold
# chosen below a working agent's ordinary quiet stretch kills working agents
# exactly as the CPU sample does, so the number has to be measured on real
# dispatched sessions rather than picked.
#
# WHAT IT SAMPLES. Two readings of the same agent, side by side:
#
#   transcript quiet — the seconds between consecutive timestamped lines the
#                      runtime wrote. This reads the AGENT.
#   subtree CPU      — `plot_worker_activity`'s `working`/`idle` answer, for a
#                      live pid only. This reads the MACHINE.
#
# The pairing is the point. The defect is that the second says `idle` while the
# first is still advancing, and only a run that holds both at once can show it.
#
# WHY THE TRANSCRIPT IS READ HISTORICALLY. A past session's CPU clock is gone —
# the process exited and nothing recorded its samples — but its transcript is on
# disk with every timestamp intact. So the quiet distribution is measured over
# completed sessions, where the population is large and the outcome is known,
# and the CPU pairing is measured live against whatever agents are running now.
# Reporting a live-only number would mean one session; reporting a historical
# one alone would drop the half of the comparison that is in dispute.
#
# THE OUTCOME FILTER IS WHAT MAKES A NUMBER USABLE. A quiet stretch is only
# evidence if the agent was working through it. `--merged-only` keeps sessions
# whose branch reached a merged PR — an agent whose work landed was, by
# definition, not stuck — so the reported maximum is a floor on what a healthy
# agent does, which is the shape a threshold needs.
#
# Usage:
#   plot-quiet-stretch.sh [--json] [--merged-only] [--live] [--worktrees DIR]
#                         [--home DIR] [--top N]
#
#   --json         machine-readable; the default is a human report
#   --merged-only  only sessions whose branch has a merged PR
#   --live         also sample CPU beside the transcript for running workers
#   --worktrees    where the dispatch worktrees are (default: Worktree root)
#   --home         runtime home holding `.claude/projects` (default: $HOME)
#   --top N        how many longest stretches to list (default 10)
#
# Exit 0 whenever it could measure anything at all. This reports; it gates
# nothing, so an empty population is a finding rather than a failure.
set -uo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

json=0
merged_only=0
live=0
worktrees=''
home_dir="${HOME:-}"
top=10

while [ $# -gt 0 ]; do
  case "$1" in
    --json)        json=1 ;;
    --merged-only) merged_only=1 ;;
    --live)        live=1 ;;
    --worktrees)   worktrees="${2:-}"; shift ;;
    --home)        home_dir="${2:-}"; shift ;;
    --top)         top="${2:-10}"; shift ;;
    -h|--help)     sed -n '2,50p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf 'plot-quiet-stretch: unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

# THE MAIN CHECKOUT, NOT THIS ONE. `--show-toplevel` from inside a dispatch
# worktree returns that worktree, and `Worktree root` is relative to the repo
# that HOLDS the worktrees — so resolving it that way looks for
# `.worktrees/<branch>/.worktrees`, finds nothing, and reports a population of
# zero. Measured here on the first run: 0 sessions across 0 worktrees, in a
# checkout sitting beside 40 of them.
#
# The parent of `--git-common-dir` is the main checkout from anywhere, because
# every linked worktree shares that one directory. It is asked FIRST and
# `--show-toplevel` is the fallback, since the common dir is also correct in a
# non-worktree checkout: there `.git` is a real directory in the root.
repo_root=''
common=$(git rev-parse --git-common-dir 2>/dev/null) && [ -n "$common" ] && {
  common=$(cd -- "$common" 2>/dev/null && pwd) || common=''
  [ -n "$common" ] && repo_root=$(dirname -- "$common")
}
[ -n "$repo_root" ] || repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || repo_root=$(pwd)

if [ -z "$worktrees" ]; then
  worktrees=$("$script_dir/plot-config.sh" get "Worktree root" ".worktrees" 2>/dev/null) || worktrees=".worktrees"
fi
case "$worktrees" in
  /*) ;;
  *)  worktrees="$repo_root/$worktrees" ;;
esac
worktrees="${worktrees%/}"

# THE MONITOR'S OWN WINDOW, read from the same variable the monitor reads.
# The report compares every measured stretch against it, because "longer than
# the rule's window" is the only comparison that says whether the rule fires on
# a working agent. Hard-coding 30 here would let the two drift apart silently.
interval="${PLOT_MONITOR_INTERVAL:-30}"

# ---------------------------------------------------------------------------
# THE LIVE HALF — CPU beside the transcript, for workers running right now
# ---------------------------------------------------------------------------
#
# Sourced rather than re-implemented: `plot_worker_activity` IS the reading
# under dispute, and a second copy of it here could disagree with the one the
# monitor runs, which would make the measurement describe a rule nobody uses.
# It is a pure library with no main block, so sourcing it runs nothing.
# shellcheck source=/dev/null
. "$script_dir/plot-worker-state.sh" 2>/dev/null || true

live_rows=''
if [ "$live" = 1 ] && [ -d "$worktrees" ]; then
  for pidfile in "$worktrees"/*/.plot-worker.pid; do
    [ -f "$pidfile" ] || continue
    wt=$(dirname "$pidfile")
    pid=$(cat "$pidfile" 2>/dev/null) || continue
    case "$pid" in ''|*[!0-9]*) continue ;; esac
    kill -0 "$pid" 2>/dev/null || continue
    act=''
    if command -v plot_worker_activity >/dev/null 2>&1; then
      act=$(plot_worker_activity "$pid" 2>/dev/null)
    fi
    live_rows="${live_rows}${wt}	${pid}	${act:-unknown}
"
  done
fi

# ---------------------------------------------------------------------------
# THE OUTCOME HALF — did this agent's work land?
# ---------------------------------------------------------------------------
#
# ASKED IN SHELL BECAUSE THE HOST IS ASKED IN SHELL. `pr_merged` is Plot's ONE
# answer to "did the host merge any PR for this branch?", and the reasons its
# own header gives — `mergedAt` never `state`, any PR never the newest — apply
# here unchanged. A second implementation in node would be a second way to be
# wrong about the fact the whole filter rests on.
#
# ONLY UNDER `--merged-only`. The host round trip costs a call per worktree,
# and the default report wants the full population: a session that has not
# merged is still a real sample of how long a runtime stays quiet, and only the
# claim "this agent was demonstrably working" needs the stronger evidence.
# shellcheck source=/dev/null
. "$script_dir/plot-pr-merged.sh" 2>/dev/null || true

merged_rows=''
if [ "$merged_only" = 1 ] && [ -d "$worktrees" ]; then
  for wt in "$worktrees"/*/; do
    [ -d "$wt" ] || continue
    wt="${wt%/}"
    br=$(git -C "$wt" rev-parse --abbrev-ref HEAD 2>/dev/null) || continue
    [ -n "$br" ] || continue
    if command -v pr_merged >/dev/null 2>&1 && pr_merged "$br"; then
      merged_rows="${merged_rows}${wt}	${br}
"
    fi
  done
fi

# ---------------------------------------------------------------------------
# THE HISTORICAL HALF — every dispatched session's transcript
# ---------------------------------------------------------------------------
#
# `node` rather than awk over JSONL: a transcript line carries embedded
# newlines inside JSON strings in practice, and a line-oriented text tool
# cannot tell those from record separators. The same reason
# `plot-sprint-candidates.sh` gives for assembling through node.
export PLOT_QS_MERGED="$merged_rows"
export PLOT_QS_HOME="$home_dir"
export PLOT_QS_WORKTREES="$worktrees"
export PLOT_QS_MERGED_ONLY="$merged_only"
export PLOT_QS_JSON="$json"
export PLOT_QS_TOP="$top"
export PLOT_QS_INTERVAL="$interval"
export PLOT_QS_LIVE="$live_rows"
export PLOT_QS_SCRIPT_DIR="$script_dir"

node "$script_dir/plot-quiet-stretch.mjs"
