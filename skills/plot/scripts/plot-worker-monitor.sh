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
#   idle   the pid lives, its subtree burned no CPU across two consecutive
#          passes, the tree did not change between them, AND commits already
#          exist on the branch
#
# Anything else is `silent`, which is not a finding and is not published. The
# distinction is the whole point: a monitor that reports every quiet moment
# teaches an operator to ignore it, and then it is worse than absent.
#
# ═══════════════════════════════════════════════════════════════════════════
# WHY `idle` CARRIES THREE CONDITIONS AND NOT ONE
# ═══════════════════════════════════════════════════════════════════════════
#
# A worker waiting on a long model response has the SAME zero CPU delta as one
# whose agent has vanished. The delta alone cannot tell them apart, so it is not
# the finding. What separated the three stalls measured on 2026-08-30 is that
# each had already COMMITTED and then gone quiet:
#
#   no CPU, tree unchanged, commits present   → idle
#   no CPU, tree unchanged, no commits yet    → silent (it may be thinking)
#   no CPU, tree CHANGED between samples      → silent (something is happening)
#
# THE MIDDLE ROW IS WHERE THE FALSE POSITIVES WOULD HAVE BEEN. An agent given a
# hard first slice is quiet for a long time with nothing to show; calling that a
# stall is the cry-wolf that costs the finding its readers. The extra two
# conditions are not caution — they are what makes the word mean something.
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
# TWO SAMPLES, NEVER ONE
# ═══════════════════════════════════════════════════════════════════════════
#
# A single idle reading is a process caught between syscalls. The COMPARISON is
# the finding, so the monitor keeps the previous answer — one piece of state,
# and derived rather than recorded: lose it (restart the monitor, say) and the
# next pass rebuilds it, at one interval's delay. Nothing is persisted, because
# nothing needs to be.
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
# THE PORTS — four named seams, so every branch is reachable from a test
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

# A cheap stand-in for "the tree as it is right now", compared between passes.
#
# IT GOES THROUGH `plot_worker_dirty_filter`, which is not an optimisation — it
# is what stops the monitor from watching itself. This script appends to
# `.plot-worker.monitor.worker.jsonl` INSIDE the worktree it is watching, so a
# raw `git status` fingerprint would change every time the monitor published and
# `idle` could never hold for two passes. The filter drops the `.plot-worker.`
# prefix (and editor leftovers, and tool scratch) for exactly the reasons
# recorded where it is defined.
#
# THE FILTERED FILE LIST, NOT A CONTENT HASH. What is being asked is *did
# anything happen here*, and an agent at work adds, removes and renames files
# far more often than it rewrites one in place at byte-identical length. A
# content hash over a large tree on a 30s loop would also be the one expensive
# thing in an otherwise cheap monitor.
monitor_tree_fingerprint() { # → an opaque string; unchanged means unchanged
  [ -n "$worktree" ] && [ -d "$worktree" ] || { printf 'no-tree'; return 0; }
  local status
  status=$(git -C "$worktree" status --porcelain 2>/dev/null)
  local head
  head=$(git -C "$worktree" rev-parse HEAD 2>/dev/null || printf 'no-head')
  # HEAD is part of the fingerprint too: an agent that COMMITS between two
  # passes has plainly done something, and its status output may well be
  # identical either side of the commit.
  if command -v plot_worker_dirty_filter >/dev/null 2>&1; then
    printf '%s\n%s' "$head" "$(plot_worker_dirty_filter "$status")"
  else
    printf '%s\n%s' "$head" "$status"
  fi
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
# THE STATE IS TWO VARIABLES AND IT IS DERIVED. `prev_verdict` is the previous
# pass's answer and `prev_tree` its fingerprint; `since` is when the CURRENT
# published finding first held. Nothing is written down: kill the monitor and
# the next one rebuilds all three, one interval late. That is the plan's "one
# piece of state, derived rather than recorded", and it is why a monitor
# restart costs an interval rather than a wrong answer.
prev_verdict=''
prev_tree=''
published=''
since=''

# What this pass sees, before the two-sample rule is applied.
#
# THE ORDER IS LOAD-BEARING. `gone` is asked FIRST because a dead pid makes
# every other question meaningless — you cannot measure the CPU of a subtree
# that is not there, and `plot_worker_activity` would answer "" for it anyway,
# which is indistinguishable from a live pid with no children.
sample_verdict() { # → gone | quiet | busy | unknown
  local alive rc
  monitor_pid_alive; alive=$?
  [ "$alive" = 1 ] && { printf 'gone'; return; }
  # `unknown` is the startup window: the wrapper has not recorded the pid yet.
  # Not a finding, and NOT `gone`.
  [ "$alive" = 2 ] && { printf 'unknown'; return; }

  local act
  act=$(monitor_activity "$(monitor_pid)")
  case "$act" in
    working) printf 'busy' ;;
    idle)    printf 'quiet' ;;
    # "" — a live pid whose subtree holds no CPU clock at all. The absence of a
    # child is not the presence of an idle one; the same refusal
    # `plot_worker_activity` makes for its own empty answer.
    *)       printf 'unknown' ;;
  esac
  rc=0; return $rc
}

# One full pass: sample, apply the two-sample rule, publish only on a change.
monitor_pass() {
  local verdict tree evidence finding
  tree=$(monitor_tree_fingerprint)
  verdict=$(sample_verdict)

  finding=''
  evidence=''
  case "$verdict" in
    gone)
      # ONE SAMPLE IS ENOUGH FOR `gone`, and only for `gone`. A dead pid is not
      # a transient reading the way a frozen CPU clock is — a process does not
      # come back. Requiring two passes here would delay the one finding that is
      # already certain by a whole interval, for no gain in confidence.
      finding='gone'
      evidence="the agent pid $(monitor_pid) names no live process; the worker's desk is unattended"
      ;;
    quiet)
      # THE TWO-SAMPLE RULE, and the two extra conditions with it. All four must
      # hold together: this pass quiet, the PREVIOUS pass quiet, the tree
      # unchanged between them, and commits already on the branch.
      if [ "$prev_verdict" = 'quiet' ] && [ "$tree" = "$prev_tree" ]; then
        local has rc2
        monitor_has_commits; rc2=$?
        if [ "$rc2" = 0 ]; then
          finding='idle'
          evidence="the agent pid $(monitor_pid) is alive but its subtree burned no CPU across two consecutive passes ~${interval}s apart, the tree is unchanged between them, and the branch already carries commits"
        fi
        # rc2 = 1 → no commits yet: the middle row. It may be thinking, and
        # calling that a stall is what teaches an operator to ignore the word.
        # rc2 = 2 → unanswerable: no ref to count against, so no finding. A
        # failure to observe is not evidence of something to see.
      fi
      ;;
    # `busy` and `unknown` are not findings. Nothing is published, which is the
    # design: silence means healthy, and the AgentMonitor's slower loop is what
    # catches a worker that finished without saying so.
  esac

  prev_verdict="$verdict"
  prev_tree="$tree"

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

monitor_pass
[ "$once" = 1 ] && exit 0

# THE LOOP IS WHERE THE COMPARISON LIVES. `idle` needs two readings, so a
# monitor that ran once and exited could never report it — which is why `--once`
# is a test affordance and not a mode anyone dispatches.
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
