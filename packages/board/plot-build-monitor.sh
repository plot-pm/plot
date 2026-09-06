#!/usr/bin/env bash
# Plot helper: the BuildMonitor — watches the RUN, and what it concluded about a sha.
#
# RUN, NOT SOURCED, and started by `start_worker()` in `plot-dispatch.sh` as a
# child of the wrapper, beside the WorkerMonitor and the AgentMonitor.
#
# ═══════════════════════════════════════════════════════════════════════════
# THREE MONITORS, BECAUSE THERE ARE THREE SUBJECTS
# ═══════════════════════════════════════════════════════════════════════════
#
# Two monitors became three, and the reason is the one that split the first two:
# a different subject on a different cadence.
#
# | monitor           | subject     | samples                      | asks                       |
# |-------------------|-------------|------------------------------|----------------------------|
# | **WorkerMonitor** | the process | ~30 s                        | is it doing anything?      |
# | **AgentMonitor**  | the desk    | ~5 min                       | what does this agent owe?  |
# | **BuildMonitor**  | the run     | ~30 s **while a run is live**| did the build change?      |
#
# A Build is already an entity in the spec, with its own identity and its own
# state: DESIGN-build.md — *"is the thing that RUNS … one RESULT of one run"*,
# identified by its URL, holding a state, a start time and a duration. **A
# monitor per entity is the pattern, not an exception to it.**
#
# ═══════════════════════════════════════════════════════════════════════════
# FOUR FINDINGS, AND `head moved` IS THE ONE THAT EARNS THIS MONITOR
# ═══════════════════════════════════════════════════════════════════════════
#
# | finding                  | measurement                                        |
# |--------------------------|----------------------------------------------------|
# | **build failed**         | a run for this branch's head reached a failing conclusion |
# | **build passed**         | it reached success                                 |
# | **build needs approval** | it is `action_required`                            |
# | **head moved**           | a newer sha exists, so the run in flight answers about the past |
#
# **`head moved` is why this cannot live in the AgentMonitor.** A build's
# subject is a SHA, not a branch. A green result for code nobody will merge is
# worse than no result — it invites a merge of the wrong thing. Measured
# 2026-08-30: two merge waiters reported on superseded runs and had to be
# stopped and re-armed.
#
# **`action_required` is a real state here, not an edge case.** Bot branches hit
# it — the release PR's runs need manual approval before they start. A monitor
# that folded it into "not passed yet" would report a build as pending forever
# while it waits for a click nobody knows is needed.
#
# ═══════════════════════════════════════════════════════════════════════════
# IT POLLS NOTHING WHEN NO RUN IS LIVE
# ═══════════════════════════════════════════════════════════════════════════
#
# That is what makes a 30-second cadence against a host affordable, and it is
# the property that separates this monitor's budget from the AgentMonitor's.
# The AgentMonitor's five-minute budget exists because it asks ON EVERY PASS;
# this one asks only while there is something to ask about.
#
# STRUCTURALLY, NOT INCIDENTALLY: `monitor_head_sha` is a LOCAL git read and it
# gates the host call. `sample_finding` returns before `monitor_run_for_sha` is
# ever reached whenever there is no head to ask about, and once a sha has
# reached a terminal conclusion it is never asked about again. A monitor that
# kept questioning an idle host is the rate problem this whole design avoids,
# so the silence is asserted by the tests rather than assumed.
#
# ═══════════════════════════════════════════════════════════════════════════
# THE FINDINGS ARE TRANSITIONS, NOT CONDITIONS
# ═══════════════════════════════════════════════════════════════════════════
#
# The other monitors report states that PERSIST — `owes a review` holds until a
# PR exists, and republishing it would be repeating one fact. A build's answer
# CHANGES ONCE AND STAYS: a run that failed has failed, and it will still have
# failed in thirty seconds.
#
# So the state this monitor carries is keyed by SHA as well as by finding.
# Publishing `build passed` for one sha does not suppress `build passed` for the
# next one — that would silence the answer an operator is actually waiting for,
# on the very push they pushed to get it. And once a sha's build is terminal,
# the sha is not asked about again: the answer cannot change, so continuing to
# poll would be spending a host round trip to re-learn a fact already published.
#
# ═══════════════════════════════════════════════════════════════════════════
# IT OBSERVES; IT DOES NOT ACT
# ═══════════════════════════════════════════════════════════════════════════
#
# It does not rerun a workflow, approve a run that is `action_required`, merge a
# PR that went green, or push a fix for one that went red. Every one of those is
# a judgement with a blast radius. Approving a run in particular is a human's
# call by construction — `action_required` EXISTS because a person is meant to
# look — and a monitor that clicked it would defeat the gate it is reporting.
#
# PUBLISHING IS ITS ONLY OUTPUT, as next door: no state file, no cache, nothing
# written into the repository it watches, not even a record of what it last
# published. The variables that make "publish on change" work live in memory and
# die with the process, so a restarted monitor re-derives them one interval late
# rather than reading a stale one.
set -uo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: plot-build-monitor.sh [--once]

Started by plot-dispatch.sh inside the worker's wrapper. Reads its subject from
the environment, exactly as the wrapper's other children do:

  PLOT_BRANCH        the branch whose builds this monitor will report
  PLOT_WORKTREE      the desk it reads the head sha from
  PLOT_MONITOR_FILE  where findings are published (default:
                     $PLOT_WORKTREE/.plot-worker.monitor.build.jsonl)
  PLOT_MONITOR_INTERVAL  seconds between passes (default 30)

  --once   take one sample and exit, rather than looping. A test
           affordance: nothing dispatches this mode.
EOF
}

once=0
while [ $# -gt 0 ]; do
  case "$1" in
    --once) once=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "plot-build-monitor: unknown argument '$1'" >&2; usage; exit 2 ;;
  esac
  shift
done

monitor='BuildMonitor'

branch="${PLOT_BRANCH:-}"
worktree="${PLOT_WORKTREE:-}"
# THIRTY SECONDS IS AFFORDABLE ONLY BECAUSE OF THE SILENCE RULE. This cadence
# matches the WorkerMonitor's rather than the AgentMonitor's, and it asks a HOST
# — which would be the rate problem the AgentMonitor's 300 s exists to avoid,
# were it asking on every pass. It is not: no live run, no question. The budget
# is bounded by how long a build takes, not by how long a worker lives.
interval="${PLOT_MONITOR_INTERVAL:-30}"

findings="${PLOT_MONITOR_FILE:-${worktree:+$worktree/.plot-worker.monitor.build.jsonl}}"

# THE SUBJECT, read the same way the other two monitors read it.
pid_file="${PLOT_PID_FILE:-${worktree:+$worktree/.plot-worker.pid}}"

# ONE ANSWER TO "IS MY SUBJECT STILL THERE?", shared with both siblings, for the
# reason `plot-monitor-subject.sh` documents: three monitors deciding
# independently when to stop would drift, and the failure would be silent.
# shellcheck source=./plot-monitor-subject.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/plot-monitor-subject.sh"

# THE HOST ADAPTER, sourced for its path rather than its functions: the one
# operation this monitor asks is `plot-host.sh run-for-sha`, and `plot-host.sh`
# is the ONE place that talks to the host CLI. A monitor calling `gh` directly
# would be a second adapter, and the backend split (github/bitbucket) would have
# to be decided twice.
host_script="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/plot-host.sh"

json_escape() { # $1 = raw → prints a JSON-safe string body
  printf '%s' "$1" | python3 -c 'import json,sys; sys.stdout.write(json.dumps(sys.stdin.read())[1:-1])' 2>/dev/null \
    || printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

# A FINDING CARRIES THE SAME FOUR FIELDS the other two monitors publish —
# `finding`, `since`, `evidence`, `measuredAt` — for the same reason: one
# subscriber will read all three files and must not need a third parser to do
# it.
#
# `since` HERE IS WHEN THE BUILD REACHED THIS ANSWER, as far as this monitor
# can tell — the pass that first saw it. On a 30 s cadence the gap to
# `measuredAt` is small by construction, which is the opposite of the
# AgentMonitor's case and follows from the same field meaning the same thing.
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
  # Both destinations, for the reason the siblings give: the file is what a
  # subscriber reads, and stdout lands in `.plot-worker.log` beside the agent's
  # own output where an operator tailing a worker sees it.
  [ -n "$findings" ] && printf '%s\n' "$line" >> "$findings" 2>/dev/null
  printf 'plot-monitor %s\n' "$line"
}

# ---------------------------------------------------------------------------
# THE PORTS — two named seams, so every branch is reachable from a test
# ---------------------------------------------------------------------------
#
# Same convention as the four next door and the five beyond it: a test sources
# this file with `PLOT_MONITOR_NO_MAIN=1` and REDEFINES them. Here there are
# only two, and one of them is the host round trip — which is exactly the seam a
# test can least afford to drive for real. You cannot ask GitHub for a run that
# is `action_required` on demand, you cannot make a run vanish to order, and you
# certainly cannot arrange two runs for two shas at the instant a test needs
# them. Every one of those is a branch this monitor must get right.

# What sha is this branch's head, right now?
#
# → prints the sha, or nothing when it cannot be read
#
# LOCAL, AND IT GATES THE HOST CALL. This is the cheap reading that makes the
# silence rule structural: no head, no question. It reads the WORKTREE's HEAD
# rather than a remote ref, because the head a build should be about is the one
# the agent has actually produced — and because a fetch per pass would be a
# second network call on a 30-second loop.
monitor_head_sha() { # → prints a sha, or nothing
  [ -n "$worktree" ] && [ -d "$worktree" ] || return 0
  git -C "$worktree" rev-parse --verify --quiet HEAD 2>/dev/null || true
}

# What does the host say about the run for ONE sha?
#
# → prints the run JSON, or nothing when there is no run for it
# → returns 2 when the host could not be asked at all
#
# THE DISTINCTION BETWEEN "NO RUN" AND "COULD NOT ASK" IS THE POINT, and it is
# the same discipline `monitor_pr_state` keeps next door. An unreachable host is
# NOT evidence that a build is absent. A monitor that read a `gh` failure as "no
# run" would go silent about every build on the estate the moment a token
# expired — and silence is this monitor's healthy signal, so the failure would
# be invisible by construction.
#
# An EMPTY result with a reachable host is a real and common answer: the run has
# not been created yet. A monitor polling a fresh push sees exactly this until
# CI wakes up, and it is not a finding.
monitor_run_for_sha() { # $1 = sha → prints run JSON | rc 2 = unaskable
  [ -n "$branch" ] || return 2
  [ -x "$host_script" ] || return 2
  local out
  out=$("$host_script" run-for-sha "$branch" "$1" 2>/dev/null) || return 2
  printf '%s' "$out"
  return 0
}

# ---------------------------------------------------------------------------
# READING ONE FIELD OUT OF THE RUN
# ---------------------------------------------------------------------------
#
# `jq` where it exists and `sed` where it does not, the same fallback shape
# `json_escape` uses above. A monitor that died because `jq` was missing would
# be a monitor that reported nothing on exactly the machines least likely to
# have anyone watching.
run_field() { # $1 = json, $2 = key → prints the value, or nothing for null
  local v
  if command -v jq >/dev/null 2>&1; then
    v=$(printf '%s' "$1" | jq -r --arg k "$2" '.[$k] // empty' 2>/dev/null)
  else
    v=$(printf '%s' "$1" | sed -n 's/.*"'"$2"'":"\([^"]*\)".*/\1/p')
  fi
  printf '%s' "$v"
}

# ---------------------------------------------------------------------------
# THE SAMPLER — one pass, using only the ports above
# ---------------------------------------------------------------------------
#
# THE STATE IS TWO VARIABLES AND IT IS DERIVED, as next door — but `published`
# is keyed by SHA here, because the findings are transitions rather than
# conditions. `published_sha` records which commit the standing answer is about,
# so the same word about a different commit is still news.
published=''
published_sha=''
since=''
# The shas whose builds have reached a terminal answer. Once a run has failed,
# passed, or been superseded, asking again spends a host round trip to re-learn
# a fact already published — so it is not asked. THIS is the second half of "it
# polls nothing when no run is live": the first half is having no head at all,
# and this is having no OPEN question about the head there is.
settled_shas=''

sha_is_settled() { # $1 = sha → 0 settled | 1 not
  case " $settled_shas " in *" $1 "*) return 0 ;; esac
  return 1
}

# ---------------------------------------------------------------------------
# ONE FINDING PER PASS, AND `head moved` COMES FIRST
# ---------------------------------------------------------------------------
#
# Unlike the AgentMonitor's four, these are near-exclusive by construction — a
# run has one status. The one genuine overlap is the one that matters: a run
# that concluded `success` for a sha the branch has since moved past is BOTH
# "passed" and "superseded", and reporting it as passed is precisely the failure
# this monitor exists to prevent.
#
# So `head moved` is decided FIRST and about the run's own sha, not about the
# branch: if the answer in hand describes a commit that is no longer the head,
# the answer is about the past whatever it says.
sample_finding() { # → prints "finding\tevidence", or nothing
  local head
  head=$(monitor_head_sha)

  # NO HEAD, NO QUESTION. The cheap local reading refuses before anything
  # reaches the host — the structural form of "it polls nothing when no run is
  # live". A worktree that is gone, or a branch with no commit yet, asks
  # nothing at all.
  [ -n "$head" ] || return 0

  # ALREADY ANSWERED. The head's build reached a terminal conclusion on an
  # earlier pass and a build's answer does not change back. Asking again would
  # be the idle polling this design refuses.
  sha_is_settled "$head" && return 0

  local run rc
  run=$(monitor_run_for_sha "$head"); rc=$?

  # UNASKABLE — no finding. The host could not be asked, so nothing about the
  # build is known. Reporting anything here would be inventing an answer out of
  # a failure to observe.
  [ "$rc" = 2 ] && return 0

  # NO RUN YET — no finding, and not an error. The commit exists and CI has not
  # created a run for it. This is the ordinary state of a freshly pushed sha,
  # and it is what the monitor sees on every pass until the run appears.
  [ -n "$run" ] || return 0

  local run_sha status conclusion url
  run_sha=$(run_field "$run" sha)
  status=$(run_field "$run" status)
  conclusion=$(run_field "$run" conclusion)
  url=$(run_field "$run" url)

  # 1. HEAD MOVED — the run in hand is about a commit that is no longer the
  # head. Decided BEFORE the conclusion is read, because a green run for
  # superseded code is the specific wrong answer this monitor was built to
  # avoid: it invites a merge of the wrong thing. Measured 2026-08-30 — two
  # merge waiters reported on superseded runs and had to be stopped and
  # re-armed.
  #
  # This fires when the host answered about a DIFFERENT sha than the one asked
  # about, which is the shape a race actually takes: the head moved between the
  # local read and the host's reply.
  if [ -n "$run_sha" ] && [ "$run_sha" != "$head" ]; then
    printf 'head moved\tthe run at %s is for %s, but the branch head is now %s; its answer is about the past\n' \
      "${url:-an unknown url}" "$run_sha" "$head"
    return 0
  fi

  # 2. BUILD NEEDS APPROVAL — a real state, not an edge case. Bot branches hit
  # it: the release PR's runs need a manual click before they start. GitHub
  # reports it as a `status` of `waiting`/`action_required` and as a
  # `conclusion` of `action_required`, depending on where the run is, so both
  # are read. Folding it into "not passed yet" would report the build pending
  # forever while it waits for a click nobody knows is needed.
  case "$status:$conclusion" in
    *action_required*|waiting:*)
      printf 'build needs approval\tthe run at %s for %s is waiting for a manual approval before it can start\n' \
        "${url:-an unknown url}" "$head"
      return 0
      ;;
  esac

  # 3 & 4. THE TERMINAL CONCLUSIONS. An empty conclusion means the run is still
  # going — queued or in progress — and a monitor whose subject is a transition
  # says nothing about a state that has not changed yet.
  [ -n "$conclusion" ] || return 0

  case "$conclusion" in
    success)
      printf 'build passed\tthe run at %s for %s concluded success\n' "${url:-an unknown url}" "$head"
      return 0
      ;;
    # EVERY OTHER TERMINAL CONCLUSION IS A FAILURE TO A READER WAITING ON GREEN.
    # `failure`, `timed_out`, `cancelled` and `startup_failure` differ in cause
    # and not in consequence: none of them is a build somebody may merge on. The
    # cause is not thrown away — it rides in the evidence, where a reader
    # deciding whether to rerun can see it.
    *)
      printf 'build failed\tthe run at %s for %s concluded %s\n' "${url:-an unknown url}" "$head" "$conclusion"
      return 0
      ;;
  esac
}

# One full pass: sample, publish only on a change of ANSWER-ABOUT-A-COMMIT.
monitor_pass() {
  local row finding evidence head
  head=$(monitor_head_sha)
  row=$(sample_finding)
  finding="${row%%	*}"
  evidence=''
  case "$row" in *"	"*) evidence="${row#*	}" ;; esac
  [ -z "$row" ] && finding=''

  # PUBLISH ON A CHANGE OF EITHER THE FINDING OR THE COMMIT IT IS ABOUT. The
  # second half is what makes these transitions rather than conditions: `build
  # passed` for a new sha is news even though the word is the same as last
  # time, and suppressing it would silence exactly the answer an operator
  # pushed in order to get.
  if [ "$finding" != "$published" ] || { [ -n "$finding" ] && [ "$head" != "$published_sha" ]; }; then
    if [ -n "$finding" ]; then
      since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
      publish "$finding" "$evidence" "$since"
      # SETTLED, so it is never asked about again. Every finding this monitor
      # publishes is terminal for its sha: a failure stays failed, a pass stays
      # passed, and a superseded run does not become current. Recording it here
      # rather than in `sample_finding` keeps the decision beside the publish it
      # follows from.
      [ -n "$head" ] && settled_shas="$settled_shas $head"
    fi
    # NO CLEARING PUBLISH, and that is the difference from the AgentMonitor. A
    # debt is cleared when it is paid — that is news. A build's answer is never
    # withdrawn: `build failed` does not stop being true about that sha, and the
    # next answer is a new finding about a new commit, which the sha key already
    # carries. Publishing `clear` here would tell a subscriber a failure had
    # been resolved when all that happened is the branch moved on.
    published="$finding"
    published_sha="$head"
  fi
}

# SOURCEABLE FOR TESTS, the same guard the siblings carry. A test that wants to
# drive `monitor_pass` against redefined ports needs the functions without the
# loop; everything above this line defines, and nothing below it runs when the
# guard is set.
[ -n "${PLOT_MONITOR_NO_MAIN:-}" ] && return 0 2>/dev/null

monitor_pass
[ "$once" = 1 ] && exit 0

# IT ENDS WITH ITS AGENT, by the mechanism `plot-monitor-subject.sh` documents
# and for the reason `docs/research/2026-08-30-what-ends-a-monitor.md` measured.
#
# PUBLISH FIRST, THEN LEAVE. The final pass runs with the agent already gone,
# and it matters here for a reason of its own: an agent that pushes and exits
# leaves a run still going, and the answer arrives after there is nobody left to
# see it. The last pass is the one chance to catch a build that concluded during
# the shutdown.
while plot_monitor_wait "$interval" "$pid_file"; do
  monitor_pass
done

monitor_pass
exit 0
