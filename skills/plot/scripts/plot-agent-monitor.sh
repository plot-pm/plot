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
# FOUR FINDINGS, AND SILENCE MEANS THE DESK OWES NOTHING
# ═══════════════════════════════════════════════════════════════════════════
#
# | finding                 | measurement                                        |
# |-------------------------|----------------------------------------------------|
# | **owes a review**       | commits ahead, tree clean, no PR                   |
# | **owes a gate**         | commits ahead, and a repo gate the branch fails    |
# | **owes an answer**      | a `PLOT-BLOCKED*` marker in the tree               |
# | **holds unlanded work** | uncommitted or unpushed changes in the tree        |
#
# It published `nothing measured yet` on every pass until this slice, which was
# the Attaching slice saying honestly that it was attached and blind. That string
# is gone, and its absence is now the healthy signal: an attached monitor with
# nothing to say publishes NOTHING, and the AgentMonitor's file existing at all
# is what separates *watched and clean* from *never started*.
#
# ═══════════════════════════════════════════════════════════════════════════
# THE DEBT OUTLIVES THE AGENT'S ATTENTION, AND THAT IS THE POINT
# ═══════════════════════════════════════════════════════════════════════════
#
# The monitor does NOT have to catch the moment work finishes. A debt persists
# until it is paid — until a PR exists, until the marker is answered, until the
# commits are pushed — so a finding one interval late is as good as one on time.
# That is what licenses a five-minute cadence for findings about work that
# finishes in seconds, and it is why nothing here races the agent.
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
# IT OBSERVES; IT DOES NOT ACT — AND IT WRITES NOTHING AT ALL
# ═══════════════════════════════════════════════════════════════════════════
#
# It does not kill a process, open a PR, reap a worktree or restart an agent.
# Every one of those is a judgement with a blast radius, and `plot-reap.sh` and
# `plot-dispatch.sh` already own them behind their own refusals. That boundary
# is what makes a monitor safe to run continuously: a watcher that can only
# report is one nobody has to supervise.
#
# PUBLISHING IS ITS ONLY OUTPUT, and that is stricter than "it does not act".
# It writes no state file, no cache, no marker, and nothing into the repository
# it is watching — not even a record of what it last published. The two
# variables that make "publish on change" work live in memory and die with the
# process, so a restarted monitor re-derives them one interval late rather than
# reading a stale one. Opening the PR that `owes a review` calls for belongs to
# `feature/a-report-can-open-the-pr`, through the controller, and not here.
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

  --once   take one sample and exit, rather than looping. A test
           affordance: nothing dispatches this mode.
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

# THE SUBJECT, read the same way the WorkerMonitor reads it: `.plot-worker.pid`
# names the AGENT, and the wrapper passes its path in `PLOT_PID_FILE`.
pid_file="${PLOT_PID_FILE:-${worktree:+$worktree/.plot-worker.pid}}"

# ONE ANSWER TO "IS MY SUBJECT STILL THERE?", shared with the WorkerMonitor.
# The 300 s cadence is exactly why this monitor must not decide separately: an
# AgentMonitor that checked only after a full sleep would outlive an agent that
# finished in ten seconds by nearly five minutes, on every dispatch. The helper
# splits the WAIT and leaves the PASS alone, so the host is still asked at 300 s
# and the two cadences stay apart.
# shellcheck source=./plot-monitor-subject.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/plot-monitor-subject.sh"

# THE DESK'S OWN READINGS, borrowed rather than rewritten. `plot_worker_dirty`,
# `plot_worker_dirty_filter`, `plot_worker_blocked` and
# `plot_worker_blocked_file` already answer three of this monitor's four
# questions, and they are the SAME answers the fleet scan gives — which is the
# whole point of sourcing them. A monitor that decided independently what a
# dirty tree or a blocked desk looks like would drift from the scan, and the
# operator would get two components disagreeing about one worktree.
#
# `plot_worker_dirty_filter` matters most: it drops the `.plot-worker.` prefix,
# and this script APPENDS to `.plot-worker.monitor.agent.jsonl` inside the very
# worktree it measures. Without the filter every monitored desk would report
# `holds unlanded work` about the monitor's own findings file, one pass in,
# across the whole fleet.
#
# SOURCED WITH A GUARD because a monitor whose helper is missing must still say
# so rather than die silently in a detached shell nobody is reading. Each port
# below tests for its function with `command -v` and refuses rather than
# guessing.
plot_state_lib="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/plot-worker-state.sh"
# shellcheck source=plot-worker-state.sh
if [ -r "$plot_state_lib" ]; then . "$plot_state_lib"; fi

json_escape() { # $1 = raw → prints a JSON-safe string body
  printf '%s' "$1" | python3 -c 'import json,sys; sys.stdout.write(json.dumps(sys.stdin.read())[1:-1])' 2>/dev/null \
    || printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# A FINDING CARRIES FOUR FIELDS: `finding`, `since`, `evidence`, `measuredAt` —
# the same four the WorkerMonitor publishes, for the same reason: one subscriber
# will read both files and must not need a second parser to do it.
#
# `since` AND `measuredAt` ARE DIFFERENT TIMES, and the gap matters more here
# than it does next door. This monitor samples every five minutes, so a debt
# that has held for an hour and one first seen at the last pass carry the same
# `measuredAt` and very different `since`. On a slow cadence, `since` is the
# field that says how long nobody noticed.
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
  # Both destinations, for the WorkerMonitor's reason: the file is what a
  # subscriber reads, and stdout lands in `.plot-worker.log` beside the agent's
  # own output where an operator tailing a worker sees it without knowing a
  # second file exists.
  [ -n "$findings" ] && printf '%s\n' "$line" >> "$findings" 2>/dev/null
  printf 'plot-monitor %s\n' "$line"
}

# ---------------------------------------------------------------------------
# THE PORTS — five named seams, so every branch is reachable from a test
# ---------------------------------------------------------------------------
#
# Same convention as the WorkerMonitor's four, and for the same reason: a test
# sources this file with `PLOT_MONITOR_NO_MAIN=1` and REDEFINES them. Here the
# argument is stronger, because one of these seams is a HOST ROUND TRIP. A host
# that refuses is the state this monitor must handle correctly and the one a
# test can least afford to produce for real — you cannot break GitHub to see
# what happens, and waiting for it to break on its own is not a test.
#
# The seams are the ports; the sampler below is the logic. Nothing between them
# touches the machine or the host directly.

# Does the branch have a PR — open or merged — right now?
#
# → 0 yes | 1 no | 2 the host could not be asked
#
# THREE ANSWERS, AND THE THIRD IS THE WHOLE REASON THIS IS A PORT. `pr_merged`
# and `pr_open` both collapse an unreachable host into "no", which is right for
# THEIR callers: the reaper and the ref deleter are deciding whether to destroy
# something, and silence must never be permission. Here the direction inverts.
# A monitor that read an unreachable host as "no PR" would report `owes a
# review` about every branch on the estate the moment `gh` lost its token — a
# storm of findings whose common cause is that nothing was measured at all.
#
# So this asks the two questions separately and keeps the distinction the
# helpers throw away: `gh` absent, unauthed, or failing is `unaskable`, and an
# unaskable host produces NO finding rather than a wrong one. A failure to
# observe is not evidence of something to see.
#
# THE HOST IS ASKED THROUGH `plot-host.sh`, never `gh` directly. This port
# called `gh pr list` until 2026-09-05, so the monitor could see a PR on GitHub
# and nowhere else: on Bitbucket `command -v gh` failed and every branch on the
# estate read `unaskable` — the refusal was right about the wrong thing, since
# the host was reachable and simply not GitHub. `pr-state` answers on both.
#
# THE ADAPTER'S TWO OUTCOMES ARE ALREADY THIS PORT'S TWO. `pr-state` exits 0
# with `state:"NONE"` when the host answered and there is no PR, and non-zero
# when the call itself failed — which is exactly the line between `no PR` and
# `unaskable` that the `gh` version drew with `|| return 2`. So the split is
# read from the exit status and the payload together, and neither answer moved.
monitor_pr_state() { # → 0 has a PR | 1 no PR | 2 unaskable
  [ -n "$branch" ] || return 2
  local host_script out state
  host_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/plot-host.sh"
  [ -r "$host_script" ] || return 2
  # `</dev/null` so a host CLI that decides to prompt cannot hang a monitor
  # whose whole contract is one bounded reading per pass.
  out=$(bash "$host_script" pr-state "$branch" </dev/null 2>/dev/null) || return 2
  # THE EXIT STATUS DECIDES WHETHER THE HOST WAS ASKED; the payload only says
  # what it answered. `pr-state` exits non-zero when the call failed and 0 when
  # it did not, so anything reaching this line is an answer.
  #
  # A MISS IS `NONE`, AND SO IS A NULL. `state:"NONE"` is the adapter's word for
  # "no PR found", but the same miss reaches here as `state:null` when the host
  # CLI answers with a payload carrying no PR — measured 2026-09-05 against
  # `test/e2e/agent-monitor-reads.test.mjs`, where `gh pr view` on a branch with
  # no PR produced `{"number":null,"state":null,…}` and exit 0.
  #
  # Reading that null as `unaskable` is what the first draft of this port did,
  # and it is wrong in the direction that hides the finding: an agent that
  # committed and opened nothing produced no `owes a review` at all, because the
  # monitor believed it had never measured. A failure to observe is not evidence
  # of something to see — but neither is an observation evidence of a failure.
  state=$(printf '%s' "$out" | jq -r '.state // "NONE"' 2>/dev/null) || return 2
  case "$state" in
    NONE|null|"") return 1 ;;
    *) return 0 ;;
  esac
}

# Does the branch carry commits the default branch does not have?
#
# → 0 yes | 1 no | 2 unanswerable
#
# COUNTED AGAINST THE LOCAL `origin/<default>` REF, never a fetch — this monitor
# makes exactly one network call per pass and it is the PR lookup. And the
# `-- .` pathspec is load-bearing for the same measured reason it is next door:
# `plot-dispatch.sh` writes an empty `plot: claim <branch>` commit BEFORE the
# agent starts, so a bare count is never zero on a dispatched branch and `owes a
# review` would fire on every worker the moment it was born. `rev-list` with a
# pathspec keeps only commits that touched a file, and the claim is empty by
# construction.
monitor_has_commits() { # → 0 yes | 1 no | 2 unanswerable
  [ -n "$worktree" ] && [ -d "$worktree" ] || return 2
  local base n
  base=$(git -C "$worktree" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)
  [ -n "$base" ] || { git -C "$worktree" rev-parse --verify --quiet origin/main >/dev/null 2>&1 && base='origin/main'; }
  [ -n "$base" ] || return 2
  n=$(git -C "$worktree" rev-list --count "$base..HEAD" -- . 2>/dev/null) || return 2
  case "$n" in ''|*[!0-9]*) return 2 ;; esac
  [ "$n" -gt 0 ] && return 0
  return 1
}

# Is the tree clean — nothing uncommitted that counts as work?
#
# Prints the dirty files, one per line, or nothing. Delegated wholesale to
# `plot_worker_dirty`, which is what makes this monitor's own findings file
# invisible to it: the filter drops the `.plot-worker.` prefix, so publishing
# INTO the worktree it watches does not make the desk read as holding unlanded
# work. Without that, every monitored worktree on the estate would report `holds
# unlanded work` about the monitor itself, forever, starting one pass in.
monitor_dirty() { # → the dirty files, one per line
  command -v plot_worker_dirty >/dev/null 2>&1 || return 0
  plot_worker_dirty "$worktree"
}

# Does a person owe this branch an answer?
#
# → 0 a `PLOT-BLOCKED*` marker is in the tree | 1 none
#
# Delegated to `plot_worker_blocked` so the monitor and the fleet scan agree
# about what a blocked desk looks like. The glob is deliberate on that side —
# the scan looks for `PLOT-BLOCKED*` rather than the exact name, so a worker
# that wrote `PLOT-BLOCKED-2.md` is still visible.
monitor_blocked() { # → 0 blocked | 1 not
  command -v plot_worker_blocked >/dev/null 2>&1 || return 1
  plot_worker_blocked "$worktree"
}

# Are there commits the branch's own upstream does not have?
#
# → 0 yes | 1 no or unanswerable
#
# ONLY `@{upstream}` ANSWERS THIS, and an absent upstream is UNANSWERABLE rather
# than answered zero. `plot_worker_task_state` records having got this wrong in
# both directions: counting against nothing counts the whole history from the
# root commit, and counting against the trunk marks every branch under review
# unpushed, because being ahead of the trunk is what having commits MEANS.
monitor_unpushed() { # → 0 yes | 1 no or unanswerable
  [ -n "$worktree" ] && [ -d "$worktree" ] || return 1
  local ahead
  ahead=$(git -C "$worktree" rev-list --count '@{upstream}..HEAD' 2>/dev/null) || return 1
  case "$ahead" in ''|0|*[!0-9]*) return 1 ;; esac
  return 0
}

# Does the branch add a changeset?
#
# → 0 yes | 1 no | 2 unanswerable
#
# THE ONLY GATE THIS MONITOR ASKS, and the brief fixes the boundary: a gate
# belongs here only if it can be answered FROM THE WORKTREE ALONE, in the time
# this pass already spends. *"Is there a new `.changeset/*.md`"* qualifies; *"do
# the tests pass"* does not, and asking it would turn a five-minute sample into
# a build. Running CI to predict CI is a second CI.
#
# NEW, not present — and the difference is the whole measurement.
# `.changeset/` holds SIBLINGS' changesets on `main` at any moment, so a branch
# that wrote none still sees a directory full of files. The question is which
# `.changeset/*.md` paths this branch ADDED against the base, which `git diff
# --name-only --diff-filter=A` answers without reading a single file.
#
# Measured 2026-08-30: `feature/the-workflows-decide-without-acting` had
# commits, a clean tree and no marker — every other finding said nothing — and
# no changeset, so it would have landed red.
monitor_changeset() { # → 0 has one | 1 none | 2 unanswerable
  [ -n "$worktree" ] && [ -d "$worktree" ] || return 2
  local base added
  base=$(git -C "$worktree" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)
  [ -n "$base" ] || { git -C "$worktree" rev-parse --verify --quiet origin/main >/dev/null 2>&1 && base='origin/main'; }
  [ -n "$base" ] || return 2
  added=$(git -C "$worktree" diff --name-only --diff-filter=A "$base...HEAD" -- '.changeset/*.md' 2>/dev/null) || return 2
  [ -n "$added" ] && return 0
  return 1
}

# ---------------------------------------------------------------------------
# THE SAMPLER — one pass, using only the ports above
# ---------------------------------------------------------------------------
#
# THE STATE IS TWO VARIABLES AND IT IS DERIVED, exactly as next door.
# `published` is the finding currently standing and `since` is when it started
# holding. Nothing is written down: kill the monitor and the next one rebuilds
# both, one interval late. That is the plan's "one piece of state, derived
# rather than recorded" — and on this cadence it is also the reason a restart
# costs five minutes rather than a wrong answer.
published=''
since=''

# ---------------------------------------------------------------------------
# ONE FINDING PER PASS, AND THE ORDER IS THE POINT
# ---------------------------------------------------------------------------
#
# The four findings are NOT mutually exclusive the way the WorkerMonitor's
# verdicts are — a desk can hold a marker AND uncommitted work AND commits with
# no PR, all true at once. The record carries one `finding`, so the sampler has
# to choose, and it chooses by WHAT THE READER MUST DO FIRST:
#
#   1. owes an answer      a person is the blocker; nothing else can proceed
#   2. holds unlanded work the work is not safe yet; a PR would be incomplete
#   3. owes a review       the work is complete and invisible
#   4. owes a gate         the work is visible but would land red
#
# THAT IS THE ORDER `plot_worker_task_state` ALREADY USES — blocked, then dirty,
# then finished — and matching it is deliberate. Two components ranking the same
# desk's debts differently is the drift `plot-worker-state.sh` was extracted to
# end, and a subscriber reading both files would have to know which order it was
# looking at.
#
# `owes a gate` SITS BELOW `owes a review` RATHER THAN COMPETING WITH IT. A
# branch with no PR and no changeset owes a review FIRST: the plan's Acting
# slice opens the PR anyway and names the missing gate in the body, because
# withholding it would leave finished work invisible until someone happens to
# write the changeset — the exact failure this plan exists to end, one step
# later. So the gate is reported on its own only once a PR exists, where it is
# the one thing left to fix.
sample_finding() { # → prints "finding\tevidence", or nothing
  local rc

  # 1. OWES AN ANSWER — a marker in the tree. Asked FIRST because it is the one
  # finding whose subject is a PERSON. Everything below describes work an agent
  # could still finish; this one cannot move until somebody reads a file.
  if monitor_blocked; then
    local marker
    marker=$(plot_worker_blocked_file "$worktree" 2>/dev/null)
    printf 'owes an answer\ta %s marker is in the tree at %s; the agent stopped and a person has not answered\n' \
      "${marker:-PLOT-BLOCKED}" "$worktree"
    return 0
  fi

  # 2. HOLDS UNLANDED WORK — uncommitted, or committed and unpushed. Both are
  # the same debt to a reader (work exists in one place only) and neither is
  # safe to review, so they share a finding and differ in the evidence.
  local dirty
  dirty=$(monitor_dirty)
  if [ -n "$dirty" ]; then
    local n
    n=$(printf '%s\n' "$dirty" | grep -c . )
    printf 'holds unlanded work\t%s uncommitted file(s) at %s, the first being %s; the work exists only on this desk\n' \
      "$n" "$worktree" "$(printf '%s\n' "$dirty" | head -1)"
    return 0
  fi
  if monitor_unpushed; then
    printf 'holds unlanded work\tthe branch carries commits its upstream does not have; the work exists only on this machine\n'
    return 0
  fi

  # From here the tree is clean and unblocked, so the remaining two findings are
  # both about commits. No commits means there is nothing to owe — an agent
  # still thinking about a hard first slice owes nobody anything, and saying it
  # does is what teaches an operator to ignore the word.
  monitor_has_commits; rc=$?
  [ "$rc" = 0 ] || return 0

  # THE HOST IS ASKED ONCE PER PASS, AND ONLY HERE. Every cheaper reading above
  # has already refused, so the five-minute budget buys exactly one round trip
  # about a branch that genuinely looks finished.
  local pr
  monitor_pr_state; pr=$?

  # 2b. UNASKABLE — no finding. The host could not be asked, so neither of the
  # two findings below can be distinguished from its opposite. Reporting `owes a
  # review` here would fire on every branch on the estate the moment `gh` lost
  # its token.
  [ "$pr" = 2 ] && return 0

  # 3. OWES A REVIEW — commits, a clean tree, no PR. The finding this plan was
  # written for: twice in one session, finished work sat on a branch with no PR
  # and nothing noticed.
  if [ "$pr" = 1 ]; then
    printf 'owes a review\tthe branch carries commits, the tree is clean and no PR exists; finished work is invisible\n'
    return 0
  fi

  # 4. OWES A GATE — a PR exists, so the work is visible, but a repo gate is
  # unmet and it would land red.
  local cs
  monitor_changeset; cs=$?
  if [ "$cs" = 1 ]; then
    printf 'owes a gate\tthe branch has a PR but adds no .changeset/*.md; it would land red on the changeset gate\n'
    return 0
  fi

  return 0
}

# One full pass: sample, publish only on a change.
monitor_pass() {
  local row finding evidence
  row=$(sample_finding)
  finding="${row%%	*}"
  evidence=''
  case "$row" in *"	"*) evidence="${row#*	}" ;; esac
  [ -z "$row" ] && finding=''

  # PUBLISH ONLY ON A CHANGE — the plan's "publishes on change". A monitor that
  # republished `owes a review` every five minutes would fill the findings file
  # with one fact repeated, and a subscriber could not tell a new debt from an
  # old one. `since` is what carries the age instead.
  #
  # The clearing case is a publish too: a debt that was paid is news, and a
  # board that never hears it leaves a stale entry up after the PR was opened.
  # That is the half of "does NOT fire once a PR exists" a subscriber can act
  # on — the finding stops standing AND the reader is told.
  if [ "$finding" != "$published" ]; then
    if [ -n "$finding" ]; then
      since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
      publish "$finding" "$evidence" "$since"
    elif [ -n "$published" ]; then
      since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
      publish 'clear' "the ${published} finding no longer holds; this desk owes nothing measurable" "$since"
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

# IT ENDS WITH ITS AGENT, for the reason and by the mechanism the WorkerMonitor
# does — `docs/research/2026-08-30-what-ends-a-monitor.md` has the measurement.
# Nothing ended either monitor before 2026-08-30: the wrapper `wait`s on the
# agent alone, so both children were re-parented to `init` and looped forever.
#
# PUBLISH FIRST, THEN LEAVE. The final pass below runs with the agent already
# gone, and on THIS monitor that pass is the one that matters most: an agent
# that exits having committed everything and opened nothing is precisely the
# failure the plan was written for, and the last pass is where it is caught.
# A monitor that died WITH its agent would miss it every time.
while plot_monitor_wait "$interval" "$pid_file"; do
  monitor_pass
done

monitor_pass
exit 0
