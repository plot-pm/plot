#!/usr/bin/env bash
# Plot helper: the AgentMonitor — watches the DESK, and what the agent at it owes.
#
# RUN, NOT SOURCED, and started by `start_worker()` in `plot-dispatch.sh` as a
# child of the wrapper, beside the WorkerMonitor.
#
# ═══════════════════════════════════════════════════════════════════════════
# TWO MONITORS, BECAUSE THERE ARE TWO SUBJECTS
# ═══════════════════════════════════════════════════════════════════════════
#
# CLAUDE.md settles the split for new code: *"a state answering what is the
# process doing? goes on the worker; one answering what does this agent owe, or
# still hold? goes on the agent."* This is the second half.
#
# | monitor           | samples            | cadence | answers                        |
# |-------------------|--------------------|---------|--------------------------------|
# | **WorkerMonitor** | the process table  | seconds | is this process doing anything?|
# | **AgentMonitor**  | the desk, the host | minutes | does this agent still owe?     |
#
# **They cannot share a cadence, which is the practical reason they are two.**
# CPU delta is meaningless unless sampled close together. Whether a branch has a
# PR is a host round trip, and asking it every few seconds is the rate problem
# this repository already measured at 127 git processes per scan. One subject
# wants tight sampling of a cheap fact; the other occasional sampling of an
# expensive one. Merging them would force one of those two to be wrong.
#
# ═══════════════════════════════════════════════════════════════════════════
# THIS IS A NO-OP, AND IT SAYS SO ON EVERY PASS
# ═══════════════════════════════════════════════════════════════════════════
#
# It measures NOTHING yet. The findings it will carry — `owes a review`, `owes a
# gate`, `owes an answer`, `holds unlanded work` — arrive in
# `feature/the-agent-monitor-reads-the-desk`, built on `plot-worker-state.sh`
# and `plot-pr-merged.sh` rather than beside them.
#
# The no-op announces itself for the reason the WorkerMonitor's does: an
# attached-but-silent monitor is indistinguishable from a watching one with
# nothing to report, and an operator would read it as the second. The string
# `nothing measured yet` disappears in the slice that gives it a measurement.
#
# ═══════════════════════════════════════════════════════════════════════════
# WHEN IT ARRIVES, A FINDING WILL NAME THE SLICE — NOT THE AGENT
# ═══════════════════════════════════════════════════════════════════════════
#
# Recorded here because it constrains the record shape this slice fixes, and a
# later slice that discovered it would have to change the contract instead of
# filling it in. An agent outlives its slice: it finishes one unit and takes
# another, so by the time *"this agent owes a review"* is read, the agent may be
# three commits into different work and the debt belongs to a branch it has
# left. That report would send someone to a desk where nothing is wrong.
#
# So the finding is keyed by BRANCH, and the agent appears only as who was at
# that desk when it happened. That is why `branch` is a field here rather than
# something a reader derives from the worktree.
#
# ═══════════════════════════════════════════════════════════════════════════
# IT OBSERVES; IT DOES NOT ACT — AND THAT IS ALREADY TRUE OF THE NO-OP
# ═══════════════════════════════════════════════════════════════════════════
#
# It does not kill a process, open a PR, reap a worktree or restart an agent.
# Every one of those is a judgement with a blast radius, and `plot-reap.sh` and
# `plot-dispatch.sh` already own them behind their own refusals. That boundary
# is what makes a monitor safe to run continuously: a watcher that can only
# report is one nobody has to supervise.
set -uo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: plot-agent-monitor.sh [--once]

Started by plot-dispatch.sh inside the worker's wrapper. Reads its subject from
the environment, exactly as the wrapper's other children do:

  PLOT_BRANCH        the branch whose debts this monitor will report
  PLOT_WORKTREE      the desk it reads
  PLOT_MONITOR_FILE  where findings are published (default:
                     $PLOT_WORKTREE/.plot-worker.monitor.agent.jsonl)
  PLOT_MONITOR_INTERVAL  seconds between passes (default 300)

  --once   publish one finding and exit, rather than looping.
EOF
}

once=0
while [ $# -gt 0 ]; do
  case "$1" in
    --once) once=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "plot-agent-monitor: unknown argument '$1'" >&2; usage; exit 2 ;;
  esac
  shift
done

monitor='AgentMonitor'

branch="${PLOT_BRANCH:-}"
worktree="${PLOT_WORKTREE:-}"
# FIVE MINUTES IS A HOST BUDGET, NOT CAUTION. Its findings need a PR lookup, and
# this repository has already measured what happens when host questions ride a
# fast loop. Against a stall that lasted 50 minutes, five makes it visible 45
# minutes earlier than a person asking — the saving is in the order of
# magnitude, not the seconds. The default differs from the WorkerMonitor's 30s
# BY DESIGN; a shared default would be the merged cadence this split exists to
# prevent.
interval="${PLOT_MONITOR_INTERVAL:-300}"

findings="${PLOT_MONITOR_FILE:-${worktree:+$worktree/.plot-worker.monitor.agent.jsonl}}"

json_escape() { # $1 = raw → prints a JSON-safe string body
  printf '%s' "$1" | python3 -c 'import json,sys; sys.stdout.write(json.dumps(sys.stdin.read())[1:-1])' 2>/dev/null \
    || printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

publish() { # $1=finding $2=evidence
  local now
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local line
  line=$(printf '{"monitor":"%s","branch":"%s","worktree":"%s","finding":"%s","since":"%s","evidence":"%s","measuredAt":"%s"}' \
    "$monitor" \
    "$(json_escape "$branch")" \
    "$(json_escape "$worktree")" \
    "$(json_escape "$1")" \
    "$now" \
    "$(json_escape "$2")" \
    "$now")
  [ -n "$findings" ] && printf '%s\n' "$line" >> "$findings" 2>/dev/null
  printf 'plot-monitor %s\n' "$line"
}

noop_pass() {
  publish 'nothing measured yet' \
    'the AgentMonitor is attached but reads nothing in this slice; it will report owes a review, owes a gate, owes an answer and holds unlanded work'
}

noop_pass
[ "$once" = 1 ] && exit 0

while :; do
  sleep "$interval" || exit 0
  noop_pass
done
