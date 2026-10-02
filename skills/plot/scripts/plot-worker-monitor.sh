#!/usr/bin/env bash
# Plot helper: the WorkerMonitor — watches the PROCESS a dispatched agent runs on.
#
# RUN, NOT SOURCED, and started by `start_worker()` in `plot-dispatch.sh` as a
# child of the wrapper. It is never invoked by hand in normal operation: a
# monitor an operator has to remember to start is one that will be missing on
# the day it matters.
#
# ═══════════════════════════════════════════════════════════════════════════
# TWO FINDINGS, AND ONLY TWO
# ═══════════════════════════════════════════════════════════════════════════
#
#   gone   the agent pid names no live process
#   idle   the pid lives, its conversation has spoken, its TRANSCRIPT has been
#          silent past the window with no child process burning CPU behind it,
#          nothing in its tree has moved for the window either, AND commits
#          already exist on the branch
#
# Anything else is `silent`, which is not a finding and is not published. The
# distinction is the whole point: a monitor that reports every quiet moment
# teaches an operator to ignore it, and then it is worse than absent.
#
# ═══════════════════════════════════════════════════════════════════════════
# IT READS THE AGENT, NOT THE MACHINE
# ═══════════════════════════════════════════════════════════════════════════
#
# Until 2026-09-02 the reading was a 0.4 s CPU sample of the agent's subtree,
# taken twice ~30 s apart. An agent waiting on a model response burns no subtree
# CPU, so a false zero was the COMMON reading rather than the rare one, and no
# sampling interval closes that gap: a slow model response is indistinguishable
# from a dead one by CPU alone. The rule ended eleven dispatched workers across
# two days, several holding uncommitted work.
#
# A `claude -p` session appends a line to its transcript for every model turn,
# tool call and tool result. Seconds since the newest line reads whether the
# AGENT has produced anything — the question the CPU sample was standing in for.
#
# ═══════════════════════════════════════════════════════════════════════════
# TWO READINGS, BECAUSE NEITHER ANSWERS IT ALONE
# ═══════════════════════════════════════════════════════════════════════════
#
# A TRANSCRIPT IS EQUALLY QUIET IN TWO CASES that must end differently: an agent
# waiting on a model, and an agent waiting on its own 20-minute test suite.
# Wave 1 measured 7547 quiet stretches across 23 sessions on 2026-09-02, and 28
# of the 37 that passed 30 s were the second kind — the four longest being this
# repo's own gates, `gh pr checks --watch` at 600.8 s and `pnpm run test:board`
# at 600.3 s.
#
# So the window (`PLOT_MONITOR_QUIET_SECONDS`, 900 s) is a GATE and the CPU is
# the verdict beside it:
#
#   transcript inside the window                → busy   (it just wrote something)
#   past the window, a child burning CPU        → busy   (its build is running)
#   past the window, no child on a core         → quiet  (it has stopped)
#   no transcript readable                      → unknown (see the fallback)
#
# THE CPU'S ROLE IS INVERTED FROM THE OLD RULE, and that is what makes it sound
# here. The rejected rule read a FROZEN clock as a stall; this reads a MOVING
# clock as life. A moving clock proves something is happening; a frozen one
# proved nothing, which is precisely why it could not be trusted alone.
#
# ═══════════════════════════════════════════════════════════════════════════
# WHY `idle` STILL CARRIES THE TREE AND COMMIT CONDITIONS
# ═══════════════════════════════════════════════════════════════════════════
#
# What separated the three stalls measured on 2026-08-30 is that each had
# already COMMITTED and then gone quiet:
#
#   quiet, tree quiet past the window, commits present  → idle
#   quiet, tree quiet past the window, no commits yet    → silent (it may be thinking)
#   quiet, tree MOVED inside the window                  → silent (something is happening)
#
# THE MIDDLE ROW IS WHERE THE FALSE POSITIVES WOULD HAVE BEEN. An agent given a
# hard first slice is quiet for a long time with nothing to show; calling that a
# stall is the cry-wolf that costs the finding its readers. The extra two
# conditions are not caution — they are what makes the word mean something.
#
# ═══════════════════════════════════════════════════════════════════════════
# WHERE NO TRANSCRIPT CAN BE READ, IT SAYS SO
# ═══════════════════════════════════════════════════════════════════════════
#
# The reading is UNAVAILABLE, not zero and not failed — the contract
# `the-registry-supervises-its-agents` settled. The monitor then publishes
# nothing and `Worker bound` is what ends the worker. The cost is stated rather
# than hidden: a genuinely stuck agent holds a desk for up to 8 hours, which is
# smaller than the measured cost of killing working ones.
#
# ═══════════════════════════════════════════════════════════════════════════
# IT IS NOT CALLED `stalled`, AND THAT IS A CONTRACT
# ═══════════════════════════════════════════════════════════════════════════
#
# The spec owns `stalled` for an AGENT fact — *"exited 0, unlanded work, no
# PR"* (DESIGN-agent.md). A stalled agent has work to rescue; an idle worker may
# just be waiting on the network. An earlier draft reused the name and put a
# process fact on the agent side, which is the exact confusion CLAUDE.md's
# Machine/Registry split exists to prevent: this monitor watches a PROCESS, so
# its vocabulary is Worker-side.
#
# ═══════════════════════════════════════════════════════════════════════════
# ONE SAMPLE, AND THE WINDOW IS WHAT MAKES IT SAFE
# ═══════════════════════════════════════════════════════════════════════════
#
# This block read *"TWO SAMPLES, NEVER ONE — a single idle reading is a process
# caught between syscalls"* until 2026-10-02. It was written about a 0.4 s CPU
# SAMPLE, and it was right about one: a snapshot of a subtree's clock catches a
# process between syscalls, so the comparison had to be the finding.
#
# NOTHING IN THE RULE IS A SNAPSHOT ANY MORE. Since 2026-09-02 the quiet reading
# is transcript silence past a 900 s window, and since 2026-10-02 the tree
# reading is seconds since the newest thing in it moved. Each is already a SPAN
# of at least the window, and the CPU is only a veto beside them. A process
# caught between syscalls has neither 900 seconds of transcript silence nor a
# 900-second-old tree — there is no instant to be caught in.
#
# SO NO PREVIOUS SAMPLE IS KEPT, and a process no longer has to exist to hold
# one. That is what `bug/the-loop-reports-idle` then removes: the finding moves
# into the loop's own watcher and this script goes.
#
# ═══════════════════════════════════════════════════════════════════════════
# IT MAKES NO HOST CALL AT ALL
# ═══════════════════════════════════════════════════════════════════════════
#
# Not "few" — none. A monitor on a ~30s cadence that asks the host has become an
# AgentMonitor with a fast loop, and the rate problem follows it: 127 git
# processes per scan is what that costs in this repo. Every question here is
# answered by the process table or by a local git ref. `commits present` is
# counted against the LOCAL `origin/main` ref, never a fetch — and when that ref
# is missing the question is unanswerable rather than answered zero, so `idle`
# does not fire. A failure to observe is not evidence of something to see; the
# same rule `plot_worker_task_state` reached the hard way after a fallback read
# every clean branch as `stalled` in a repo with no remote.
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
# starts inside the same wrapper (the monitors are backgrounded BEFORE the
# `printf > "$PLOT_PID_FILE"`), so its first pass can genuinely land in that
# window. An ABSENT pid file therefore means *not yet*, never `gone`: reporting
# a dead agent because its birth has not been recorded would make the monitor's
# loudest finding also its least trustworthy.
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
#
# THAT EXCLUSION IS ALSO WHY THE TREE FINGERPRINT CAN TRUST `git status`. This
# monitor writes into the worktree it is watching, once per finding — so a
# fingerprint over raw `git status` would see the monitor's own file appear and
# read it as the tree changing, and the monitor would suppress `idle` forever on
# the strength of its own output. `plot_worker_dirty_filter` drops exactly that
# prefix, which is why the fingerprint goes through it rather than around it.
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
  PLOT_SESSION_ID    the launch session id; the handle when the manifest
                     carries no `resumeId`
  PLOT_MANIFEST_FILE the agent's manifest, whose `resumeId` names the current
                     conversation. With neither set, `idle` is judged on the
                     desk alone and one line on stderr says so.

  --once   take one sample and exit, rather than looping. A single pass can
           never publish `idle` — that needs two — so this is how a test drives
           the `gone` arm and the "one sample says nothing" property directly.
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
pid_file="${PLOT_PID_FILE:-${worktree:+$worktree/.plot-worker.pid}}"

# ONE ANSWER TO "IS MY SUBJECT STILL THERE?", shared with the AgentMonitor
# rather than written twice. `plot-worker-state.sh` carried five of six states
# in duplicate until the copies drifted on the sixth; two monitors deciding
# independently when to stop would drift the same way, and half a fix for a leak
# looks exactly like a fix.
#
# Sourced from THIS script's directory, so a monitor started from a worktree's
# own copy of the scripts finds that copy's helper — which is how every
# dispatched worker runs.
# shellcheck source=./plot-monitor-subject.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/plot-monitor-subject.sh"

# THE DEFAULT PATH IS DERIVED, NOT REQUIRED. The wrapper passes
# PLOT_MONITOR_FILE explicitly (one env var per path, so no quoting level inside
# the single-quoted `sh -c` can mangle a path with spaces — the convention the
# exit and pid files already use). The fallback exists so a hand-run monitor in
# a worktree still writes somewhere sensible rather than refusing.
findings="${PLOT_MONITOR_FILE:-${worktree:+$worktree/.plot-worker.monitor.worker.jsonl}}"

# THE CPU SAMPLER IS BORROWED, NOT REBUILT. `plot_worker_activity` already sums
# a pid's whole DESCENDANT subtree across a short interval and answers
# `working`/`idle`/"" — including the awk that parses `[[HH:]MM:]SS.ss` from the
# right so an hour of CPU does not wrap at 60, and the one-`ps`-snapshot walk
# that avoids forking a process per descendant. Writing a second sampler beside
# it would be two implementations of one measurement, drifting; this repo has
# already paid for that once, in the classification `plot-worker-state.sh` was
# extracted to hold.
#
# SOURCED WITH A GUARD because a monitor whose helper is missing must still say
# so rather than die silently in a detached shell nobody is reading.
plot_state_lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/plot-worker-state.sh"
# shellcheck source=plot-worker-state.sh
if [ -r "$plot_state_lib" ]; then . "$plot_state_lib"; fi

# THE TRANSCRIPT READER — the primary reading, sourced beside the CPU sampler
# rather than replacing it. What each answers is different in kind: the
# transcript says whether the AGENT has produced anything, the CPU says whether
# a CHILD is on a core. `idle` now needs both to agree.
plot_transcript_lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/plot-transcript-quiet.sh"
# shellcheck source=plot-transcript-quiet.sh
if [ -r "$plot_transcript_lib" ]; then . "$plot_transcript_lib"; fi

# THE CONVERSATION HANDLE — `session_handle`, the one the loop hands the prompt.
# The manifest's `resumeId`, else `PLOT_SESSION_ID`, both read from the
# environment the wrapper passes down. Never `plot_manifest_for_worktree`: it
# resolves `--show-toplevel` to the desk and ignores `Agent registry`, so it
# names a directory that does not exist (#1086).
plot_manifest_lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/plot-agent-manifest.sh"
# shellcheck source=plot-agent-manifest.sh
if [ -r "$plot_manifest_lib" ]; then . "$plot_manifest_lib"; fi

# HOW LONG A TRANSCRIPT MUST BE QUIET BEFORE THE QUESTION IS EVEN ASKED.
#
# 900 s, and the number comes from wave 1's measurement rather than from taste.
# `plot-quiet-stretch.sh` read 7547 quiet stretches across 23 sessions in 21
# worktrees on 2026-09-02:
#
#   p50 0s   p90 2.6s   p99 15.6s   max 600.8s
#
# 900 s is 1.5x that maximum and 57x the p99. Every stretch ever measured on
# this estate clears it with five minutes to spare.
#
# THE MAXIMUM IS NOT A DISTRIBUTION'S TAIL — IT IS A CEILING, and that is why
# the threshold alone is not the answer. The four longest stretches are this
# repo's own gates: `gh pr checks --watch` at 600.8s, `pnpm run test:board` at
# 600.3s, `pnpm run test:reconcile` at 584.9s and 575.5s. They cluster at 600
# because that is where a watch command and a test runner time out, not because
# an agent's quiet naturally ends there. A project with a slower suite produces
# a longer one, and any single number picked from this sample would kill its
# workers on the day it adopted Plot.
#
# SO THE THRESHOLD IS A GATE, NOT THE VERDICT. Past it, the monitor still asks
# whether a child process is on a core — see `sample_verdict`. The threshold
# says *this has gone on long enough to be worth asking about*; the CPU reading
# answers *and there is nothing running*. Together they separate the two cases
# a transcript cannot tell apart on its own, both of which look identically
# quiet: an agent waiting on its own 20-minute command, and an agent that has
# stopped.
: "${PLOT_MONITOR_QUIET_SECONDS:=900}"

json_escape() { # $1 = raw → prints a JSON-safe string body
  printf '%s' "$1" | python3 -c 'import json,sys; sys.stdout.write(json.dumps(sys.stdin.read())[1:-1])' 2>/dev/null \
    || printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# A FINDING CARRIES FOUR FIELDS: `finding`, `since`, `evidence`, `measuredAt`.
#
# `since` AND `measuredAt` ARE DIFFERENT TIMES, and this is the slice where they
# start to differ. `measuredAt` is when this reading was taken; `since` is when
# the finding first held. A finding that has held for twenty minutes and one
# taken twenty minutes ago are not the same fact, and an operator triaging a
# board needs the first — so `since` is carried forward across republishes and
# only reset when the finding changes.
publish() { # $1=finding $2=evidence $3=since
  local now
  now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local line
  line=$(printf '{"monitor":"%s","branch":"%s","worktree":"%s","finding":"%s","since":"%s","evidence":"%s","measuredAt":"%s"}' \
    "$monitor" \
    "$(json_escape "$branch")" \
    "$(json_escape "$worktree")" \
    "$(json_escape "$1")" \
    "${3:-$now}" \
    "$(json_escape "$2")" \
    "$now")
  # Both destinations, deliberately. The file is what a test and a future
  # subscriber read; stdout lands in `.plot-worker.log` beside the agent's own
  # output, where an operator tailing a worker sees it without knowing a second
  # file exists.
  [ -n "$findings" ] && printf '%s\n' "$line" >> "$findings" 2>/dev/null
  printf 'plot-monitor %s\n' "$line"
}

# ---------------------------------------------------------------------------
# THE PORTS — seven named seams, so every branch is reachable from a test
# ---------------------------------------------------------------------------
#
# Each of these is one question against the machine, and each is a `monitor_*`
# function for one reason: a test sources this file with `PLOT_MONITOR_NO_MAIN`
# and REDEFINES them. That is what makes the interesting branches reachable at
# all — a pid that dies between two samples, a tree that changes between two
# readings, and a subtree whose CPU is frozen are all states a real machine will
# not produce on demand, and a test that waits for one is a test that flakes.
#
# The seams are the ports; the sampler below is the logic. Nothing between them
# touches the machine directly.

# Does the agent pid name a live process?
#
# THREE ANSWERS, NOT TWO. `0` alive, `1` dead, `2` UNKNOWN — and the third is
# the startup window. The wrapper backgrounds this monitor BEFORE it writes the
# pid file, so an absent or empty file means the birth has not been recorded
# yet. Collapsing that into `dead` would make `gone` fire on every worker's
# first pass, which is the one moment it is guaranteed to be wrong.
monitor_pid_alive() { # → 0 alive | 1 dead | 2 unknown (not recorded yet)
  local pid
  [ -n "$pid_file" ] && [ -s "$pid_file" ] || return 2
  pid=$(cat "$pid_file" 2>/dev/null | tr -d '[:space:]')
  [ -n "$pid" ] || return 2
  case "$pid" in *[!0-9]*) return 2 ;; esac
  kill -0 "$pid" 2>/dev/null && return 0
  return 1
}

# The agent pid as recorded, or "" when it has not been recorded.
monitor_pid() {
  [ -n "$pid_file" ] && [ -s "$pid_file" ] || return 0
  cat "$pid_file" 2>/dev/null | tr -d '[:space:]'
}

# Is the agent's subtree burning CPU? `working` | `idle` | "" (nothing to
# measure). Delegated wholesale to the borrowed sampler.
monitor_activity() { # $1=pid → working | idle | ""
  command -v plot_worker_activity >/dev/null 2>&1 || return 0
  plot_worker_activity "$1"
}

# How long has the AGENT at this desk produced nothing? The primary reading.
#
# `unavailable` where no transcript can be read, and that word travels all the
# way to the verdict rather than being collapsed into a number. Settled by
# `the-registry-supervises-its-agents`: a capability the adopting project does
# not provide is UNAVAILABLE, never failed and never zero. A missing helper
# answers the same way — a monitor whose reader is absent must say it cannot
# see, not that it saw nothing happen.
monitor_transcript_quiet() { # → seconds | unavailable
  command -v plot_transcript_quiet_seconds >/dev/null 2>&1 || { printf 'unavailable'; return 0; }
  plot_transcript_quiet_seconds "$worktree"
}

# Has THIS worker's conversation written yet?
#
# THE DESK-WIDE NUMBER CANNOT SAY. After a hop to a new branch the loop mints a
# fresh handle, and the new conversation has no transcript file until its first
# line. Until then the desk's newest file is the PREVIOUS slice's, and its
# silence is not this worker's. So the monitor asks the loop's own probe with
# the loop's own handle: one probe, two readers, one answer.
#
# THREE ANSWERS, AND THE THIRD IS NOT THE SECOND. `0` the handle's file exists,
# `1` it does not, `2` there is no handle to ask about. `plot_transcript_exists`
# reads *no handle* as *no file*, which suits `session_flag`; here it would
# make a hand-started monitor read every quiet worker as unspoken and disable
# `idle` silently. So the handle is checked here, before the probe.
monitor_conversation_spoken() { # → 0 spoken | 1 unspoken | 2 no handle
  command -v session_handle >/dev/null 2>&1 || return 2
  command -v plot_transcript_exists >/dev/null 2>&1 || return 2
  local handle
  handle=$(session_handle) || return 2
  [ -n "$handle" ] || return 2
  plot_transcript_exists "$worktree" "$handle" && return 0
  return 1
}

# HOW LONG SINCE ANYTHING IN THIS TREE MOVED — the reading that replaced a
# comparison between two passes.
#
# UNTIL 2026-10-02 THIS WAS A FINGERPRINT, and the fingerprint is why a process
# had to exist. It answered *what does the tree look like now*, so the finding
# was the COMPARISON with the previous pass, and somebody had to hold that
# previous pass. `treeQuietSeconds` answers *how long since anything moved*,
# which the filesystem had been recording all along — and `at least the window`
# is a stronger statement than `unchanged across two passes 30 s apart`.
#
# DELEGATED WHOLESALE to `plot_worker_tree_quiet_seconds`, which the loop's own
# watcher reads too: one function, two readers, one answer. It is where the
# exclusions live — this script appends to `.plot-worker.monitor.worker.jsonl`
# INSIDE the worktree it watches, so a reading over a raw status would move
# every time the monitor published and `idle` could never fire.
#
# `unreadable` TRAVELS TO THE VERDICT rather than being collapsed into a number.
# A missing helper answers the same way: a monitor whose reader is absent must
# say it cannot see, not that it saw nothing happen.
monitor_tree_quiet() { # → seconds | unreadable
  command -v plot_worker_tree_quiet_seconds >/dev/null 2>&1 || { printf 'unreadable'; return 0; }
  plot_worker_tree_quiet_seconds "$worktree"
}

# Are there commits on this branch yet?
#
# THE THIRD CONDITION ON `idle`, and the one that separates a stall from an
# agent still thinking about a hard first slice.
#
# COUNTED AGAINST THE LOCAL `origin/<default>` REF — never a fetch, because this
# monitor makes no network call. And when there is no such ref the question is
# UNANSWERABLE, so this returns 2 and `idle` does not fire: counting against
# nothing would count the whole history from the root commit and read every
# branch in a remote-less repo as having committed, which is the failure
# `plot_worker_task_state` records having made in the other direction.
monitor_has_commits() { # → 0 yes | 1 no | 2 unanswerable
  [ -n "$worktree" ] && [ -d "$worktree" ] || return 2
  local base n
  base=$(git -C "$worktree" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)
  [ -n "$base" ] || { git -C "$worktree" rev-parse --verify --quiet origin/main >/dev/null 2>&1 && base='origin/main'; }
  [ -n "$base" ] || return 2
  # COUNT THE AGENT'S WORK, NOT THE BRANCH'S COMMITS. `plot-dispatch.sh:2074`
  # writes `commit --allow-empty -m "plot: claim <branch>"` BEFORE the agent
  # starts, so `$base..HEAD` is never zero on a dispatched branch and this
  # condition could never refuse an `idle`. Measured 2026-08-30 (#538 red in CI):
  # a worker burning CPU in `yes > /dev/null` was reported idle, because the one
  # condition that could have saved it was satisfied by bookkeeping the agent did
  # not do.
  #
  # The `-- .` pathspec is what does it: `rev-list` with a pathspec keeps only
  # commits that TOUCHED A FILE, and the claim is empty by construction
  # (`--allow-empty`). That is a property rather than a message match — a claim
  # whose wording changes still reads as empty, and an agent committing an empty
  # marker of its own is correctly not counted as work either.
  n=$(git -C "$worktree" rev-list --count "$base..HEAD" -- . 2>/dev/null) || return 2
  case "$n" in ''|*[!0-9]*) return 2 ;; esac
  [ "$n" -gt 0 ] && return 0
  return 1
}

# ---------------------------------------------------------------------------
# THE SAMPLER — one pass, using only the ports above
# ---------------------------------------------------------------------------
#
# NO PREVIOUS SAMPLE IS KEPT, and that is this slice's whole point. `idle` was
# a comparison between two passes, so `prev_verdict` and `prev_tree` held the
# first one and a process had to exist to hold them. Every condition behind the
# finding is now a duration the desk itself records, so one pass answers it.
#
# WHAT SURVIVES IS NOT A SAMPLE. `published` is the finding currently standing
# and `since` is when it first held; both exist so that a held finding is
# published ONCE rather than on every pass, which is a property of the CHANNEL
# and not of the rule. A monitor restarted re-publishes one line and loses
# nothing, where a lost `prev_tree` cost a whole interval's delay.
published=''
since=''

# What this pass sees, before the two-sample rule is applied.
#
# THE ORDER IS LOAD-BEARING. `gone` is asked FIRST because a dead pid makes
# every other question meaningless — you cannot measure the CPU of a subtree
# that is not there, and `plot_worker_activity` would answer "" for it anyway,
# which is indistinguishable from a live pid with no children.
sample_verdict() { # → gone | quiet | busy | unknown | unspoken
  local alive
  monitor_pid_alive; alive=$?
  [ "$alive" = 1 ] && { printf 'gone'; return; }
  # `unknown` is the startup window: the wrapper has not recorded the pid yet.
  # Not a finding, and NOT `gone`.
  [ "$alive" = 2 ] && { printf 'unknown'; return; }

  # THE TRANSCRIPT IS ASKED FIRST, and it is asked instead of the CPU rather
  # than beside it. Until 2026-09-02 this read `plot_worker_activity` alone and
  # called a frozen 0.4 s CPU sample `quiet`; that rule ended eleven dispatched
  # workers across two days, several holding uncommitted work. An agent waiting
  # on a model response burns no subtree CPU, so a false zero was the COMMON
  # reading rather than the rare one, and no sampling interval closes that gap.
  #
  # A `claude -p` session appends to its transcript for every turn, tool call
  # and tool result. Seconds since the newest line is a direct reading of
  # whether the AGENT has done anything — which is the question the monitor was
  # always trying to ask.
  local quiet
  quiet=$(monitor_transcript_quiet)

  # UNAVAILABLE IS NOT A FINDING, and this is where the plan's fallback lands.
  # Where no transcript can be read there is no reading that distinguishes
  # thinking from stuck, so the monitor invents none: it reports `unknown`,
  # publishes nothing, and `Worker bound` is what ends the worker. The cost is
  # stated rather than hidden — a genuinely stuck agent then holds a desk for up
  # to 8 hours, which is smaller than the measured cost of the rule this
  # replaces.
  case "$quiet" in
    ''|unavailable)    printf 'unknown'; return ;;
    *[!0-9]*)          printf 'unknown'; return ;;
  esac

  # Inside the window, the agent has produced output recently. Nothing else
  # needs asking: no CPU sample can overturn a line written seconds ago.
  if [ "$quiet" -lt "$PLOT_MONITOR_QUIET_SECONDS" ]; then printf 'busy'; return; fi

  # PAST THE WINDOW, AND ONLY HERE, ASK WHETHER THIS CONVERSATION HAS WRITTEN.
  # The number is the desk's; a new conversation with no file yet has produced
  # none of its silence. `unspoken` is a reading that was made, and it is not
  # `unknown`, which is no reading. Only `1` answers it: with no handle (`2`)
  # the verdict is judged on the desk alone, as before this port existed.
  #
  # LAZY ON PURPOSE. `session_handle` starts one `node` (about 35 ms), so a
  # worker inside the window never pays it.
  local spoken
  monitor_conversation_spoken; spoken=$?
  [ "$spoken" = 1 ] && { printf 'unspoken'; return; }

  # PAST THE WINDOW, THE SECOND READING DECIDES — and it answers a question the
  # transcript cannot. A transcript is equally quiet whether the agent is
  # waiting on a model or waiting on its own 20-minute test suite. 28 of the 37
  # over-window stretches wave 1 measured were the latter.
  #
  # So the CPU is consulted for what it CAN say: `working` means a child is on a
  # core, and an agent whose build is running has not stopped. That is not the
  # rejected rule returning — the rejected rule read `idle` as a stall, and this
  # reads `working` as life. The asymmetry is the point: a moving clock proves
  # something is happening, while a frozen one proved nothing, which is exactly
  # why it could not be trusted alone.
  case "$(monitor_activity "$(monitor_pid)")" in
    working) printf 'busy' ;;
    # `idle` (frozen subtree clock) and "" (no child holding a clock at all)
    # agree here: fifteen minutes of transcript silence with nothing burning CPU
    # behind it. Unlike the old rule, "" is not refused — a live pid with no
    # child is precisely an agent that has stopped, and it only reaches this
    # line after the window has already elapsed.
    *)       printf 'quiet' ;;
  esac
}

# One full pass: take the readings, ask the rule, publish only on a change.
monitor_pass() {
  local verdict tree evidence finding commits rc2
  verdict=$(sample_verdict)

  finding=''
  evidence=''
  case "$verdict" in
    gone)
      # ONE SAMPLE IS ENOUGH FOR `gone`, and this arm is UNTOUCHED by the
      # one-sample slice — it never needed two. A dead pid is not a transient
      # reading the way a frozen CPU clock is: a process does not come back.
      # The slice that moves this finding to the wrapper is the next one; here
      # it stays exactly as it was.
      finding='gone'
      evidence="the agent pid $(monitor_pid) names no live process; the worker's desk is unattended"
      ;;
    quiet)
      # ONE READING, AND THE RULE JUDGES IT. `sample_verdict` has already
      # established five of the six conditions to reach this word — the pid is
      # alive, the conversation has spoken, the transcript is past the window,
      # and no child is on a core — so what is read here is the tree's own
      # quiet and the commit question, and all six go to the shared rule.
      #
      # THE RULE IS ASKED RATHER THAN RESTATED. `plot_worker_idle_now` lives in
      # `plot-worker-state.sh` and the loop's watcher reads the same function;
      # `idleNow` in the domain holds the same rule, and
      # `packages/domain/corpus/sample.corpus.test.ts` holds the pair. A second
      # copy of the conditions in this file is what the corpus tier exists to
      # prevent.
      tree=$(monitor_tree_quiet)
      monitor_has_commits; rc2=$?
      case "$rc2" in
        0) commits='yes' ;;
        1) commits='no' ;;
        # No ref to count against: the question was never put. `unanswerable`
        # is not `no`, and the rule withholds the finding for both — but the
        # words are kept apart because a failure to observe is not evidence.
        *) commits='unanswerable' ;;
      esac
      # Every condition `sample_verdict` already proved is passed as the word
      # the rule expects, so the rule is asked ONE question rather than two
      # halves of one. `alive`, spoken and a silence past the window are what
      # `quiet` means.
      if [ "$(plot_worker_idle_now 'alive' '1' "$PLOT_MONITOR_QUIET_SECONDS" '' \
                                   "$tree" "$commits" "$PLOT_MONITOR_QUIET_SECONDS")" = 'idle' ]; then
        finding='idle'
        evidence="the agent pid $(monitor_pid) is alive but its transcript has been silent for over ${PLOT_MONITOR_QUIET_SECONDS}s with no child process burning CPU behind it, nothing in its tree has moved for ${tree}s, and the branch already carries commits"
      fi
      ;;
    # `busy`, `unknown` and `unspoken` are not findings. Nothing is published,
    # which is the design: silence means healthy, and the AgentMonitor's slower
    # loop is what catches a worker that finished without saying so.
    #
    # `unspoken` NO LONGER DELAYS A PASS, and the protection it gave is now the
    # window's. Before this slice it was recorded as `prev_verdict`, so `idle`
    # needed two `quiet` passes after the conversation's first line; now one
    # pass answers, and what stands between a conversation's first line and an
    # `idle` finding is the 900 s of silence that line has to be followed by.
    # No grace period bounds it: a prompt that stays alive and never writes a
    # line ends at `Worker bound`, the cost `unknown` already carries.
  esac

  # PUBLISH ONLY ON A CHANGE — the plan's "it publishes the moment a finding
  # holds and publishes nothing when nothing changed". A monitor that
  # re-published `idle` every 30 seconds would fill the findings file with one
  # fact repeated, and a subscriber could not tell a NEW stall from an old one.
  #
  # The clearing case is a publish too: a finding that held and then stopped
  # holding is news, and a board that never hears it leaves a stale entry up
  # after the worker recovered.
  if [ "$finding" != "$published" ]; then
    if [ -n "$finding" ]; then
      since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
      publish "$finding" "$evidence" "$since"
    elif [ -n "$published" ]; then
      since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
      publish 'clear' "the ${published} finding no longer holds; the worker is measuring healthy again" "$since"
    fi
    published="$finding"
  fi
}

# SOURCEABLE FOR TESTS. A test that wants to drive `monitor_pass` against
# redefined ports needs the functions without the loop; everything above this
# line defines, and nothing below it runs when the guard is set.
[ -n "${PLOT_MONITOR_NO_MAIN:-}" ] && return 0 2>/dev/null

# ONE LINE AT START WHEN THERE IS NO HANDLE. Every wrapper-started monitor has
# one, because `plot-dispatch.sh` sets `PLOT_SESSION_ID` on every launch; only a
# monitor started by hand has none. It then behaves as it did before the
# conversation probe, and says so rather than degrading silently.
if [ -z "${PLOT_SESSION_ID:-}" ] && [ -z "${PLOT_MANIFEST_FILE:-}" ]; then
  echo 'plot-worker-monitor: no session handle (PLOT_SESSION_ID and PLOT_MANIFEST_FILE unset) — idle is judged on the desk alone' >&2
fi

monitor_pass
[ "$once" = 1 ] && exit 0

# THE LOOP IS THE CADENCE, NOT THE COMPARISON. `idle` needs ONE reading as of
# 2026-10-02, so `--once` can now report it — and that is the property the next
# slice rests on, because a finding one pass can make is a finding the loop's
# own watcher can make without a resident process. The loop here is what keeps
# ASKING, which is a different job from holding a previous answer.
#
# SILENCE IS MEANINGFUL HERE, and it is the opposite of what the no-op slice
# needed. That monitor published every pass so that an attached-but-blind
# monitor could not be mistaken for a watching one; this one publishes only on a
# change, because it HAS something to say and saying it repeatedly would bury
# it. Telling a healthy silence from a dead monitor is the channel's job —
# `feature/the-channel-carries-the-findings`, whose heartbeat is exactly that
# distinction.
#
# AND IT ENDS WITH ITS AGENT. Until 2026-08-30 it did not, and the estate showed
# it: 34 of 40 monitors on this machine were `ppid=1`, and the orphans cost half
# the machine's spawn cost (23.3 ms per 100 forks against 4.8 ms quiet). The
# wrapper `wait`s on the agent alone — correctly, since waiting on two infinite
# loops would hang and `.plot-worker.exit` would never be written — so when the
# wrapper exits, its monitors are re-parented to `init` and loop forever.
# `docs/research/2026-08-30-what-ends-a-monitor.md` has the measurement and the
# commands that show it, on both the ordinary path and the `Worker bound` one.
#
# PUBLISH FIRST, THEN ASK — the order is the lower bound, and this monitor is
# exactly where it matters. `gone` is one of its two findings, so a monitor that
# checked the subject BEFORE its pass would exit on a dead agent without ever
# reporting the death — the loudest finding it has, lost to the mechanism meant
# to bound it. `plot_monitor_wait` returns only after `monitor_pass` has run.
#
# IT IS A MEASUREMENT, NOT A TIMER, which the plan requires in as many words: a
# monitor exiting after N seconds regardless would pass every visible assertion
# and destroy the property the design rests on. This reads the process table —
# the same source the `gone` finding above reads, asked for a different purpose.
while plot_monitor_wait "$interval" "$pid_file"; do
  monitor_pass
done

# THE FINAL PASS, and for this monitor it is not a courtesy — it is the `gone`
# finding itself.
#
# `plot_monitor_wait` returns non-zero the moment the agent's pid names no live
# process, so control arrives here with the subject already dead and NOTHING yet
# published about it. One more pass runs, `monitor_pass` measures the same dead
# pid the wait just saw, and `gone` is published on the way out.
#
# Without this line the monitor would exit silently on exactly the event it
# exists to report — the upper bound eating the finding rather than the lower
# bound. It would still pass "no monitor remains", which is why the suite
# asserts the last finding's `measuredAt` against the exit file rather than
# asserting the exit alone.
monitor_pass
exit 0
