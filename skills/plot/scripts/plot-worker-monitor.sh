#!/usr/bin/env bash
# Plot helper: the WorkerMonitor — watches the PROCESS a dispatched agent runs on.
#
# RUN, NOT SOURCED, and started by `start_worker()` in `plot-dispatch.sh` as a
# child of the wrapper. It is never invoked by hand in normal operation: a
# monitor an operator has to remember to start is one that will be missing on
# the day it matters.
#
# ═══════════════════════════════════════════════════════════════════════════
# THIS IS A NO-OP, AND IT SAYS SO ON EVERY PASS
# ═══════════════════════════════════════════════════════════════════════════
#
# It measures NOTHING yet. Sampling the process table — CPU delta across
# consecutive readings, the two-sample rule that stops `idle` crying wolf —
# arrives in `feature/the-worker-monitor-samples-the-process`. What exists here
# is the attachment: every dispatched worker is born with this process as a
# child of its wrapper, so the later slice has somewhere to land.
#
# **The announcement is the point, not politeness.** A monitor that is attached
# and silent looks EXACTLY like one that is watching and has nothing to report,
# and the second reading is the one an operator would take. So the no-op
# publishes `nothing measured yet` on every pass, and that string disappears in
# the slice that gives it its first real measurement. A reader who sees it knows
# the monitor is present and knows not to trust it — which is strictly better
# than a monitor that is trusted and blind.
#
# ═══════════════════════════════════════════════════════════════════════════
# WHY IT IS THE WRAPPER'S CHILD
# ═══════════════════════════════════════════════════════════════════════════
#
# `plot-dispatch.sh` does not spawn the agent directly — it spawns an `sh -c`
# wrapper that backgrounds the agent, records its pid, `wait`s for it and writes
# `.plot-worker.exit`. That wrapper ALREADY outlives its agent by construction,
# because otherwise there would be no exit code to record; the comment at
# `plot-dispatch.sh` states it outright: *"--stop kills the agent, the wrapper
# survives to record the code."*
#
# A monitor that is its child inherits that survival. A SIBLING would not:
# two processes started side by side are independently mortal, so the monitor
# could be killed or crash with nothing noticing — which is the failure being
# fixed, one level up.
#
# ═══════════════════════════════════════════════════════════════════════════
# IT INHERITS THE STARTUP WINDOW RATHER THAN WIDENING IT
# ═══════════════════════════════════════════════════════════════════════════
#
# There is a sub-millisecond gap after the wrapper starts and before it writes
# `.plot-worker.pid`; a scan landing in it reads `none` — honest. This monitor
# starts inside the same wrapper, so it is inside that window too, and it must
# not turn an unwritten pid file into a finding. It does not read the pid file
# at all yet, and when it does (next slice) an ABSENT pid file means *not yet*,
# never `gone`.
#
# ═══════════════════════════════════════════════════════════════════════════
# PUBLISHING, BEFORE THERE IS A CHANNEL
# ═══════════════════════════════════════════════════════════════════════════
#
# The channel is a local socket under `.plot/`, and it is
# `feature/the-channel-carries-the-findings`. Until it exists, a finding is
# published by being APPENDED to a file the fleet already knows how to ignore.
#
# The name matters more than it looks. `plot-worker-state.sh` excludes Plot's
# own records from both the dirty-tree filter and the marker search with ONE
# pattern — `PLOT_WORKER_RECORD='\.plot-worker\.'` — after those two exclusions
# had already drifted apart once. A finding file named `.plot-worker.monitor.*`
# is covered by that pattern for free; anything else would make every monitored
# worktree read as holding unlanded work, which is `stalled` for a fleet that
# is perfectly healthy.
set -uo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: plot-worker-monitor.sh [--once]

Started by plot-dispatch.sh inside the worker's wrapper. Reads its subject from
the environment, exactly as the wrapper's other children do:

  PLOT_BRANCH        the branch this worker is on
  PLOT_WORKTREE      the desk it sits at
  PLOT_PID_FILE      where the wrapper records the AGENT's pid
  PLOT_MONITOR_FILE  where findings are published (default:
                     $PLOT_WORKTREE/.plot-worker.monitor.worker.jsonl)
  PLOT_MONITOR_INTERVAL  seconds between passes (default 30)

  --once   publish one finding and exit, rather than looping. This is what the
           tests use, and what makes the no-op assertable without a timeout.
EOF
}

once=0
while [ $# -gt 0 ]; do
  case "$1" in
    --once) once=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "plot-worker-monitor: unknown argument '$1'" >&2; usage; exit 2 ;;
  esac
  shift
done

# THE MONITOR'S NAME IS ITS CONTRACT. It travels into every finding, and the
# board will key on it — a WorkerMonitor `idle` and an AgentMonitor `owes a
# review` must be distinguishable in the entry itself, which the plan's
# attention slice requires and which a shared label would make impossible.
monitor='WorkerMonitor'

branch="${PLOT_BRANCH:-}"
worktree="${PLOT_WORKTREE:-}"
interval="${PLOT_MONITOR_INTERVAL:-30}"

# THE DEFAULT PATH IS DERIVED, NOT REQUIRED. The wrapper passes
# PLOT_MONITOR_FILE explicitly (one env var per path, so no quoting level inside
# the single-quoted `sh -c` can mangle a path with spaces — the convention the
# exit and pid files already use). The fallback exists so a hand-run monitor in
# a worktree still writes somewhere sensible rather than refusing.
findings="${PLOT_MONITOR_FILE:-${worktree:+$worktree/.plot-worker.monitor.worker.jsonl}}"

json_escape() { # $1 = raw → prints a JSON-safe string body
  printf '%s' "$1" | python3 -c 'import json,sys; sys.stdout.write(json.dumps(sys.stdin.read())[1:-1])' 2>/dev/null \
    || printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# A FINDING CARRIES FOUR FIELDS, and they are the plan's, not this slice's
# invention: `finding`, `since`, `evidence`, `measuredAt`. The no-op fills all
# four honestly rather than emitting a stub — a reading without `measuredAt`
# cannot be judged stale, and the later slices should be filling in BEHAVIOUR,
# not redesigning the record.
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
  # Both destinations, deliberately. The file is what a test and a future
  # subscriber read; stdout lands in `.plot-worker.log` beside the agent's own
  # output, where an operator tailing a worker sees it without knowing a second
  # file exists.
  [ -n "$findings" ] && printf '%s\n' "$line" >> "$findings" 2>/dev/null
  printf 'plot-monitor %s\n' "$line"
}

# THE NO-OP FINDING. `nothing measured yet` is a literal the later slice
# DELETES; it is not a state the monitor can ever report once it measures
# something. Grepping for it is how a reviewer checks whether a monitor has been
# given its behaviour.
noop_pass() {
  publish 'nothing measured yet' \
    'the WorkerMonitor is attached but samples nothing in this slice; it will report idle and gone from the process table'
}

noop_pass
[ "$once" = 1 ] && exit 0

# THE LOOP EXISTS SO THE HEARTBEAT DOES. The plan makes silence meaningful:
# every sample publishes, finding or not, so silence past one interval says the
# monitor stopped rather than that nothing is wrong. A no-op that published once
# and exited would be indistinguishable from a monitor that died immediately —
# the exact confusion this design exists to remove.
while :; do
  sleep "$interval" || exit 0
  noop_pass
done
