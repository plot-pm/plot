#!/usr/bin/env bash
# Plot helper: the ONE answer to "is this monitor's subject still there?"
#
# SOURCED, NOT RUN, by `plot-worker-monitor.sh` and `plot-agent-monitor.sh`.
# Both need the same computation and neither renders it the same way, which is
# the same shape as `plot-worker-state.sh` and `plot-pr-merged.sh` — and the
# same reason. `plot-worker-state.sh` carried five of its six states in
# duplicate until 2026-08-18, and the copies had already drifted on the sixth.
# Two monitors deciding independently when to stop would drift the same way, and
# the failure would be silent: one monitor left running forever while its twin
# exits is exactly the leak this file exists to close, half-fixed.
#
# ═══════════════════════════════════════════════════════════════════════════
# WHY A MONITOR NEEDS THIS AT ALL
# ═══════════════════════════════════════════════════════════════════════════
#
# Measured 2026-08-30 and written up in
# `docs/research/2026-08-30-what-ends-a-monitor.md`: **nothing ended a monitor.**
# On an ordinary finish and on a `Worker bound` timeout alike, the wrapper's
# `wait "$agent"` returns, the wrapper writes `.plot-worker.exit` and exits, and
# both monitors are re-parented to `init` and loop forever. 34 of 40 monitors on
# the machine were `ppid=1` at the time of measurement, and 100 forks cost
# 23.3 ms against 4.8 ms on a quiet estate.
#
# The one run whose monitors WERE terminated is explained in that document and
# is not a mechanism: `nohup` does not `setsid`, so an orphan keeps the
# DISPATCHING SHELL's process group and a group kill sweeps it up collaterally.
# That fires when a human closes a terminal and never when a worker finishes —
# the opposite of a lifetime.
#
# ═══════════════════════════════════════════════════════════════════════════
# THE SUBJECT IS THE AGENT, AND THAT IS THE WHOLE DESIGN
# ═══════════════════════════════════════════════════════════════════════════
#
# A monitor exists to watch a dispatched agent. When that agent is gone there is
# nothing left to measure, so the monitor has finished its job rather than been
# interrupted — which is why this is a MEASUREMENT and not a timer.
#
# The plan forbids a timer explicitly, and the measurement says why: *"a monitor
# exiting after N seconds regardless would pass the visible assertions and
# destroy the property the whole plan rests on — a monitor that stops publishing
# means something."* A monitor that stops because its subject stopped carries
# information. One that stops because a clock ran out carries none, and is
# indistinguishable from one that crashed.
#
# THE AGENT COVERS ALL THREE ENDINGS. `--stop` kills the agent
# (`plot-dispatch.sh:752`); the `Worker bound` kills the agent
# (`plot-worker-loop.sh:172`); an ordinary finish is the agent exiting. In every
# case the wrapper survives just long enough to write `.plot-worker.exit` and
# then exits too. So watching the agent is sufficient, and watching the WRAPPER
# would be wrong: the wrapper outlives the agent by design, and a monitor bound
# to it would publish about a desk whose agent left.
#
# ═══════════════════════════════════════════════════════════════════════════
# AN ABSENT PID FILE IS `starting`, NEVER `gone`
# ═══════════════════════════════════════════════════════════════════════════
#
# `plot-dispatch.sh:478` records a sub-millisecond gap in which the wrapper has
# started and `.plot-worker.pid` is not yet written. The monitors start INSIDE
# that window — they are backgrounded before the agent, deliberately, so they
# exist before their subject does.
#
# So a monitor that read an absent pid file as `gone` would exit immediately on
# every single dispatch, and the leak would be replaced by a monitor that never
# runs. That is worse than the bug: an absent monitor is invisible, where an
# orphaned one at least shows up in `ps`.
#
# Three answers, not two:
#
#   starting   no pid file yet, or an unreadable one — the wrapper has not
#              written it. Keep going; say nothing.
#   alive      the pid file names a process that exists. Keep going.
#   gone       the pid file names a process that does not exist. Stop.
#
# `starting` and `alive` are both "keep going", and they are kept apart anyway
# because the reason differs and a caller reporting them identically would lose
# the distinction the startup window depends on.
#
# ═══════════════════════════════════════════════════════════════════════════
# THE LOWER BOUND IS THE CALLER'S, AND IT IS AN ORDERING
# ═══════════════════════════════════════════════════════════════════════════
#
# The plan requires a monitor to outlive its agent long enough to record its
# finding — the Attaching slice's property, which this slice must not eat. This
# file does not enforce that, because it cannot: it answers a question and
# renders nothing.
#
# What enforces it is the ORDER in the callers: publish the pass, THEN ask.
# Every monitor therefore gets one final published pass after its agent has
# gone, which is the lower bound expressed as sequence rather than as a sleep.
# A caller that asked first and published second would satisfy the upper bound
# and silently lose the lower one — so the order is asserted in the tests, not
# left to a comment.

# `kill -0` is the liveness question, and it is the same one
# `plot-worker-state.sh` asks. It sends no signal; it only reports whether the
# pid can be signalled. A pid we do not own answers EPERM rather than ESRCH,
# which `kill -0` still reports as success — correct here, since a process we
# cannot signal is nonetheless a process that exists.
#
# `$1` = the path to the agent's pid file (`.plot-worker.pid`).
# Prints exactly one of: starting | alive | gone
plot_monitor_subject() {
  local pid_file="${1:-}" pid

  # No path at all: a hand-run monitor with no worktree, which has no subject to
  # outlive and must not exit on its first pass. `starting` is the honest answer
  # — there is nothing here that says the subject is gone.
  [ -n "$pid_file" ] || { printf 'starting'; return 0; }

  # NO PID FILE SPLITS TWO CASES, and reading them as one is what made monitors
  # immortal. `starting` is right only while the desk is still there and the
  # wrapper has not yet written the pid. If the DIRECTORY the pid file lives in
  # is gone, the desk was removed — there is no subject to wait for and none is
  # coming, so the honest answer is `gone`.
  #
  # Measured on CI 2026-08-31: 14 monitors at PPID 1, aged 11-13 minutes, each
  # holding a `sleep 1`, after every test in the reconcile suite had PASSED.
  # A test's fixture is removed at teardown, so its pid file vanishes BEFORE the
  # agent does; `plot_monitor_wait` then never sees `gone` and loops forever,
  # holding node's event loop open until the job ceiling kills it. That is the
  # whole of the reconcile-suite hang, and it is why this is a two-case answer
  # rather than one.
  #
  # PRODUCTION IS UNCHANGED: a real worktree outlives its agent, so the
  # directory is present and this reads `starting` exactly as before.
  if [ ! -f "$pid_file" ]; then
    [ -d "$(dirname "$pid_file")" ] && { printf 'starting'; return 0; }
    printf 'gone'; return 0
  fi

  pid=$(cat "$pid_file" 2>/dev/null | tr -d ' \n')

  # A file that exists but holds no digits is a half-written pid, which is the
  # startup window caught mid-`printf`. Not gone.
  case "$pid" in
    '' | *[!0-9]*) printf 'starting'; return 0 ;;
  esac

  if kill -0 "$pid" 2>/dev/null; then
    printf 'alive'
  else
    printf 'gone'
  fi
}

# Sleep up to `$1` seconds, but stop early the moment the subject at `$2` is
# gone. Returns 0 to publish another pass, 1 to leave.
#
# ═══════════════════════════════════════════════════════════════════════════
# WHY THE WAIT IS SPLIT WHEN THE PUBLISHING IS NOT
# ═══════════════════════════════════════════════════════════════════════════
#
# THE TWO CADENCES MUST STAY APART. The plan is explicit: the WorkerMonitor
# samples the process table every 30 s because a CPU delta is meaningless
# sampled further apart, and the AgentMonitor asks the host every 300 s because
# this repo has already measured what host questions on a fast loop cost. *"One
# subject wants tight sampling of a cheap fact; the other occasional sampling of
# an expensive one. Merging them would force one of those two to be wrong."*
#
# SO ONLY THE WAIT IS SPLIT, NEVER THE PASS. Publishing still happens on the
# monitor's own interval, unchanged — nothing here makes the AgentMonitor ask
# the host more often, and its 300 s stays 300 s. What is split is the IDLE TIME
# between passes, into short naps with a `kill -0` between them.
#
# WITHOUT THIS, THE UPPER BOUND IS THE INTERVAL. An AgentMonitor checking only
# after its full sleep would outlive an agent that finished in ten seconds by
# nearly five minutes. Bounded, technically — and still an orphan on every
# dispatch, on an estate where dispatches are frequent. The measurement that
# opened this slice counted 34 orphans; a five-minute window would have counted
# plenty too.
#
# THE PROBE IS FREE, WHICH IS WHY IT MAY BE FREQUENT. `kill -0` sends no signal
# and asks no host — it is a single syscall against the process table, the same
# question `plot-worker-state.sh` asks. The expensive half of an AgentMonitor
# pass is the host round trip, and that is in the PASS, not here.
#
# THE NAP IS THE GRANULARITY, and one second is chosen against the WorkerMonitor
# rather than in the abstract: a monitor may not outlive its agent by more than
# the tighter of the two cadences, or the fast monitor's exit would be slower
# than its own sampling. Any interval SHORTER than one nap sleeps once and is
# unaffected, which keeps `PLOT_MONITOR_INTERVAL=1` in a test behaving exactly
# as it reads.
plot_monitor_wait() { # $1 = seconds to wait, $2 = pid file
  local remaining="${1:-0}" pid_file="${2:-}" nap
  while [ "$remaining" -gt 0 ]; do
    nap=1
    [ "$remaining" -lt 1 ] && nap="$remaining"
    sleep "$nap" || return 1
    remaining=$((remaining - nap))
    [ "$(plot_monitor_subject "$pid_file")" = gone ] && return 1
  done
  return 0
}
