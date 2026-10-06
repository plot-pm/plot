#!/usr/bin/env bash
# Plot helper: worker loop — implements then asks for the next wave.
# Usage: plot-worker-loop.sh
# Environment: PLOT_BRANCH, PLOT_WORKTREE, PLOT_SLUG, PLOT_MANIFEST_FILE,
#              PLOT_SESSION_ID (from dispatcher; re-exported per prompt as the
#              manifest's resume handle), PLOT_SESSION_FLAG (this loop's)
#
# This is the looping shell the Worker command calls. After each branch
# completes, it asks `--next` for another claimable branch OF THE SAME PLAN,
# takes its desk over for that branch, claims it, and loops. Exit 1 from
# `--next` is "nothing to start" and breaks the loop cleanly.
#
# ONE DESK PER AGENT, NOT ONE PER SLICE. The loop used to `git worktree add` on
# every hop and leave the previous checkout on disk; measured 2026-09-02, that
# gave 2 manifests 11 worktrees. The agent now decides create-or-reset from its
# own tree — the only place a `PLOT-BLOCKED` marker, an uncommitted change or an
# unpushed commit can be seen — and creates a desk only where its own holds
# something nobody has accounted for. `git worktree add` is the exception.
#
# THE PROMPT is read from `.plot/worker-prompt.sh` in the repo root. That file
# contains the literal `claude -p "..."` invocation the loop runs each
# iteration. Keeping it in a file rather than a Plot Config key avoids the
# parser stripping `$(...)` constructs, and lets the prompt be as long as
# needed without making CLAUDE.md unreadable.
#
# THAT FILE BELONGS TO THE ADOPTING PROJECT, and Plot's contract with it is two
# environment variables. The dispatcher mints a session id; this loop decides
# which FLAG that id must carry and exports the pair:
#
#     claude -p "..." "$PLOT_SESSION_FLAG" "$PLOT_SESSION_ID" --permission-mode ...
#
# Pass them and the runtime writes its transcript under the id the manifest
# records, which is what lets the board join an agent's row to its transcript
# and lets a correction be resumed into the SAME conversation. Omit them — or
# run a harness that writes no transcript — and resume reports itself
# UNAVAILABLE and a fresh worker is started instead. Nothing here requires the
# flags: Plot does not own this file, and the transcript's presence is the gate
# rather than any promise made about the invocation.
#
# THE FLAG IS THE LOOP'S DECISION AND NOT THE PROMPT'S, since 2026-09-05. The
# prompt file passed `--session-id` on every invocation and `PLOT_SESSION_ID`
# never changes across a hop, so an agent handed a SECOND slice asked the
# runtime to create a session it already held: `Session ID … is already in use`,
# measured on three agents at once, each exiting in under a second and returning
# to its wait. The rule lived in the one file every project rewrites for itself,
# which is the file that got it wrong — so the loop probes the transcript, emits
# `--session-id` or `--resume`, and the prompt interpolates a finished flag
# without knowing the rule. See `session_flag` below.
#
# THE CLAIM is the same ref push dispatch uses: an empty commit titled
# `plot: claim <branch>`, which diverges from any other claim attempt so only
# one push succeeds. A REJECTED push is a registry-lock violation rather than a
# race lost: the registry is the assignment lock and this push is its backstop,
# so a rejection means two agents were handed one branch. The loop says so
# loudly and asks `--next` again; it removes no desk, because on the reset path
# the desk is the one the agent is standing in.
#
# A worker that hops takes NO NEW SLOT: the cap counts sessions, and a hopping
# worker is one session continuing, not a second one spawning. This is why the
# cap can be enforced without stalling the fleet — at the cap, work continues
# through the workers already running.
#
# THE MANIFEST IS UPDATED ON EACH HOP. When a worker moves to a new branch,
# the manifest's `branch` and `worktree` fields are written and `wavesCount` is
# incremented. This keeps the registry accurate: a reader sees where the worker
# IS, not where it started. The `session` and `pid` stay fixed — it is the same
# worker. `worktree` is written on both paths even though a reset does not move
# it, so the call's contract stays *the manifest names where the agent is* and
# the caller needs no knowledge of which path it took.
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$script_dir/plot-tmp.sh"
repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || repo_root="."

cfg() { "$script_dir/plot-config.sh" get "$1" "${2:-}"; }

# THE LAUNCHER. `js` `exec`s the bundle beside this script and never falls
# back to the body below — a silent fallback is how a fleet runs the wrong
# loop for a week. No bundle on `js` is a loud exit 2, never a start of `node`
# on the `shell` path, which is the default and runs no Node at all.
if [ "$(cfg "Worker loop" shell)" = "js" ]; then bundle="$script_dir/board/plot-worker-loop.mjs"
  [ -f "$bundle" ] || { echo "plot-worker-loop: Worker loop is js and $bundle is missing — the-shell-shrinks-into-the-domain" >&2; exit 2; }; rm -f "$PLOT_TMP_REGISTRY"; exec node "$bundle"; fi

# THE TRANSCRIPT READER. Until `bug/the-loop-reports-idle` this was sourced for
# the ENDING MESSAGE alone, asked once after a signal had already fired:
# *could the reading have been made at all?* The watcher below now reads it on
# every pass too, through `plot_worker_idle_watch_pass` in
# `plot-worker-state.sh` — the SAME file, so the loop's watcher and the loop's
# own message report what the same reader saw rather than two opinions.
#
# ITS ABSENCE IS ITS OWN ANSWER. `[ -r ]` guards the source because a missing
# reader is exactly the `unavailable` case: an adopting project whose checkout
# predates wave 2 reads as *nobody could tell*, which is true.
# shellcheck source=plot-transcript-quiet.sh
[ -r "$script_dir/plot-transcript-quiet.sh" ] && . "$script_dir/plot-transcript-quiet.sh"

# THE FLOOR UNDER A SINGLE PROMPT RUN, in seconds — and a FLOOR is all it is
# as of 2026-08-30. A worker whose agent process hangs — the `Error: No messages
# returned` rejection inside the CLI, which leaves the process alive but never
# returning — otherwise holds the loop forever: 11 such workers were measured on
# 2026-08-25, one for 10 hours.
#
# IT STOPPED BEING THE VERDICT. `a-working-agent-is-not-a-hung-one` measured the
# cost of asking a clock: on 2026-08-30 seven workers exited 124 and every one
# had 3-6 commits. Not one was hung. Wall-clock time measures how long, never
# whether anything happened, so the verdict moved to the WorkerMonitor's `idle`
# finding (`monitor_watch` below) and this timer became the last resort behind
# it.
#
# THE DEFAULT IS 8 HOURS, AND THE UNIT CHANGED WITH THE JOB. At 3600 it was
# sized against honest run lengths (9-29 min, #414/#417/#419/#416) because it
# was deciding every worker's fate. It no longer decides any healthy worker's:
# the monitor ends a stall in two ~30s intervals, so the floor fires ONLY when
# the monitor itself has died — which `two-monitors-watch-the-agent` records as
# real, with one unexplained termination path and a leak that ran 152 orphans on
# this machine.
#
# So the value is sized against THAT failure instead: long enough that no honest
# agent reaches it (the longest hang ever measured here was 10 h, and honest
# runs are two orders of magnitude shorter), short enough that a monitor-less
# hang cannot burn a night unnoticed. A working day is the operator's own review
# cadence — a worker started in the morning is answered for by evening — and it
# is the value the plan asks for in as many words.
#
# A NON-NUMERIC OR EMPTY VALUE FALLS BACK to the default rather than becoming a
# `sleep` argument that errors — the same guard `plot-fleet-scan.sh` applies to
# `Claim stale after`. `0` is preserved as written: a project that sets the
# bound to 0 has explicitly disabled the FLOOR, and the run below treats
# non-positive as "no bound". It does not disable the monitor reading: that
# escape was for wall-clock kills, and reading a finding is not one.
WORKER_BOUND_SECONDS=$(cfg "Worker bound" "28800")
case "$WORKER_BOUND_SECONDS" in (*[!0-9]*|'') WORKER_BOUND_SECONDS=28800 ;; esac

# HOW OFTEN THE WATCHER TAKES A READING, in seconds. Until
# `bug/the-loop-reports-idle` this was `PLOT_MONITOR_POLL_SECONDS` (5s),
# because the loop was re-reading a file a SEPARATE process published to on its
# own 30s cadence. There is no separate process any more: the watcher below
# takes the six readings itself, so its own cadence IS the monitor's, and the
# two variables collapsed into the one the WorkerMonitor always used.
#
# ENV, NOT PLOT CONFIG. This is a test seam and an implementation detail of the
# reading, not a project's declared policy — `Worker bound` is the knob a
# project sets (Principle 5), and adding a second one for the cadence would ask
# operators to tune something they cannot observe.
MONITOR_INTERVAL_SECONDS="${PLOT_MONITOR_INTERVAL:-30}"
case "$MONITOR_INTERVAL_SECONDS" in (*[!0-9]*|''|0) MONITOR_INTERVAL_SECONDS=30 ;; esac

# HOW LONG A TRANSCRIPT OR A TREE MUST BE QUIET BEFORE `idle` CAN HOLD, in
# seconds — the window `plot_worker_idle_now` is asked against. Moved here from
# the WorkerMonitor along with the reading itself; the number and its reasoning
# are unchanged; see `plot_worker_idle_now` in `plot-worker-state.sh` and the
# measurement behind it in this file's own history.
MONITOR_QUIET_SECONDS="${PLOT_MONITOR_QUIET_SECONDS:-900}"
case "$MONITOR_QUIET_SECONDS" in (*[!0-9]*|'') MONITOR_QUIET_SECONDS=900 ;; esac

# WHETHER AN `idle` READING MAY END A WORKER. Default 1, which is today's
# behaviour; `PLOT_MONITOR_ENDS_WORKER=0` leaves the finding published and
# ending the worker to `Worker bound` alone.
#
# THE FLAG NOW GATES ONE THING, AND ONE THING ONLY: the `kill -USR1` to this
# loop. Until `bug/the-loop-reports-idle` the flag also gated whether the
# watcher subshell STARTED at all — `0` meant no watcher, which silently
# stopped `idle` from being published, contradicting this very comment's
# promise that `0` "leaves the finding published". That was safe only while a
# SEPARATE WorkerMonitor process existed to publish regardless of what this
# loop did; now the watcher below is the ONLY publisher of `idle`, so it must
# run whatever this flag says, or `0` stops the finding from existing at all
# rather than merely from ending the worker.
#
# So the watcher always starts. What `0` buys is unchanged in kind — an
# operator who wants `Worker bound` alone, rather than the transcript reading,
# can still have it — but it no longer costs the finding itself.
#
# THE READING ITSELF IS UNCHANGED FROM THE WorkerMonitor's. It reads the
# agent's TRANSCRIPT and asks the CPU only whether a child is on a core
# (`plot_worker_idle_now` in `plot-worker-state.sh`), for the reason recorded
# there: an agent waiting on a model response burns no CPU in its subtree, so a
# CPU sample alone could not tell `stuck` from `thinking`. Measured 2026-09-01
# on this estate, under the OLD CPU-only rule: seven desks carried `reported
# idle on` in their logs, every one of them holding real commits, and five had
# to be finished by hand.
MONITOR_ENDS_WORKER="${PLOT_MONITOR_ENDS_WORKER:-1}"
case "$MONITOR_ENDS_WORKER" in (0|1) ;; (*) MONITOR_ENDS_WORKER=1 ;; esac

# HOW LONG A FREE AGENT WAITS BETWEEN ASKS, in seconds. The wait is a POLL of
# `--next`, and the interval is what the poll costs.
#
# A POLL IS THE HONEST SHAPE WHILE NOTHING CAN PUSH. An agent with no work
# should be handed the next brief by the registry, and
# `feature/the-registry-supervises-its-agents` is the branch that will do the
# handing — it is startable and unbuilt. Until it exists there is no channel to
# block on, and a stand-in for it (a fifo, a lock file, a socket) would be a
# second registry that the real one then has to displace. So the agent asks,
# and the ask is `--next` — the same question dispatch puts, answered by the
# same scan, with no new protocol between them.
#
# 60s BECAUSE THE THING BEING WAITED FOR IS A MERGE. A `not-yet` clears when a
# branch ahead of this one lands on the host, which is a human-scale event
# (review, CI, a merge click) measured in minutes here, never in seconds. The
# scan itself costs 12.7 s of git against `origin` even offline, so a 5 s poll
# would spend most of a minute asking about a world that had not moved.
WAIT_POLL_SECONDS="${PLOT_WAIT_POLL_SECONDS:-60}"
case "$WAIT_POLL_SECONDS" in (*[!0-9]*|''|0) WAIT_POLL_SECONDS=60 ;; esac

# HOW LONG A FREE AGENT MAY WAIT AT ALL, in seconds — `Worker bound`, the same
# clock that bounds a prompt, deliberately reused rather than given a key of its
# own.
#
# THE WAIT MUST BE BOUNDED BY SOMETHING A PERSON CAN SEE. An agent waiting on a
# channel nothing can reach is a stalled agent, and the difference between the
# two is whether anybody knows how long it will be there. `Worker bound` is
# already the answer this project gives to *how long may one of my agents hold a
# machine slot* — it is declared in CLAUDE.md, read by the operator, and
# defaulted to a working day, which is the operator's own review cadence. A
# second key would ask them to tune a number they have no separate opinion
# about.
#
# `Worker bound: 0` DISABLES THIS TOO, and that follows from what the key means
# rather than from convenience: a project that removed the wall-clock kill asked
# for agents whose lifetime it manages itself, which is the same request. The
# monitor is untouched either way — it reads a finding, and a waiting agent runs
# no prompt for it to have a finding about.
#
# THE ENV OVERRIDE IS A TEST SEAM, and it is one for the reason
# `PLOT_MONITOR_INTERVAL` is: a test that wants to watch a worker reach the
# END of its wait would otherwise have to lower `Worker bound`, which bounds the
# PROMPT too — so it would be asking about the wait and measuring the prompt.
# The loop's own tests set it to end a one-pass run that has nothing to hop to,
# which is every fixture in `workerloop.test.mjs`.
#
# NOT A PLOT CONFIG KEY, for the reason recorded at `MONITOR_INTERVAL_SECONDS`:
# a project's declared policy about how long its agents may live is
# `Worker bound`, and a second key would ask an operator to tune a number they
# have no separate opinion about.
WAIT_BUDGET_SECONDS="${PLOT_WAIT_BUDGET_SECONDS:-$WORKER_BOUND_SECONDS}"
case "$WAIT_BUDGET_SECONDS" in (*[!0-9]*|'') WAIT_BUDGET_SECONDS="$WORKER_BOUND_SECONDS" ;; esac

# ---------------------------------------------------------------------------
# HOW MANY TIMES A FAILING BUILD IS HANDED BACK — `Correction budget`
# ---------------------------------------------------------------------------
#
# A CORRECTION IS A RETRY, SO IT NEEDS A FLOOR. The BuildMonitor publishes
# `build failed` and the loop hands it to the agent that caused it; without a
# bound an agent whose build fails for a reason it cannot fix — a broken runner,
# a gate it has no permission over — is corrected for the whole of
# `Worker bound`, which is the spin `START_ATTEMPT_BUDGET` exists to stop one
# floor above.
#
# THE DEFAULT IS TWO AND IT IS A GUESS. Nothing has measured it. Two says *try
# once more, then ask*, which is the smallest number that is not zero-or-once;
# the first real number comes from watching the fleet correct real builds.
# Recording the guess AS a guess is what stops it hardening into a decision
# nobody made — so this paragraph is the record, and the CLAUDE.md key carries
# the same sentence.
#
# IT IS A PLOT CONFIG KEY, AND `START_ATTEMPT_BUDGET` DELIBERATELY IS NOT. That
# budget's own comment states the split: a project has no separate opinion about
# how many times a BROKEN INVOCATION should be retried before a person is asked,
# because a prompt that cannot run is Plot's problem in every project. A project
# does have an opinion about how many times ITS failing build is handed back —
# a repo whose CI is flaky wants more, one whose gates are deterministic wants
# one. Two budgets, two defaults, two mechanisms; collapsing them would
# contradict a comment already in this file.
#
# THE ENV OVERRIDE IS A TEST SEAM ON TOP OF THE KEY, not instead of it: a test
# proving the budget ENDS in a marker would otherwise have to write a CLAUDE.md.
CORRECTION_BUDGET="${PLOT_CORRECTION_BUDGET:-$(cfg "Correction budget" "2")}"
case "$CORRECTION_BUDGET" in (*[!0-9]*|'') CORRECTION_BUDGET=2 ;; esac

# HOW LONG AN AGENT KEEPS ITS SLICE WAITING FOR ITS PR'S CHECKS, in seconds.
# The correction path below reads a failed build only while the agent holds the
# slice, and CI reports minutes after the push, so an agent that let go when
# its prompt ended never received a failure. `0` disables the wait. The poll is
# the BuildMonitor's own cadence doubled: the monitor asks the host, and this
# only reads the file it writes.
CHECKS_WAIT_SECONDS="${PLOT_CHECKS_WAIT_SECONDS:-$(cfg "Checks wait" "1800")}"
case "$CHECKS_WAIT_SECONDS" in (*[!0-9]*|'') CHECKS_WAIT_SECONDS=1800 ;; esac
CHECKS_POLL_SECONDS="${PLOT_CHECKS_POLL_SECONDS:-60}"
case "$CHECKS_POLL_SECONDS" in (*[!0-9]*|''|0) CHECKS_POLL_SECONDS=60 ;; esac

# Update the manifest when the worker hops to a new branch.
#
# The manifest already carries `session`, `pid`, `startedAt` — these stay fixed.
# This function updates `branch`, `worktree` and `resumeId`, and increments
# `wavesCount`.
#
# `resumeId` IS THE HANDLE THE NEXT PROMPT CONTINUES, and a new branch gets a
# new one. One conversation per SLICE: a hop to a different branch mints a
# fresh id with `plot_session_id`, so the first prompt on the new slice runs
# `--session-id` and loads nothing. A hop that lands on the same branch keeps
# the handle and resumes. `session` is not touched: it is the manifest's
# filename and the agent's name, and the board joins the transcript on
# `resumeId` instead (`packages/board/src/server/registry.ts`).
#
# THE PREVIOUS BRANCH IS AN ARGUMENT, NOT THE MANIFEST'S `branch`. By the time
# this runs, `clear_manifest_branch` has blanked the field and the registry has
# written the NEW branch into it, so the manifest names `$2` on every hop. The
# branch the agent is leaving survives only in the caller's `$PLOT_BRANCH`. An
# empty previous branch is an agent that held no slice yet, and it keeps its
# launch handle.
#
# `attempts` STAYS FIXED, by being untouched: the node one-liner round-trips
# the whole object, so every field this function does not name survives
# verbatim. `correctionAttempts` is named: it resets whenever the previous branch
# differs from the new one, empty included — the counter belongs to the branch.
#
# WHY THE MANIFEST UPDATE IS NECESSARY. The registry synthesizes from manifests.
# A worker that moved branches without updating the manifest would still appear
# on its starting branch — the thing this whole wave exists to fix. The update
# is made HERE rather than in dispatch because dispatch starts workers; this
# script is the one that moves them.
#
# USES NODE because JSON manipulation in portable shell is brittle (BSD sed
# interprets escape sequences differently, awk quoting varies), and node is
# guaranteed present — the Worker command itself requires it. The one-liner
# reads, updates, and writes atomically through a temp file.
update_manifest_on_hop() { # $1=manifest $2=new_branch $3=new_worktree $4=resume_id $5=previous_branch
  local manifest="$1" new_branch="$2" new_worktree="$3" resume_id="${4:-}" previous_branch="${5:-}"
  [ -f "$manifest" ] || return 0

  if [ -n "$previous_branch" ] && [ "$previous_branch" != "$new_branch" ]; then
    resume_id=$(plot_session_id) || resume_id=""
  fi

  local tmp="$manifest.plot-hop-tmp"
  # AN EMPTY HANDLE LEAVES THE FIELD ALONE rather than blanking it. A loop with
  # no session id has nothing to write, and an empty `resumeId` is the value
  # `resumeAvailability` reads as *no conversation to continue* — writing one
  # over a handle that was correct would be a claim the hop cannot make.
  node -e '
    const fs = require("fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    manifest.branch = process.argv[2];
    manifest.worktree = process.argv[3];
    if (process.argv[5] !== "") manifest.resumeId = process.argv[5];
    manifest.wavesCount = (manifest.wavesCount || 1) + 1; if (process.argv[6] !== process.argv[2]) manifest.correctionAttempts = 0;
    fs.writeFileSync(process.argv[4], JSON.stringify(manifest, null, 2) + "\n");
  ' "$manifest" "$new_branch" "$new_worktree" "$tmp" "$resume_id" "$previous_branch" 2>/dev/null || { rm -f "$tmp"; return 1; }

  mv -f "$tmp" "$manifest" 2>/dev/null || { rm -f "$tmp"; return 1; }
}

# `clear_manifest_branch` — the ONE writer that clears a manifest's `branch`,
# so the window before the next slice is observable. SOURCED from
# `plot-agent-manifest.sh` rather than defined here, because
# `plot-dispatch.sh --release` clears the same field for an abandoned slice and
# two writers of one field drift. The body and its argument are unchanged.
# The same file defines `manifest_resume_id` and `session_handle`, which the
# worker monitor reads too.
# shellcheck source=plot-agent-manifest.sh
. "$script_dir/plot-agent-manifest.sh"

# ---------------------------------------------------------------------------
# THE RETRY BUDGET — `attempts`, and why the loop writes it
# ---------------------------------------------------------------------------
#
# A PROMPT THAT NEVER RAN KEEPS ITS SLICE, so without a bound the agent spins:
# the manifest still names a branch, the prompt fails in under a second, and
# that repeats for the whole of `Worker bound: 28800`. The budget is what turns
# an infinite retry into a bounded one and then into a person's problem.
#
# `attempts` IS THE FIELD, AND USING IT WIDENS IT DELIBERATELY. `registry.ts`
# documented it as a SUPERVISOR's counter and said nothing in Plot raised it.
# The loop is not a supervisor — but the line the field draws is AUTOMATIC
# versus A PERSON'S, `relaunches` being the human record, and a loop retry is
# automatic by every property that distinction was made for: it spends no
# human patience, and counting it against `relaunches` would let a self-retry
# exhaust an operator's record. The docstring is updated in the same change
# rather than left saying supervisor-only while this writes it.
#
# THE DEFAULT IS THREE, and it is a count of INVOCATIONS rather than of
# seconds. A refusal costs a sub-second exit, so a wall-clock bound would allow
# thousands; three is enough for a transient runtime failure to clear and small
# enough that a permanent one reaches a person in under a minute.
#
# THE ENV OVERRIDE IS A TEST SEAM, the same one `PLOT_WAIT_BUDGET_SECONDS` is
# and for the same reason: a test proving the budget ENDS the worker would
# otherwise have to spend three real prompt runs to observe one `if`. Not a
# Plot Config key — a project has no separate opinion about how many times a
# broken invocation should be retried before a person is asked.
START_ATTEMPT_BUDGET="${PLOT_START_ATTEMPT_BUDGET:-3}"
case "$START_ATTEMPT_BUDGET" in (*[!0-9]*|'') START_ATTEMPT_BUDGET=3 ;; esac

# How many times this agent has already been retried automatically.
#
# ABSENT, UNREADABLE AND NON-NUMERIC ALL READ ZERO, which is the permissive
# direction on purpose: the budget's job is to stop a spin, and a manifest that
# cannot be read is not evidence that one is under way. The worker still ends
# after `START_ATTEMPT_BUDGET` failures, because the counter it cannot read it
# also cannot raise.
manifest_attempts() { # $1=manifest → prints a count
  manifest_count "$1" attempts
}

# Record one more automatic retry of this agent.
#
# IT RAISES `attempts` AND TOUCHES NOTHING ELSE — in particular not `branch`,
# because the slice must stay claimed across a failed start: nothing else should
# take a slice this agent still holds a desk for. `clear_manifest_branch` is the
# opposite write and it is deliberately not reached on this path.
#
# ABSENT IS NOT A FAILURE, the shape `clear_manifest_branch` already takes: a
# hand-started loop has no manifest, so there is nothing to raise and nothing to
# report.
raise_manifest_attempts() { # $1=manifest
  raise_manifest_count "$1" attempts
}

# ---------------------------------------------------------------------------
# THE CORRECTION COUNTER — `correctionAttempts`, and why it is not `attempts`
# ---------------------------------------------------------------------------
#
# ITS OWN FIELD, DECIDED RATHER THAN INHERITED. `attempts` already answers two
# questions: the supervisor's budget reads it (`rules/supervision.ts:203`) and
# the start budget above writes it. A third reader would make one number answer
# *how many times did the prompt fail to run*, *how many times did the
# supervisor retry this desk*, and *how many times was this build handed back* —
# three different questions about one agent, and a reader would have to
# re-derive the split from the number.
#
# THE COLLISION IS CONCRETE, not a tidiness argument. The two budgets differ in
# default (three against two) and in configurability (an env seam against a Plot
# Config key), so a shared counter would let a spent START budget pre-consume the
# CORRECTION budget: an agent whose prompt failed twice and then ran would arrive
# at its first failing build with no corrections left, and the marker would name
# a build failure for attempts spent on a broken invocation.
#
# IT IS STILL THE AUTOMATIC SIDE OF THE LINE. `relaunches` is a person's record
# — three manual `--restart`s must never spend an automatic budget — and a
# correction is automatic by every property that distinction was made for.
#
# ABSENT, UNREADABLE AND NON-NUMERIC ALL READ ZERO, the same permissive
# direction `manifest_attempts` documents and for the same reason: a manifest
# that cannot be read is not evidence a correction spin is under way. A counter
# that cannot be read also cannot be raised, so the budget still ends the loop.
manifest_corrections() { # $1=manifest → prints a count
  manifest_count "$1" correctionAttempts
}

# Record one more correction of this agent.
#
# IT RAISES `correctionAttempts` AND TOUCHES NOTHING ELSE — in particular not
# `branch`, the shape `raise_manifest_attempts` already takes: the slice stays
# claimed across a correction, because the agent is being asked to fix the work
# it still holds the desk for.
#
# ABSENT IS NOT A FAILURE. A hand-started loop has no manifest, so there is
# nothing to raise and nothing to report.
raise_manifest_corrections() { # $1=manifest
  raise_manifest_count "$1" correctionAttempts
}

# THE MARKER A SPENT BUDGET LEAVES, so the desk is distinguishable from a
# finished one by the reading every other component already makes.
#
# A FILE, NOT A LOG LINE. `plot-worker-state.sh:309` settles that the marker is
# a `PLOT-BLOCKED*` FILE and never a token inside one, and `plot-reap.sh` and
# `plot-fleet-scan.sh` both read it that way — so a worker that only printed its
# question would be reaped as if it had none.
#
# IT IS NOT OVERWRITTEN. A marker already in the tree is an agent's own question
# to a person, and replacing it with Plot's would answer a question nobody
# asked.
# IT NAMES ITS WRITER, ON ITS OWN LINE BELOW THE QUESTION. Measured 2026-08-20
# in `plot-wt-bug-the-timeout-test-does-not-race-the-clock`: a marker written by
# ANOTHER branch's worker into that tree made a finished branch read as blocked,
# and the only way to tell was a person recognising a branch name that was not
# theirs. The fleet scan reads the marker from the TREE, so the tree cannot say
# who wrote it.
#
# BELOW, AND NEVER BESIDE, and that is the whole constraint rather than a layout
# preference. `firstMarkerLine` (`agents-fs.ts:125`) takes the FIRST non-empty
# line and truncates at `QUESTION_MAX = 120`; this caller's head measures 357
# characters once expanded and already renders as 119 plus an ellipsis, so an
# identity prepended to it would push the question out of the render entirely —
# the field would arrive by destroying the thing it annotates. A line below the
# first is never read by the board and always read by the person.
#
# THE IDENTITY IS THE SESSION, not the branch, the worktree or the pid:
# `entities/agent.ts:66` states each of those changes while the agent lives. The
# branch is named too, because the incident was a marker about the WRONG branch
# and the pair is what makes that legible.
#
# AN ABSENT SESSION SAYS SO. `session_handle` returns non-zero when there is no
# handle to print — the exit code is the answer, and an empty string after it is
# a real value rather than a failure to check — so a hand-started loop with no
# dispatcher reports `undeclared` rather than an agent called nothing. Inventing
# one would leave the next foreign-marker incident to be debugged against a name
# nobody minted.
marker_writer_line() { # → one line naming who wrote this marker
  local handle
  if handle=$(session_handle); then
    printf 'Written by the agent on `%s`, session `%s`.' "${PLOT_BRANCH:-?}" "$handle"
  else
    printf 'Written by the agent on `%s` (session undeclared — no dispatcher minted one).' \
      "${PLOT_BRANCH:-?}"
  fi
}

write_blocked_marker() { # $1=worktree $2=text
  local wt="$1" text="$2" file
  [ -n "$wt" ] && [ -d "$wt" ] || return 0
  file="$wt/PLOT-BLOCKED.md"
  [ -e "$file" ] && return 0
  # The writer's line goes through the SAME no-overwrite guard above: a marker
  # already in the tree is an agent's own question to a person, so an existing
  # marker keeps its old shape and gains no field. That is correct rather than a
  # migration gap — answering a question nobody asked is what the guard refuses.
  printf '%s\n\n%s\n' "$text" "$(marker_writer_line)" > "$file" 2>/dev/null || return 0
}

# ---------------------------------------------------------------------------
# THE CORRECTION FILE — what the loop writes and the agent reads
# ---------------------------------------------------------------------------
#
# THE NAME IS ONE FUNCTION so the marker, the writer and the export cannot
# disagree about it. A marker that named a file the loop does not write would
# send a person looking for an account of what was tried and find nothing.
correction_file_name() { printf 'PLOT-CORRECTION.md'; }

# Write one correction into the desk.
#
# $1=worktree $2=branch $3=the failure text, verbatim $4=this attempt $5=budget
#
# IT APPENDS AND NEVER REPLACES, which is the opposite of
# `write_blocked_marker`'s no-overwrite guard and for a reason that inverts
# cleanly. The marker's rule protects a question a PERSON must answer, so a
# second writer must not speak over it. This file is the account of what was
# tried, and the marker at the end of the budget points a person at it — so the
# second correction must not erase the first, or the account says one attempt
# was made where the budget spent two.
#
# THE FAILURE TEXT IS THE MONITOR'S OWN SENTENCE, passed through unread. The run
# URL and the conclusion are in it already; this adds the attempt count and what
# the agent is being asked to do, and interprets nothing about the failure.
#
# IT IS A `PLOT-CORRECTION` FILE AND DELIBERATELY NOT A `PLOT-BLOCKED*` ONE.
# `plot-worker-state.sh:309`, `plot-reap.sh` and `plot-fleet-scan.sh` all read
# the marker prefix as *this desk owes a person an answer*, and a correction owes
# a person nothing — it is the agent's to answer. A correction file matching that
# glob would make every corrected desk read as blocked, stop the reaper, and
# stall the fleet on work that is being fixed automatically.
#
# THE HEADING SAYS THE FILE SUPERSEDES NOTHING. The brief is still the
# specification; a correction is one gate's verdict on the work already done
# against it. An agent told the file replaces its brief would rewrite the slice.
write_correction() { # $1=worktree $2=branch $3=text $4=attempt $5=budget
  local wt="$1" branch="$2" text="$3" attempt="$4" budget="$5" file
  [ -n "$wt" ] && [ -d "$wt" ] || return 0
  file="$wt/$(correction_file_name)"
  {
    printf '## Correction %s of %s — the build failed on `%s`\n\n' \
      "$attempt" "$budget" "${branch:-?}"
    printf 'CI reported: %s\n\n' "$text"
    printf 'This is the build gate'\''s verdict on the work you have already pushed. Your brief is still the specification and this replaces none of it — fix what CI is failing on, commit, and push. Read the run at the URL above for what failed.\n\n'
    printf -- '---\n\n'
  } >> "$file" 2>/dev/null || return 0
}

# Read the slice the registry handed this agent, or nothing while it holds none.
#
# THE AGENT STOPS SHOPPING FOR ITS OWN BRANCH. This replaced
# `plot-fleet-scan.sh --offline --next "$PLOT_SLUG"`, and the change is not a
# cheaper way to ask the same question — it is a different question. `--next`
# asked *what may I take?* and the agent then took it; this asks *what was I
# given?* and the agent works it. The registry is the assignment lock and there
# is only one, so two agents racing for one branch stops being reachable rather
# than being caught after the fact.
#
# WHAT THAT BUYS, BEYOND THE RACE. An agent that selects its own work arrives at
# a branch with no work order: `--next` is scoped to `$PLOT_SLUG` and hands back
# a branch name and nothing else, so a slice of another plan was unreachable and
# a slice of this one came with no brief. An assignment carries both — the
# branch, and the slug whose brief the agent reads.
#
# THE MANIFEST IS THE CHANNEL, AND IT IS NOT A NEW ONE. `branch` is already the
# agent's own field: written at spawn, rewritten on a hop, and cleared at the
# finish so `free = alive AND no branch` is observable. The registry writing it
# is what turns the empty value from a report into an instruction, and it needs
# no second file, no socket and no lock — which is what keeps the daemon
# stateless across restarts.
#
# ABSENT AND EMPTY ARE ONE ANSWER HERE, deliberately. No manifest (a
# hand-started loop) and a manifest naming no branch both mean *nothing has been
# handed to me*, and the agent's response to both is to wait. The distinction
# matters to a READER of the fleet — one is an unregistered agent, the other a
# free one — and `plot-fleet-scan.sh` is what draws it.
#
# A PARSE FAILURE READS AS NO ASSIGNMENT. A manifest that cannot be read is not
# permission to take a branch, so the agent waits and the next pass re-reads a
# file the registry may have finished writing.
assigned_branch() { # $1=manifest → prints the branch, or nothing
  manifest_string "$1" branch
}

# ---------------------------------------------------------------------------
# WHICH SESSION FLAG THIS PROMPT CARRIES — `--session-id` or `--resume`
# ---------------------------------------------------------------------------
#
# THE DECISION IS THE LOOP'S, NOT THE PROMPT'S. `.plot/worker-prompt.sh` passed
# `--session-id "$PLOT_SESSION_ID"` on every invocation, and `PLOT_SESSION_ID`
# never changes across a hop — so an agent handed a SECOND slice asserted an id
# the runtime had already taken. Measured 2026-09-05 on three agents at once:
# `Error: Session ID … is already in use`, the prompt exiting in under a second,
# and the loop returning to its wait having done nothing.
#
# A RULE IN THE PROMPT FILE WOULD NOT HOLD. That file belongs to the adopting
# project — `plot-worker-loop.sh:19` settles it — so every project rewrites it,
# and it is the file that got this wrong. The loop exports a finished flag and
# the prompt interpolates it, which is what keeps a project's own wording from
# reintroducing the bug.
#
# THE TRANSCRIPT IS PROBED, NEVER COUNTED. The loop cannot otherwise tell a
# first slice from a hop: it exports `PLOT_BRANCH` and `PLOT_WORKTREE` and
# nothing else, and `PLOT_SESSION_ID` is the same on both. `wavesCount` looks
# like the answer and is not — it is right only while every earlier prompt
# actually RAN, and the three agents above were left holding `wavesCount: 2`
# with no transcript at all, so a counter would have resumed a conversation that
# does not exist. The probe self-corrects there: no transcript, so create.
#
# IT IS `resumeAvailability`'s OWN TEST, in shell. `resume.ts:42` documents why
# a probe rather than an assertion — Plot *"can require neither — that file and
# the harness it invokes belong to the project — so the one honest test is
# whether a transcript exists under the id Plot asserted."*
#
# THE PROBE IS PER DESK. `plot_transcript_dir` keys on the worktree path, so a
# CREATED desk gets a fresh directory while a RESET desk keeps its own. A hop to
# a new branch mints a new handle, so on either desk the first prompt of the
# new slice finds no transcript and creates one. A same-branch hop onto a
# created desk still reads *no transcript* under a handle the runtime holds.
#
# ONE PROBE, TWO READERS. `plot_transcript_exists` lives in
# `plot-transcript-quiet.sh` and `session_handle` in `plot-agent-manifest.sh`,
# because the watcher's own `plot_worker_idle_watch_pass`
# (`plot-worker-state.sh`) asks the same question with the same handle before
# it calls a quiet desk idle. Two copies could disagree about whether a
# conversation exists.

# The flag the prompt must carry for this invocation.
#
# `--session-id` ASSERTS AN ID THE RUNTIME MUST NOT ALREADY HOLD; `--resume`
# continues one it does. So the answer is the probe's: a transcript under this
# handle means the conversation exists and is resumed, and its absence means
# this is the first prompt to run under it.
#
# IT PRINTS A FLAG AND NEVER A VALUE. The value travels as `PLOT_SESSION_ID`,
# which the prompt already has and already guards; pairing them here would give
# that guard a second place to be wrong, and a blank value reaching `--resume`
# is the one failure this whole path must not produce — the flag is
# optional-valued, so a blank opens an interactive picker inside a `-p` run with
# no terminal and hangs, where `--session-id ""` at least fails loudly.
#
# AN UNANSWERABLE PROBE READS AS CREATE. No handle, no transcript reader, no
# runtime home: none of those is evidence that a conversation exists, and
# asserting an id that turns out to be taken fails loudly in one second, where
# resuming one that does not exist is the failure this slice is about.
session_flag() { # → --session-id | --resume
  local handle
  handle=$(session_handle) || handle=''
  if [ -n "$handle" ] && command -v plot_transcript_exists >/dev/null 2>&1 \
     && plot_transcript_exists "${PLOT_WORKTREE:-$PWD}" "$handle"; then
    printf -- '--resume'
  else
    printf -- '--session-id'
  fi
}

# ---------------------------------------------------------------------------
# THE DESK — create or reset, decided from the tree
# ---------------------------------------------------------------------------
. "$script_dir/plot-worker-state.sh"

# WHAT HOLDS THE DESK — the domain's condition names, in the domain's order.
#
# THIS IS A DUPLICATE OF `resetRefusals` IN `packages/domain/src/rules/reapable.ts`,
# AND THE DUPLICATION IS DECLARED. `docs/shell-and-domain.md` settles which side
# of the cost rule this falls on: a script running once per operator command
# calls the domain, one running once per agent per pass duplicates the rule and
# a corpus comparison holds the pair. This loop is the second case, so the rule
# lives twice and `packages/domain/corpus/desk-reset.corpus.test.ts` asserts the
# two answer alike over a desk in every state a desk can be in.
#
# THE COST IS MEASURED, on this machine on 2026-09-08 at load 11, 20 passes per
# desk:
#
#   76 ms   the whole decision, clean desk — all three conditions asked
#   44 ms   a dirty desk — short-circuits before the `rev-list`
#    2 ms   a desk with a marker — the first condition answers
#   94 ms   ONE `node` hop through a shipped bundle, for comparison
#
# So the hop ALONE costs more than the decision it would replace, and more than
# doubles the clean-desk pass. `docs/shell-and-domain.md` measures 34 ms for
# bare `node -e ''` on an idle machine; a fleet host is not idle, which is the
# condition every agent actually runs under.
#
# ON A DISAGREEMENT THE BRANCH STOPS. Adjusting either side to make that
# comparison pass is the one move forbidden.
#
# THREE MEASUREMENTS, NEVER A JUDGEMENT — the shape every refusal in
# `plot-reap.sh` takes. It answers *is there anything here nobody has accounted
# for?* and nothing about whether the work was any good:
#
#   blocked-marker       a person owes this desk an answer
#   uncommitted-changes  work on the floor
#   unpushed-commits     work that exists only here
#
# THE ORDER IS THE ARGUMENT, and it is `resetRefusals`'s. The marker is first
# because it is the only one an agent cannot clear itself: the other two it
# fixes by committing or pushing, and an operator reading `.plot-worker.log`
# acts on this one differently.
#
# THE READINGS COME FROM `plot-worker-state.sh` AND ARE NOT REWRITTEN HERE.
# `plot_worker_blocked` reads the marker file and `plot_worker_dirty` reads the
# uncommitted work, both already tuned by measurement — the marker is a FILE
# rather than a token any file may contain, and editor leftovers and Plot's own
# `.plot-worker.*` records are excluded from the dirty count. A second
# implementation of either would drift, and the two would then disagree about
# the same desk: the scan would call it `stalled` while this guard called it
# clean, and the guard is the one that acts.
#
# THE FOUR CONDITIONS THE RULE STATES AND THIS DOES NOT READ. `finishedWith`
# answers `noMergedPr`, `openPr`, `checkedOut` and `onDefaultBranch`, and none
# of them bears on what the DESK holds: a branch whose PR is open but whose work
# is fully pushed has left nothing behind, and one whose PR merged with
# uncommitted changes still has. Where the branch stands in review is the
# sweep's question.
#
# (The hop's `--next` does ask the host, since 2026-09-04 — see
# `plot-fleet-scan.sh`, `HOST_LOOKUP_OK`. That answer decides what may be
# CLAIMED, which is a different question from what this desk still owes, and
# borrowing it here would make the reset depend on a fact about somewhere else.)
#
# `liveWorker` IS NOT READ EITHER, and for a sharper reason: the agent asking is
# the live worker. The condition is true of every desk this question is ever put
# about, so reading it would refuse every reset.
#
# AN UNANSWERABLE READING DOES NOT REFUSE, which is `resetRefusals`'s own
# decision about `unknown` and matches what a reset costs. With no `@{upstream}`
# the count cannot be taken, and a failure to observe is not evidence of
# something to see. A branch with no upstream reaches here only when its claim
# push never happened, and that desk's own commits are the claim commit the next
# reset would rewrite. `reset_desk` uses plain `git checkout` throughout, so a
# file these conditions missed makes git REFUSE rather than overwrite.
desk_reset_refusal() { # $1=worktree → the condition holding it, or "" (exit 1)
  local wt="$1" ahead
  [ -n "$wt" ] && [ -d "$wt" ] || { printf 'no-desk'; return 0; }
  if plot_worker_blocked "$wt"; then printf 'blocked-marker'; return 0; fi
  [ -n "$(plot_worker_dirty "$wt")" ] && { printf 'uncommitted-changes'; return 0; }
  if ahead=$(git -C "$wt" rev-list --count '@{upstream}..HEAD' 2>/dev/null); then
    case "$ahead" in
      ''|0|*[!0-9]*) ;;
      *) printf 'unpushed-commits'; return 0 ;;
    esac
  fi
  return 1
}

# WHY THE DESK IS NAMED — the reason it could not be reset, for the log.
#
# RENDERING, NOT DECIDING, and the split is `plot-reap.sh:492`'s. The condition
# above names the measurement; this names what it means to somebody reading
# `.plot-worker.log`, which is the caller's half because only the caller knows
# it is writing prose. A refusal that says only "unlanded work" sends its reader
# to go looking; this tells them whether to answer a question, commit something,
# or push it.
desk_hold_reason() { # $1=worktree → a phrase naming what holds it
  local wt="$1" refusal marker dirty
  refusal=$(desk_reset_refusal "$wt") || { printf 'nothing'; return 0; }
  case "$refusal" in
    blocked-marker)
      marker=$(plot_worker_blocked_file "$wt")
      printf 'a %s marker asking a person a question' "$marker"
      ;;
    uncommitted-changes)
      dirty=$(plot_worker_dirty "$wt")
      printf 'uncommitted changes in %s file(s)' "$(printf '%s\n' "$dirty" | wc -l | tr -d ' ')"
      ;;
    unpushed-commits)
      printf 'commits not pushed to its upstream'
      ;;
    *)
      printf 'no desk at %s' "$wt"
      ;;
  esac
}

# May this desk be taken over for the next slice?
#
# `deskIsResettable` in the domain: no condition holds it. The verdict is the
# refusal's absence rather than a second walk over the same readings, which is
# what keeps the guard and the log's reason from ever disagreeing about one
# desk — they were two functions asking the same three questions until this
# slice, and a third condition added to one of them would have drifted.
desk_is_resettable() { # $1=worktree → 0 when the desk may be taken over
  ! desk_reset_refusal "$1" >/dev/null
}

# End the worker with `holding-work` when its own desk holds unlanded work.
#
# Asks `desk_reset_refusal` about `$PLOT_WORKTREE` (or the working directory).
# On `uncommitted-changes` or `unpushed-commits` it logs the reason, writes the
# ending `holding-work` with actor `agent`, and exits the worker with 0. On any
# other answer — including `blocked-marker`, whose marker already asks a person —
# it returns 0 and the caller continues. The loop calls it twice: right after
# a prompt exits `ran`, and again right before `seal_declaration`, so a write
# that lands during `wait_for_checks` is caught before the hop.
end_if_holding_work() { local wt="${PLOT_WORKTREE:-$PWD}" held reason; held=$(desk_reset_refusal "$wt"); case "$held" in uncommitted-changes|unpushed-commits) reason=$(desk_hold_reason "$wt") ;; *) return 0 ;; esac
  echo "plot-worker-loop: the desk at $wt is held by $held ($reason) after the prompt on ${PLOT_BRANCH:-?} ran — keeping the desk and ending worker rather than handing it to the next slice." >&2; write_ending "$wt" holding-work agent "${PLOT_BRANCH:-}" "$reason"; exit 0; }

# Which worktree holds this branch, if any?
#
# ASKED OF GIT, never rebuilt from the branch name. A checkout left by
# `/plot-implement` is named for the slug and a dispatch desk for the branch,
# and a hand-made one follows no rule at all — the population with a leftover
# checkout is exactly the population whose paths cannot be guessed.
#
# THE MAIN CHECKOUT IS THE FIRST ENTRY, which is `git worktree list`'s
# documented order and the reading `main-checkout` is taken from below.
#
# Prints the holding path and returns 0; prints nothing and returns 1 when no
# worktree holds the branch or git could not be asked.
branch_holding_worktree() { # $1=branch → the path holding it
  local branch="$1" listing line wt=''
  listing=$(git worktree list --porcelain 2>/dev/null) || return 1
  while IFS= read -r line; do
    case "$line" in
      'worktree '*) wt="${line#worktree }" ;;
      "branch refs/heads/$branch")
        [ -n "$wt" ] && { printf '%s' "$wt"; return 0; }
        ;;
    esac
  done <<EOF
$listing
EOF
  return 1
}

# The main checkout's path — `git worktree list --porcelain`'s first entry.
#
# $1, when given, names any worktree of the repository to ask; without it git
# asks the repository of the process's working directory.
main_checkout_path() { # $1=a worktree (optional) → the main worktree's path
  git ${1:+-C "$1"} worktree list --porcelain 2>/dev/null | awk '/^worktree /{print substr($0,10); exit}'
}

# Does an agent manifest name this checkout?
#
# THE DIRECTORY IS THE ONE `PLOT_MANIFEST_FILE` SITS IN, never a hardcoded
# `.plot/agents`: `Agent registry` is configurable and `drop.ts` already hit
# that mistake. A manifest naming the path means another agent owns that desk
# even with no live pid between two slices.
#
# Prints `1`, `0` or `unknown`, which is the bundle's own vocabulary.
#
# AN ABSENT DIRECTORY IS `0`, AND AN ABSENT VARIABLE IS `unknown`. The two look
# alike and are not. With no `PLOT_MANIFEST_FILE` there is no directory to look
# in, so the reading was never taken. A directory that does not exist HAS been
# read: it holds no manifest, so no manifest names this path — the same answer
# `plot_worker_blocked` gives a tree with no marker. Reading it as `unknown`
# would refuse every removal in a repository that has not run the fleet, which
# is every repository the first time, and the feature would never fire.
checkout_is_registered() { # $1=worktree → 1 | 0 | unknown
  local wt="$1" dir
  [ -n "${PLOT_MANIFEST_FILE:-}" ] || { printf 'unknown'; return 0; }
  dir=$(dirname "$PLOT_MANIFEST_FILE")
  [ -d "$dir" ] || { printf '0'; return 0; }
  # OUR OWN MANIFEST IS EXCLUDED. It names the desk this agent sits in, which
  # is never the holder tested here, but a desk reused across slices can carry
  # a stale path and that would refuse every case.
  if grep -l -F -- "\"$wt\"" "$dir"/*.json 2>/dev/null |
       grep -v -x -F -- "$PLOT_MANIFEST_FILE" | grep -q .; then
    printf '1'
  else
    printf '0'
  fi
}

# Does the checkout holding our branch yield it?
#
# THE READINGS ARE THE HOLDER'S, NOT THIS AGENT'S. `desk_reset_refusal` reads
# `$PLOT_WORKTREE` and skips `liveWorker` because the agent asking IS the live
# worker; here the subject is the OTHER worktree, so `live-worker` is asked.
# Passing our own path would refuse every case.
#
# AN UNREADABLE READING KEEPS THE CHECKOUT, and that is the OPPOSITE polarity
# to `desk_reset_refusal`'s `''|0|*[!0-9]*) ;;` on purpose. A reset rewrites
# nothing, so an unanswerable reading costs nothing there. A removal deletes
# the checkout's only copy of an unpushed commit, so here it must keep. A
# reviewer copying that function's case arm into this one removes work.
#
# THE REMOVAL HAS NO `--force`. Without it git refuses on a modified or
# untracked tree, so a reading this missed costs a refused removal and not lost
# work — `reset_desk`'s own argument for plain checkouts, applied one level out.
#
# Returns 0 when the checkout was removed and the branch is free; 1 when it was
# kept, having written a `PLOT-BLOCKED` naming the path, the branch and why.
yield_the_held_checkout() { # $1=holder $2=branch → 0 when the holder is gone
  local holder="$1" branch="$2" bundle live blocked dirty unpushed registered main answer condition
  bundle="$script_dir/board/plot-checkout-yield.mjs"

  if [ ! -f "$bundle" ]; then
    # A checkout that vendored the skills without building them. The rule could
    # not be asked, so the checkout stays — the same answer every unreadable
    # reading gets.
    blocked_on_held_checkout "$holder" "$branch" unaskable \
      "no plot-checkout-yield.mjs beside this script"
    return 1
  fi

  # THE PROCESS READING COMES FROM `plot-worker-state.sh`, which this loop
  # already sources, rather than from a second `kill -0` written here.
  live=unknown
  case "$(plot_worker_state "$holder" "" 2>/dev/null | cut -f1)" in
    running) live=1 ;;
    finished|failed|ended|none|waiting|stalled) live=0 ;;
  esac

  if plot_worker_blocked "$holder"; then blocked=1; else blocked=0; fi

  if [ -d "$holder" ]; then
    [ -n "$(plot_worker_dirty "$holder")" ] && dirty=1 || dirty=0
  else
    dirty=unknown
  fi

  # WITH NO UPSTREAM, THE COMMITS BEYOND `origin/$main_branch` ARE COUNTED BY
  # `board/plot-empty-claim.mjs`, which excludes only proven empty claim
  # markers (#1242). A git or bundle failure reads `unknown`, which keeps.
  if unpushed=$(git -C "$holder" rev-list --count '@{upstream}..HEAD' 2>/dev/null); then
    case "$unpushed" in
      0) unpushed=0 ;;
      ''|*[!0-9]*) unpushed=unknown ;;
      *) unpushed=1 ;;
    esac
  elif unpushed=$(set -o pipefail
      git -C "$holder" log --boundary --format='HEAD%x09%m%x09%H%x09%T%x09%P%x09%s' \
        "origin/$main_branch..HEAD" -- 2>/dev/null |
      node "$script_dir/board/plot-empty-claim.mjs" 2>/dev/null); then
    case "$unpushed" in
      ''|"HEAD	0") unpushed=0 ;;
      "HEAD	"[1-9]*) unpushed=1 ;;
      *) unpushed=unknown ;;
    esac
  else
    unpushed=unknown
  fi

  registered=$(checkout_is_registered "$holder")

  main=$(main_checkout_path)
  if [ -z "$main" ]; then
    main=unknown
  elif [ "$main" = "$holder" ]; then
    main=1
  else
    main=0
  fi

  # READ THE EXIT CODE, NOT THE OUTPUT'S EMPTINESS. A bundle that could not
  # answer exits 2 with nothing on stdout, and taking that for `yields` is the
  # one reading that would remove a checkout nothing judged.
  if ! answer=$(printf '%s\t%s\t%s\t%s\t%s\t%s' \
      "$live" "$blocked" "$dirty" "$unpushed" "$registered" "$main" |
      node "$bundle" 2>/dev/null); then
    blocked_on_held_checkout "$holder" "$branch" unaskable \
      "plot-checkout-yield.mjs could not answer for these readings"
    return 1
  fi

  case "$answer" in
    yields)
      if git worktree remove "$holder" 2>/dev/null; then
        echo "plot-worker-loop: removed the worker-less checkout at $holder that held $branch" >&2
        return 0
      fi
      # GIT REFUSED WHAT THE RULE ALLOWED, which is the guard working: the tree
      # held something the readings missed. It stays, and a person is told.
      blocked_on_held_checkout "$holder" "$branch" 'git-refused' \
        "the rule allowed the removal and git refused it, so the tree holds something the readings missed"
      return 1
      ;;
    keep*)
      condition=$(printf '%s' "$answer" | cut -f2)
      [ -n "$condition" ] || condition=unaskable
      blocked_on_held_checkout "$holder" "$branch" "$condition" ''
      return 1
      ;;
    *)
      blocked_on_held_checkout "$holder" "$branch" unaskable \
        "plot-checkout-yield.mjs answered '$answer', which is neither 'yields' nor 'keep'"
      return 1
      ;;
  esac
}

# The refused-slices record: one branch per line, under the COMMON git dir's
# `.plot/state/` — never a worktree's own, for `record_slice_spend`'s reason.
# `plot-reap.sh` runs `git worktree remove --force` over a finished desk, so a
# record written to one is destroyed by the reap that measured it.
#
# `--git-common-dir` answers relatively in the checkout it is run from, so it
# is resolved against `$PLOT_WORKTREE` rather than trusted as absolute.
#
# A FAILED RESOLUTION RECORDS NOTHING AND SAYS NOTHING, the same refusal
# `record_slice_spend` makes: this runs on the same path as the marker, whose
# own contract is to leave the checkout untouched when a reading cannot be
# taken, and a record is strictly less load-bearing than the marker it rides
# beside.
refused_slices_path() { # → the record's path, or nothing on a failed resolution
  local wt="${PLOT_WORKTREE:-$PWD}" common
  common=$(git -C "$wt" rev-parse --git-common-dir 2>/dev/null) || return 1
  case "$common" in
    /*) : ;;
    *) common="$wt/$common" ;;
  esac
  printf '%s/.plot/state/refused-slices.tsv' "$common"
}

# Appends a branch to the refused-slices record, once.
#
# NEVER TWICE FOR ONE BRANCH. A second refusal on the same branch after a
# person already cleared the first line would otherwise re-add it the moment
# this function runs again — grepping first is what keeps the record a set
# rather than a log, and what keeps *the record line is removed* a real way
# for the hold to end.
#
# THE QUEUE READS THIS BY BRANCH, NEVER BY WORKTREE. By the time the
# supervisor looks, the desk that held the refusal may carry no manifest
# naming the branch at all — measured 2026-10-03, 250 desks behind one refused
# slice had their manifests already cleared.
record_refused_slice() { # $1=branch
  local branch="$1" path
  [ -n "$branch" ] || return 0
  path=$(refused_slices_path) || return 0
  mkdir -p "$(dirname "$path")" 2>/dev/null || return 0
  if [ -f "$path" ] && grep -qxF "$branch" "$path" 2>/dev/null; then
    return 0
  fi
  printf '%s\n' "$branch" >> "$path" 2>/dev/null
}

# The marker for a checkout that kept our branch.
#
# IN OUR OWN DESK, never the holder's: the holder may belong to another agent,
# and `write_blocked_marker` refuses to speak over an existing question anyway.
# The pair of path and branch is what made the foreign-marker incident legible,
# and the condition is the word an operator greps.
#
# THE RECORD NAMES THE BRANCH THE QUEUE MUST HOLD, NOT THE DESK THAT REFUSED
# IT. Measured 2026-10-03: an agent handed `bug/the-queue-reads-the-scans-order`
# wrote this exact marker and stopped; the queue had no hold for a refused
# slice, read the branch as still queued, and handed it to another free
# agent — 250 desks from one slice, at 17 to 19 an hour. `record_refused_slice`
# is what `rules/queue.ts`'s `refused` reading now finds.
blocked_on_held_checkout() { # $1=holder $2=branch $3=condition $4=extra prose
  local holder="$1" branch="$2" condition="$3" extra="$4" text
  text="PLOT-BLOCKED: the worktree \`$holder\` holds \`$branch\`, and this agent was handed that slice. The checkout was kept because \`$condition\`."
  [ -n "$extra" ] && text="$text $extra."
  text="$text Plot removes only a checkout that yields on all six conditions, and never with \`--force\`, so nothing in that tree was touched. Read it, land or discard what it holds, then \`git worktree remove $holder\` and restart this agent with \`/plot-dispatch --restart $branch\`."
  echo "plot-worker-loop: the checkout at $holder keeps $branch ($condition) — leaving it untouched and asking a person" >&2
  write_blocked_marker "${PLOT_WORKTREE:-$PWD}" "$text"
  record_refused_slice "$branch"
}

# Take the desk over for a new branch.
#
# THE BASE IS CHECKED OUT FIRST, AND THE ORDER IS THE DELIVERABLE.
# `.gitignore` is per-checkout: a worktree sees an ignore entry only once the
# branch it holds carries it. That stranded 19 desks on 2026-09-02 — every one
# held back by a single untracked artifact the ignore list had gained after
# those desks were cut, so the desk's own rules predated the rule that would
# have made it clean. A desk switching STRAIGHT to a branch that already exists
# from an earlier attempt inherits that branch's rules for the same reason, and
# an earlier attempt is exactly the case where those rules are stalest.
#
# So: `origin/<main>` first, then the slice's branch. One extra checkout buys a
# desk whose state is independent of whatever it held before.
#
# IT DOES NOT `reset --hard` AND IT DOES NOT `clean -fdx`. Those destroy
# whatever `desk_is_resettable` failed to notice, and the guard being wrong is
# precisely the case where the destruction cannot be undone. A guard that
# misjudges must leave a desk the sweep reports, not deleted work — a leftover
# desk costs a sweep, lost work costs the work. Every checkout here is plain, so
# a file the guard missed makes git REFUSE rather than overwrite, and the caller
# falls back to creating a new desk.
reset_desk() { # $1=worktree $2=branch → 0 when the desk now holds the branch
  local wt="$1" branch="$2"

  # STEP 0 — THE PREVIOUS SLICE'S DECLARATION LEAVES WITH THE SLICE.
  #
  # `seal_declaration` MERGES into whatever file it finds: it keeps the
  # agent's own `artifacts`, `pr`, `summary` and `status`, because the agent is
  # the only party that knows what it produced. That is right when the file
  # belongs to the branch being sealed and wrong the moment two branches share a
  # desk — the second slice would inherit the first slice's PR number and call
  # it its own. One desk per agent creates that sharing, so the removal is this
  # slice's to make.
  #
  # THIS IS NOT THE WORK THE GUARD PROTECTS. It is Plot's own bookkeeping,
  # already excluded from `plot_worker_dirty` by `PLOT_WORKER_RECORD` for the
  # same reason: a file the fleet dropped in the tree is not something an agent
  # left on the floor. The declaration for the finished branch has done its job
  # by the time the hop reaches here — `seal_declaration` ran before `--next`
  # was asked.
  #
  # THE PREVIOUS SLICE'S `PLOT-CORRECTION.md` LEAVES WITH IT. The untracked
  # root file does not hold the desk (`plot_worker_dirty_filter`), and the
  # detach below keeps untracked files, so without this the next slice's agent
  # reads the last slice's correction and `write_correction` appends to it.
  rm -f "$wt/$DECLARATION_FILE_NAME" "$wt/$(correction_file_name)" 2>/dev/null || true

  # STEP 0b — THE GENERATED BUNDLES ARE RESTORED BEFORE THE DETACH, path by
  # path, never `git clean` or `git reset --hard` over the whole tree.
  #
  # WITHOUT THIS, THE CHECKOUT BELOW IS REFUSED ONCE main'S BUNDLES MOVE.
  # `main` rebuilds and pushes its own bundles after every merge
  # (`bug/main-builds-its-bundles`, #1249), so a desk that rebuilt one locally
  # to test it holds a LOCAL MODIFICATION to a tracked path that differs from
  # `origin/$main_branch`'s own build — exactly the case `git checkout
  # --detach` refuses rather than silently overwrite. A leaked desk there is
  # one the loop can never reclaim for the next slice.
  #
  # EACH PATH IS RESTORED FROM `HEAD`, the branch this desk is still on at this
  # point in the function — never from `origin/$main_branch`, which may hold a
  # bundle this desk's own branch never committed, and restoring from the
  # wrong commit was a round 1 finding on the sibling slice this derivation is
  # shared with. A path HEAD does not track (born on this desk, never
  # committed) has nothing to restore FROM, so it is removed instead — `git
  # rm --cached` would fail on an untracked path, so this is a plain `rm`.
  #
  # ONLY THE BUNDLES. A hand-written file beside them — a genuine source
  # change the agent left uncommitted — is untouched here and is exactly what
  # makes the checkout below fail on ITS OWN merits, which is the correct,
  # existing refusal this step does not touch.
  local bundle
  while IFS= read -r bundle; do
    [ -n "$bundle" ] || continue
    if git -C "$wt" cat-file -e "HEAD:$bundle" 2>/dev/null; then
      git -C "$wt" checkout HEAD -- "$bundle" 2>/dev/null || true
    else
      rm -f "$wt/$bundle" 2>/dev/null || true
    fi
  done < <(bundle_paths "$wt")

  # STEP 1 — the base, detached. Detached because the desk may not hold
  # `$main_branch` (another worktree usually does, and git refuses to check out
  # a branch twice), and because nothing here wants the base as a branch: it is
  # a floor to stand on for one command.
  git -C "$wt" checkout --detach "origin/$main_branch" 2>/dev/null || return 1

  # STEP 2 — the slice's branch, created from the base where it does not exist
  # yet and attached where it does. The `-B` form is not used: it would MOVE an
  # existing branch onto the base, discarding commits an earlier attempt left on
  # it, which is the destruction this function refuses everywhere else.
  git -C "$wt" checkout -b "$branch" 2>/dev/null && return 0
  git -C "$wt" checkout "$branch" 2>/dev/null && return 0

  # STEP 3 — BOTH CHECKOUTS FAILED. The usual cause is another worktree holding
  # the branch: git refuses to check one out twice, and the fallback both
  # callers reach for — `git worktree add` — is refused for the same reason. So
  # the holding checkout is the thing to resolve, and `checkout_yields` decides
  # whether it may go.
  local holder
  holder=$(branch_holding_worktree "$branch") || return 1
  [ -n "$holder" ] || return 1
  [ "$holder" = "$wt" ] && return 1

  if ! yield_the_held_checkout "$holder" "$branch"; then
    return 1
  fi

  # RETRIED ONCE, and only once. The removal either freed the branch or it did
  # not; a loop here would re-ask a question whose answer cannot change.
  git -C "$wt" checkout -b "$branch" 2>/dev/null && return 0
  git -C "$wt" checkout "$branch" 2>/dev/null && return 0
  return 1
}

# THE DECLARATION FILE, per branch. `.plot-worker.exit`, `.plot-worker.pid`,
# `.plot-worker.log` and `.plot-worker.monitor.*.jsonl` are already the
# convention; this joins them rather than inventing a location.
DECLARATION_FILE_NAME='.plot-worker.envelope.json'

# Write the declaration for the branch that just finished.
#
# ONE PER BRANCH, NOT ONE PER WORKER, and the difference is the failure this
# whole plan exists to fix, reproduced one level up. A worker HOPS: the loop
# below asks `--next` for another branch of the same plan while `session` and
# `pid` stay fixed, so one worker may finish branches A and B before dying on C.
# A single end-of-life declaration would then be ABSENT, and A and B — genuinely
# finished, PRs open — would read as incomplete.
#
# SO IT IS WRITTEN HERE, where a BRANCH finished, and not in the EXIT trap. The
# trap fires when the WORKER ends, which is a different event and answers a
# different question. A hopping worker leaves a trail of declarations and only
# the branch it died on is missing one.
#
# ABSENCE IS LOAD-BEARING, so this runs on exactly one path: `run_bounded`
# returned 0, meaning the agent's prompt finished on its own. A worker killed by
# the `Worker bound` or ended by the WorkerMonitor exits above without reaching
# this line, and its desk is left with no declaration — which is what says the
# work did not complete, whatever the exit code says.
#
# THE AGENT MAY SPEAK FIRST. If the prompt already wrote the file, its
# `artifacts`, `pr`, `summary` and `status` are kept: the agent is the only
# party that knows what it produced, and Plot does not own the prompt that
# writes it. This fills in only what the agent could not know it needed —
# `branch`, which the loop knows and the agent may misname, and a `status` of
# `ok` where none was declared.
#
# AN UNPARSEABLE FILE IS LEFT EXACTLY AS IT IS. Overwriting it would launder
# bytes nobody can believe into a declaration that says the branch finished, and
# the domain's parse deliberately keeps *unreadable* apart from *complete* for
# that reason. A half-written file stays a half-written file, and a reader is
# told so.
seal_declaration() { # $1=worktree $2=branch
  local worktree="$1" branch="$2" file
  # NO BRANCH, NO DECLARATION. The declaration is ABOUT a branch, so one that
  # names none cannot be attributed and the domain's parse refuses it. Writing
  # an unattributable file would be worse than the absence it replaces.
  [ -n "$branch" ] || return 0
  [ -n "$worktree" ] || return 0
  [ -d "$worktree" ] || return 0
  file="$worktree/$DECLARATION_FILE_NAME"

  # USES NODE for the same reason `update_manifest_on_hop` does: JSON in
  # portable shell is brittle, and the Worker command already requires node.
  # The write goes through a temp file and a rename, so a reader never sees a
  # partial declaration — the one shape this file must never produce, since its
  # own contract says a file that exists and does not parse is not absent.
  local tmp="$file.plot-seal-tmp"
  node -e '
    const fs = require("fs");
    const [file, tmp, branch] = process.argv.slice(1);
    let declared = {};
    if (fs.existsSync(file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) process.exit(3);
        declared = parsed;
      } catch { process.exit(3); }
    }
    const envelope = { ...declared, branch, status: declared.status || "ok" };
    fs.writeFileSync(tmp, JSON.stringify(envelope, null, 2) + "\n");
  ' "$file" "$tmp" "$branch" 2>/dev/null || { rm -f "$tmp"; return 0; }

  mv -f "$tmp" "$file" 2>/dev/null || { rm -f "$tmp"; return 1; }
}

# RECORD WHAT THIS SLICE SPENT, in tokens, summed over its whole run.
#
# CALLED BESIDE `seal_declaration` AND FOR ITS REASON. Both are about a FINISHED
# BRANCH, and this is the only moment that knows which one that is: it runs
# before `--next` is asked and before any hop moves `$PLOT_BRANCH`. A worker does
# not exit between slices — it seals, clears the manifest branch, blocks in
# `wait_for_work`, resets the desk and loops — so a sum taken at worker exit
# charges every slice the worker ever held to whichever branch it held last. Of
# the 12 largest worker transcripts, 3 already span two branches.
#
# IT ASKS THE DOMAIN RATHER THAN SUMMING HERE. `docs/shell-and-domain.md` sets
# the cost rule by measurement: a script running once per OPERATOR COMMAND calls
# the domain, and one running once per agent per PASS duplicates the rule. This
# runs once per slice, which is the first tier — and the sum it would otherwise
# duplicate is a per-branch partition over `gitBranch` with a detached-segment
# rule, which is not a thing to write twice in two languages.
#
# NOTHING IT DOES MAY CHANGE HOW THE WORKER ENDS. The bundle exits 0 on every
# refusal, and this adds `|| true` besides, for `seal_declaration`'s own reason:
# a declaration that cannot be written is left alone rather than failing the
# seal, and a spend is strictly less load-bearing than the declaration it rides
# beside. A missing bundle — a checkout that vendored the skills without building
# the board — records nothing and says nothing.
#
# THE RECORD IS NOT WRITTEN HERE AND NOT WRITTEN TO THE DESK. It goes under the
# COMMON git dir's `.plot/state/`, resolved by the adapter with
# `--git-common-dir`: `plot-reap.sh` runs `git worktree remove --force` over
# these desks, so a record written to one is destroyed by the reap on the machine
# that measured it, with every gate green.
#
# THE BOUND PATH NEVER REACHES THIS, WHICH IS A STATED GAP RATHER THAN AN
# OVERSIGHT. A worker killed by `Worker bound` or ended by the WorkerMonitor
# takes `exit 124` and never gets here — and that is the most expensive run there
# is, so a rollup over these records is biased LOW in a direction nobody can see
# from the records alone.
record_slice_spend() { # $1=worktree $2=branch
  local worktree="$1" branch="$2" bundle
  # NO BRANCH, NO RECORD — the same refusal `seal_declaration` makes, and for
  # the same reason: the record is ABOUT a branch, so one naming none cannot be
  # attributed. The bundle refuses this too; refusing here as well keeps the
  # loop's own contract readable without starting a process to be told it.
  [ -n "$branch" ] || return 0
  [ -n "$worktree" ] || return 0
  [ -d "$worktree" ] || return 0
  bundle="$script_dir/board/plot-slice-spend.mjs"
  [ -f "$bundle" ] || return 0

  node "$bundle" record "$worktree" "$branch" >/dev/null 2>&1 || true
}

# THE ENDING FILE, per WORKER. This is the opposite of the declaration above and
# for the reason that separates them: a declaration is about a BRANCH, and a
# worker hops, so one worker writes several. An ending happens once, to the
# worker, and the branch it held at the time is a field rather than the subject.
ENDING_FILE_NAME='.plot-worker.ending.json'

# Record why this worker ended.
#
# `_ended_detail` WAS WRITTEN NOWHERE UNTIL THIS EXISTED. It was set by whichever
# trap ran and read by one `case` that printed a sentence to stderr — so the
# distinction it drew lived for the length of a log line and reached no reader
# that outlived the process. `.plot-worker.exit` records THAT the worker ended;
# nothing recorded WHY.
#
# THE REASON IS NOT THE ACTOR, and they do not determine each other. The floor
# ends a worker for `bound` and for `unreadable` alike — the same watchdog, and
# what differs is whether a transcript could be read WHILE it ran. Writing one
# field and inferring the other would lose exactly the case this record exists
# for.
#
# IT IS WRITTEN ON THE ENDING PATH ONLY. A worker whose prompt finished on its
# own did not end for a reason — it hopped, or the loop ran out of work — and a
# file claiming otherwise would be a reason invented for an event that had none.
# So absence stays load-bearing here as it is for the declaration: no ending
# file means nobody recorded one, which is what a SIGKILL leaves behind.
write_ending() { # $1=worktree $2=reason $3=actor $4=branch $5=detail
  local worktree="$1" reason="$2" actor="$3" branch="$4" detail="$5" file tmp main
  [ -n "$worktree" ] && [ -d "$worktree" ] && [ -n "$reason" ] && [ -n "$actor" ] || return 0
  file="$worktree/$ENDING_FILE_NAME"; tmp="$file.plot-ending-tmp"; main=$(main_checkout_path "$worktree") || main=''

  # USES NODE for the reason `seal_declaration` does: JSON in portable shell is
  # brittle, and the Worker command already requires node. The write goes
  # through a temp file and a rename, so a reader never sees a partial record —
  # the one shape this file must never produce, since its own contract keeps a
  # file that exists and does not parse apart from one that is absent.
  #
  # THE SAME PROCESS ALSO APPENDS one JSON line to the `.plot/state/endings.jsonl`
  # of the main checkout of `$worktree`, never of the working directory's
  # repository, which differs whenever the caller runs elsewhere. `plot-reap.sh`
  # does not reach that file, since it removes a finished desk's own ending file
  # along with the rest of the worktree. `main` is `""` where no main checkout
  # could be resolved, which the script reads as "append nothing" rather than
  # failing the write it rides beside. BEST EFFORT, LIKE THE MARKER AND THE SPEND RECORD BESIDE IT: a
  # missing main checkout, a missing `.plot/state` directory or a failed append
  # changes no ending, no exit code and no return status of this function.
  node -e '
    const fs = require("fs"), [tmp, main, reason, actor, branch, detail] = process.argv.slice(1);
    const record = { reason, actor, branch, detail }; fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n");
    try { if (main) { fs.mkdirSync(`${main}/.plot/state`, { recursive: true }); fs.appendFileSync(`${main}/.plot/state/endings.jsonl`, JSON.stringify(record) + "\n"); } } catch {}
  ' "$tmp" "$main" "$reason" "$actor" "$branch" "$detail" 2>/dev/null || { rm -f "$tmp"; return 0; }

  mv -f "$tmp" "$file" 2>/dev/null || { rm -f "$tmp"; return 1; }
}

# ---------------------------------------------------------------------------
# THE USAGE LIMIT — what the desk holds, and what the exit was
# ---------------------------------------------------------------------------
#
# A HARNESS THAT STOPPED ON THE ACCOUNT'S USAGE LIMIT EXITS LIKE A PROMPT THAT
# COULD NOT START, and the loop read it as one: measured 2026-10-01 in #1141, a
# worker spent three retries in 974 ms and wrote a marker telling a person to
# fix a prompt file that worked, on a desk holding two pushed commits and ten
# uncommitted files. The limit message names its own reset time, and nothing
# read it.
#
# THE DECISION IS THE BUNDLE'S AND THIS FILE PERFORMS IT. `promptExit` holds
# every pattern, every clock comparison and all three refusals; the loop takes
# the readings, asks, and acts. `docs/shell-and-domain.md` permits the hop here
# because a prompt exit happens once per prompt and a prompt runs for minutes
# or hours — it is not the idle pass the cost rule protects.

# Where a waiting agent records the limit it is waiting out.
#
# INSIDE THE DESK AND UNDER THE `.plot-worker.` PREFIX, so `plot_worker_dirty`
# drops it and a waiting agent does not read as holding unlanded work. The
# monitor and `plot-fleetctl.sh --status` both read it, which is why it is a
# file rather than a variable: they are separate processes.
LIMITED_FILE_NAME='.plot-worker.limited'

# Record the limit this desk is waiting out: reset epoch, reset ISO, limit line.
#
# OVERWRITTEN AT EACH LIMIT, never appended. The file answers *what is this
# desk waiting for NOW*, and a second limit replaces the first rather than
# joining it — a reader taking the newest of several lines would be a second
# rule about one fact.
write_limited_record() { # $1=worktree $2=reset epoch $3=reset iso $4=limit line
  local wt="$1"
  [ -n "$wt" ] && [ -d "$wt" ] || return 0
  printf '%s\t%s\t%s\n' "$2" "$3" "$4" > "$wt/$LIMITED_FILE_NAME" 2>/dev/null || return 0
}

# Remove it. The slice ended, the agent hopped, or the worker is leaving.
clear_limited_record() { # $1=worktree
  local wt="$1"
  [ -n "$wt" ] || return 0
  rm -f "$wt/$LIMITED_FILE_NAME" 2>/dev/null || true
  return 0
}

# What this desk holds that a person would want named.
#
# READ BEFORE THE SENTENCES CLAIM OTHERWISE. Until this slice the failure path
# printed *"without the agent doing any work"*, *"the desk is untouched"* and
# *"no slice was ever worked"* as constants — and #1141's desk held two pushed
# commits and ten uncommitted files while all three were printed. The counts
# are a reading, so they are taken rather than asserted.
#
# COMMITS ARE AGAINST `origin/<main>` AND PATH-LIMITED TO THE DESK, so the
# claim commit the dispatcher pushes is counted like any other: it is a commit
# the branch carries, and a sentence saying the desk is untouched is false
# while it exists.
desk_commit_count() { # $1=worktree → a number, 0 when it cannot be read
  local wt="$1" n
  [ -n "$wt" ] && [ -d "$wt" ] || { printf '0'; return 0; }
  n=$(git -C "$wt" rev-list --count "origin/$main_branch..HEAD" -- . 2>/dev/null) || n=0
  case "$n" in (''|*[!0-9]*) n=0 ;; esac
  printf '%s' "$n"
}

# The desk's uncommitted work, through the ONE filter that decides what counts.
#
# `plot_worker_dirty` DROPS THE LOOP'S OWN `.plot-worker.*` FILES, which is
# what keeps the log, the pid file, the ending record and the limit record out
# of a count a person reads as work on the floor.
desk_dirty_count() { # $1=worktree → a number
  local wt="$1" out
  [ -n "$wt" ] && [ -d "$wt" ] || { printf '0'; return 0; }
  out=$(plot_worker_dirty "$wt" 2>/dev/null)
  [ -n "$out" ] || { printf '0'; return 0; }
  printf '%s' "$(printf '%s\n' "$out" | grep -c .)"
}

# One clause naming what the desk holds, or nothing at all.
#
# EMPTY WHERE BOTH COUNTS ARE ZERO, so a genuinely untouched desk keeps the
# sentence it always had. A clause is added only where the reading contradicts
# it — which is the whole repair: the old sentences were not wrong about every
# desk, they were unconditional.
desk_holding_clause() { # $1=worktree → " The desk holds N commit(s) and M …" | ""
  local wt="$1" commits dirt parts=""
  commits=$(desk_commit_count "$wt")
  dirt=$(desk_dirty_count "$wt")
  [ "$commits" = "0" ] && [ "$dirt" = "0" ] && return 0
  [ "$commits" != "0" ] && parts="$commits commit$([ "$commits" = "1" ] || printf 's')"
  if [ "$dirt" != "0" ]; then
    [ -n "$parts" ] && parts="$parts and "
    parts="$parts$dirt uncommitted file$([ "$dirt" = "1" ] || printf 's')"
  fi
  printf ' The desk holds %s.' "$parts"
}

# Ask the bundle what one prompt exit was.
#
# ALL SEVEN READINGS ON EVERY EXIT, including an exit from a prompt that never
# waited: there the wait flag is 0 and the commit count is 0, and the rule
# reads neither the run time nor the commits, so such an exit can never answer
# `no-progress`.
#
# `${PLOT_HARNESS:-claude}` AND NEVER THE RAW VARIABLE. `plot-dispatch.sh:1516`
# exports `PLOT_HARNESS="$launch_harness"`, and `launch_harness` is EMPTY on
# every launch with no charter — which is every launch on this estate today.
# The raw variable would look up `HARNESS_LIMIT_LINES[""]`, find no patterns,
# and read every limit as a broken prompt: the defect, reintroduced one line
# below its fix.
#
# AN UNASKABLE BUNDLE TAKES TODAY'S PATH. No node, no bundle, a non-zero exit
# or an empty answer all mean the loop behaves exactly as it did before this
# existed — `unstarted` for a non-zero status, `ran` for 0. A classification
# that cannot be made is not a reason to stop a worker.
ask_prompt_exit() { # $1=status $2=ran seconds $3=commits since wait → the answer line
  local status="$1" ran="$2" commits="$3" bundle answer
  bundle="$script_dir/board/plot-prompt-exit.mjs"
  # TODAY'S PATH, named once and used by both refusals below. An `a && b || c`
  # would print BOTH words if `b` ever failed, and the caller reads the first
  # tab-separated field — so two words joined would read as neither.
  by_status() { if [ "$status" -eq 0 ]; then printf 'ran'; else printf 'unstarted'; fi; }

  if [ -z "$_prompt_out_file" ] || [ ! -r "$_prompt_out_file" ] || \
     [ ! -r "$bundle" ] || ! command -v node >/dev/null 2>&1; then
    by_status
    return 0
  fi
  answer=$(tail -n 200 "$_prompt_out_file" 2>/dev/null | node "$bundle" \
    "$status" "${PLOT_HARNESS:-claude}" "$(clock_now)" "$WORKER_BOUND_SECONDS" \
    "$ran" "$_after_wait" "$commits" 2>/dev/null) || answer=""
  # AN EMPTY ANSWER IS A REFUSAL, not an empty verdict. The bundle exits 2 on
  # an argument it cannot read and writes nothing, which is the case a misread
  # reading would otherwise turn into a decision.
  if [ -z "$answer" ]; then
    by_status
    return 0
  fi
  printf '%s' "$answer"
}

# Sleep until the reset, in steps, comparing the clock after each one.
#
# STEPS OF AT MOST 60 s, EACH AS `_wait_sleep_pid`, for two reasons that are
# one mechanism: `--stop` sends SIGTERM and the exit trap reaps that pid, so a
# stopped agent leaves within one step rather than hours later; and the clock
# is re-read between steps, so a machine that slept or a clock that jumped does
# not leave the agent waiting out an interval that already passed.
#
# THE MARGIN IS ADDED ONCE, AT THE END. A reset is the instant the limit lifts,
# and a prompt started in the same second has been measured meeting it again;
# `PLOT_LIMIT_MARGIN_SECONDS` is the grace, defaulting to a minute.
sleep_until_reset() { # $1=reset epoch
  local target="$1" now remaining step
  target=$(( target + ${PLOT_LIMIT_MARGIN_SECONDS-60} ))
  while :; do
    now=$(clock_now)
    remaining=$(( target - now ))
    [ "$remaining" -gt 0 ] || return 0
    step=$remaining
    [ "$step" -gt 60 ] && step=60
    sleep "$step" &
    _wait_sleep_pid=$!
    wait "$_wait_sleep_pid" 2>/dev/null
    _wait_sleep_pid=""
  done
}

# ---------------------------------------------------------------------------
# WHICH PROMPT THIS AGENT RUNS
# ---------------------------------------------------------------------------
#
# THE PROMPT IS RESOLVED, NOT ASSUMED. `prompt_file` was
# `$repo_root/.plot/worker-prompt.sh`, hardcoded, until 2026-09-03 — one prompt
# per REPO, so every dispatched agent ran the same instructions and `AgentEntry`
# (`registry.ts:105`) held no field that could have said otherwise. An agent's
# charter (`.plot/charters/<name>.json`) names its own prompt, and
# `plot-prompt.mjs` decides which applies.
#
# RESOLUTION, NEVER MATCHING. `$PLOT_AGENT` is what the dispatcher or operator
# set; nothing here reads a plan, ranks a candidate, or chooses among agents.
# Declaring agents makes choosing one possible and does not perform it.
#
# NOTHING ON THE ESTATE CHANGES UNTIL A CHARTER EXISTS. `$PLOT_AGENT` unset —
# which is every worker today, since the estate holds zero charters — resolves
# to `.plot/worker-prompt.sh`, exactly the path that was hardcoded before. So
# does a named agent with no charter file on this clone.
#
# A REFUSAL IS NOT A FALLBACK. A charter that exists and cannot be believed — a
# typo, or a run fact a charter refuses to carry — ends the worker. The fallback
# would RUN, successfully, under a prompt the operator did not ask for, and
# nothing in `.plot-worker.log` would say so.
#
# THE BUNDLE MISSING IS ALSO NOT A REFUSAL. `plot-prompt.mjs` is vendored beside
# this script, and a checkout without it is a Plot installation problem rather
# than a statement about this agent. It falls back and says it could not ask —
# the shape `plot-dispatch.sh:1217` already uses for an unaskable rule.
#
# A FUNCTION RATHER THAN A RUN OF TOP-LEVEL LINES, so it sits above the
# `PLOT_WORKER_LOOP_SOURCED` guard and a test can exercise its four arms without
# launching a worker — the idiom this file already applies to the desk decision.
# It sets `prompt_file` and `prompt_verb` and returns 1 on a refusal; the caller
# below exits, because only the caller is a worker.
resolve_prompt_file() { # $1 = repo root, $2 = agent name ('' when none)
  local root="$1" agent="$2" resolution="" status=0 rest
  prompt_verb=""
  prompt_why=""

  if [ -f "$script_dir/board/plot-prompt.mjs" ]; then
    resolution=$(node "$script_dir/board/plot-prompt.mjs" "$root" "$agent" 2>/dev/null)
    status=$?
  else
    echo "plot-worker-loop: no plot-prompt.mjs beside this script — using $root/.plot/worker-prompt.sh without asking which prompt ${agent:-this agent} declared" >&2
  fi

  prompt_verb=${resolution%%$'\t'*}
  rest=${resolution#*$'\t'}
  local named=${rest%%$'\t'*}
  prompt_why=${rest#*$'\t'}

  if [ "$status" -eq 3 ] || [ "$prompt_verb" = "refused" ]; then
    echo "plot-worker-loop: refusing to launch ${PLOT_BRANCH:-?} — $prompt_why" >&2
    echo "  A charter that cannot be read is a person's typo, and the repo prompt would run" >&2
    echo "  successfully under instructions nobody asked for. Fix $root/.plot/charters/$agent.json" >&2
    echo "  or unset PLOT_AGENT to run the repo's prompt deliberately." >&2
    return 1
  fi

  case "$prompt_verb" in
    declared)
      prompt_file="$root/$named"
      echo "plot-worker-loop: agent '$prompt_why' runs $named" >&2
      ;;
    fallback)
      prompt_file="$root/$named"
      ;;
    *)
      # An unrecognised verb, or an empty answer from a bundle that could not
      # run. The repo's prompt, which is what this was before resolution existed.
      prompt_verb="fallback"
      prompt_file="$root/.plot/worker-prompt.sh"
      ;;
  esac
  return 0
}

# WHETHER THE MANIFEST A WAITING LOOP POLLS STILL STANDS — `loopRegistration`
# (`packages/domain/src/rules/desk-manifest.ts`), duplicated here for the
# reason `docs/shell-and-domain.md` states: `wait_for_work` calls this once per
# `WAIT_POLL_SECONDS` per agent, where a 39 ms `node` hop is a cost paid by
# every waiting agent forever. `[ -f ]` answers it. `desk-manifest.corpus.test.ts`
# holds the pair; on a disagreement the branch stops.
#
# DEFINED ABOVE THE `PLOT_WORKER_LOOP_SOURCED` GUARD, for `resolve_prompt_file`'s
# own reason stated below: the guard returns before `wait_for_work` is defined,
# so a function `wait_for_work` calls must sit above it too, or a test sourcing
# this file for it gets `command not found` rather than the function.
#
# PRINTS THE WORD ON STDOUT, exactly as `assigned_branch` prints its branch —
# the loop runs under `set -uo pipefail` with no `-e`, and a bare non-zero
# return from a helper called inside an arithmetic or `[` context can leak past
# the `case` that means to contain it. Returning the word on stdout and
# `case`-ing on the CALLER side cannot leak a status anywhere.
#
# `unset` IS NOT `gone`. Absent is not false: `PLOT_MANIFEST_FILE` empty means
# a hand-started loop, a supported shape `workerloop.test.mjs`'s wait tests
# pin by blanking the variable in seven fixtures. Only a NAME pointing at a
# missing file is `gone`.
#
# @param $1 PLOT_MANIFEST_FILE as the loop holds it, possibly empty
# @return always 0; the word is what the caller reads
loop_registration() { # $1=manifest file → prints registered|unset|gone
  local manifest="$1"
  if [ -z "$manifest" ]; then
    printf 'unset'
  elif [ -f "$manifest" ]; then
    printf 'registered'
  else
    printf 'gone'
  fi
}

# ---------------------------------------------------------------------------
# EVERYTHING ABOVE IS DEFINITIONS; EVERYTHING BELOW STARTS A WORKER
# ---------------------------------------------------------------------------
# THE BUILD'S VERDICT — the finding this loop now corrects on
# ---------------------------------------------------------------------------
#
# IT IS DEFINED ABOVE THE `PLOT_WORKER_LOOP_SOURCED` GUARD, BESIDE THE MANIFEST
# READERS AND NOT BESIDE `monitor_says_idle`, WHICH IT OTHERWISE MIRRORS. The
# guard returns before that function is defined, so a test sourcing this file to
# drive it gets `command not found` — exit 127, which a caller reading only the
# status reads as *no correction owed*. Measured while building this slice: eight
# discard tests passed against a function that had never been defined, and every
# one of them would have passed against no implementation at all. These two are
# pure — one `grep` and one `rev-parse`, no loop state — so position costs
# nothing and being sourceable is what makes the discards assertable.
#
# `plot-build-monitor.sh` detects a failing run and publishes `build failed`
# with the run URL, the head sha and the conclusion. Until this slice, consumers
# of that finding on the estate were NONE: `buildMonitorPid` was read by the
# board's registry and the finding itself by nothing, so CI's verdict was
# measured, published, and dropped.
#
# WHERE THE FINDINGS ARE. The same derivation `monitor_findings_file` makes for
# the WorkerMonitor, against the BuildMonitor's own filename. It is duplicated
# at one line rather than plumbed, for that function's stated reason: the
# wrapper starts the monitors, the loop is started BY the wrapper's command, and
# no env var travels between them. `PLOT_BUILD_MONITOR_FILE` is read first so
# the day the wrapper passes one, this follows it without a second change.
build_findings_file() {
  printf '%s' "${PLOT_BUILD_MONITOR_FILE:-${PLOT_WORKTREE:+$PLOT_WORKTREE/.plot-worker.monitor.build.jsonl}}"
}

# Does the BuildMonitor's LATEST finding say a build failed, and is it about the
# code this desk is holding right now?
#
# → prints the finding's `evidence` when a correction is owed; nothing otherwise
#
# THE LAST MATCHING LINE, NEVER ANY LINE. `monitor_says_idle` states the rule
# and the BuildMonitor makes it sharper: that monitor publishes on a change of
# ANSWER-ABOUT-A-COMMIT, so a desk whose build failed and whose next push passed
# carries `build failed` followed by `build passed`, both forever, in one file.
# Grepping the file for the word would correct an agent whose build has since
# gone green — the single most likely defect in this path, and the one that
# wastes a whole correction telling an agent to fix work that is already right.
#
# THE MONITOR IS MATCHED BY NAME. The AgentMonitor and the WorkerMonitor write
# beside this file under the same `.plot-worker.monitor.` prefix with different
# vocabularies — one reports what an agent OWES, a Registry-side fact, the other
# what a process is DOING. Taking either as a verdict about a build is exactly
# the Machine/Registry confusion CLAUDE.md's split exists to prevent, so the
# match is anchored on the `"monitor":"BuildMonitor"` field the monitor stamps
# into every line. `monitor_says_idle` is the precedent.
#
# GREP RATHER THAN A JSON PARSER, for `monitor_says_idle`'s reason unchanged:
# the line is written by `printf` in `plot-build-monitor.sh:publish` with a
# fixed field order, so the fields sit at known positions in a known shape, and
# a `node -e` per poll would fork an interpreter inside a worker whose whole
# point is to leave the machine alone for the agent.
#
# A FINDING FILE THAT DOES NOT EXIST IS NOT A PASSING BUILD. It is no reading at
# all — no monitor ran, or none has published yet — and the answer is that
# nothing is owed, which is the same shape `monitor_says_idle` takes for an
# unreadable file.
build_says_failed() { # → prints the evidence, or nothing
  local f
  f=$(build_findings_file)
  [ -n "$f" ] && [ -s "$f" ] || return 1
  local last
  last=$(grep '"monitor":"BuildMonitor"' "$f" 2>/dev/null | tail -n 1)
  [ -n "$last" ] || return 1
  case "$last" in (*'"finding":"build failed"'*) ;; (*) return 1 ;; esac

  # THE EVIDENCE IS THE MESSAGE, TAKEN VERBATIM. The monitor already wrote *"the
  # run at <url> for <sha> concluded <conclusion>"* — the run URL and the
  # conclusion are what a person would read, and a summary here would be a
  # second interpretation of something CI stated precisely. So the field is
  # passed through rather than rebuilt.
  #
  # THE FIELD IS CUT AT ITS OWN BOUNDARIES rather than by counting: `evidence`
  # is followed by `measuredAt` in a fixed order, so the prefix is removed up to
  # the key and the suffix from the next key on.
  local evidence="${last#*\"evidence\":\"}"
  evidence="${evidence%%\",\"measuredAt\"*}"
  [ -n "$evidence" ] || return 1

  # A CORRECTION ABOUT A SUPERSEDED SHA IS DISCARDED, NOT DELIVERED. The monitor
  # already refuses the inverse — `head moved` exists because *"A green result
  # for code nobody will merge is worse than no result"* — and a failure about a
  # sha the agent has already replaced is answered by work that is already done.
  # Delivering it would spend a correction asking for a fix that landed before
  # the question arrived.
  #
  # THE COMPARISON IS AT CONSUMPTION TIME, and it has to be: the finding was
  # true when published and the branch has had minutes to move since. The
  # monitor's own `settled_shas` cannot answer this — it stops the monitor
  # re-asking, and says nothing about whether a subscriber should still act.
  #
  # THE SHA IS READ OUT OF THE EVIDENCE because the finding carries it nowhere
  # else: `publish` writes seven fields and none of them is the commit. Adding
  # one would be a monitor change for a fact its own sentence already states, so
  # the sentence is parsed — `for <sha> concluded` — and the shape is pinned by
  # a contract test against the monitor's real output rather than assumed.
  #
  # AN UNREADABLE SHA ON EITHER SIDE DELIVERS. A finding whose sentence does not
  # carry one, or a worktree whose HEAD cannot be read, is not evidence that the
  # failure is stale — and the failing direction matters: discarding on an
  # unreadable reading would silently drop every correction the moment the
  # sentence changed shape, where delivering one costs a correction against a
  # budget that ends in a person either way.
  local finding_sha head_sha
  finding_sha="${evidence##*for }"
  finding_sha="${finding_sha%% concluded*}"
  case "$evidence" in (*" for "*" concluded "*) ;; (*) finding_sha='' ;; esac
  head_sha=$(git -C "${PLOT_WORKTREE:-$PWD}" rev-parse --verify --quiet HEAD 2>/dev/null || true)
  if [ -n "$finding_sha" ] && [ -n "$head_sha" ] && [ "$finding_sha" != "$head_sha" ]; then
    return 1
  fi

  printf '%s' "$evidence"
}

# ---------------------------------------------------------------------------
# THE WAIT FOR A PR'S CHECKS — `checksVerdict` decides, these read
# ---------------------------------------------------------------------------
#
# Is the desk's HEAD on the remote? One fetch of the one branch, asked once
# per finished prompt. A fetch that fails reads as not pushed, which ends the
# slice as it ended before the wait existed.
head_is_pushed() { # $1=head → 0 pushed | 1 not, or unreadable
  local wt="${PLOT_WORKTREE:-$PWD}" remote
  git -C "$wt" fetch -q origin "${PLOT_BRANCH:-}" 2>/dev/null || return 1
  remote=$(git -C "$wt" rev-parse --verify --quiet "origin/${PLOT_BRANCH:-}" 2>/dev/null) || return 1
  [ "$remote" = "$1" ]
}

# Does an open pull request carry the branch? One host question per finished
# prompt, through the adapter. CI runs on pull requests, so without one no
# result will come. A host that cannot be asked reads as no PR.
pr_is_open() { # → 0 open | 1 not, or unaskable
  "$script_dir/plot-host.sh" pr-state "${PLOT_BRANCH:-}" 2>/dev/null | grep -q '"state":"OPEN"'
}

# What does `checksVerdict` answer for these readings and the BuildMonitor's
# latest line? Prints `none`, `wait`, `settled` or `expired`. A missing bundle
# or an answer outside those four prints `none`: the slice then ends as it did
# before the wait existed, and the log says the rule could not be asked.
checks_verdict() { # $1=head $2=pushed $3=pr_open $4=waited
  local bundle="$script_dir/board/plot-checks-verdict.mjs" f last='' answer
  if [ ! -f "$bundle" ]; then
    echo "plot-worker-loop: no plot-checks-verdict.mjs beside this script — not waiting for the checks on ${PLOT_BRANCH:-?}" >&2
    printf 'none'
    return 0
  fi
  f=$(build_findings_file)
  if [ -n "$f" ] && [ -s "$f" ]; then
    last=$(grep '"monitor":"BuildMonitor"' "$f" 2>/dev/null | tail -n 1)
  fi
  answer=$(printf '%s' "$last" | node "$bundle" "${PLOT_BRANCH:-}" "$1" "$2" "$3" "$4" "$CHECKS_WAIT_SECONDS" 2>/dev/null)
  case "$answer" in
    none|wait|settled|expired) printf '%s' "$answer" ;;
    *) printf 'none' ;;
  esac
}

# Keep the slice until the checks for the pushed head have a result, or the
# wait reaches `Checks wait`. Returns when the caller may read the result.
wait_for_checks() {
  [ -n "${PLOT_BRANCH:-}" ] || return 0
  local wt="${PLOT_WORKTREE:-$PWD}" head pushed=0 pr=0 waited=0 verdict
  head=$(git -C "$wt" rev-parse --verify --quiet HEAD 2>/dev/null) || return 0
  head_is_pushed "$head" && pushed=1
  [ "$pushed" = 1 ] && pr_is_open && pr=1
  verdict=$(checks_verdict "$head" "$pushed" "$pr" 0)
  [ "$verdict" = wait ] || return 0
  echo "plot-worker-loop: waiting for the checks on ${PLOT_BRANCH} at ${head:0:8} — the slice stays with this agent until CI answers, for up to ${CHECKS_WAIT_SECONDS}s." >&2
  while [ "$verdict" = wait ]; do
    sleep "$CHECKS_POLL_SECONDS"
    waited=$(( waited + CHECKS_POLL_SECONDS ))
    verdict=$(checks_verdict "$head" "$pushed" "$pr" "$waited")
  done
  case "$verdict" in
    settled) echo "plot-worker-loop: CI answered on ${PLOT_BRANCH} after ${waited}s." >&2 ;;
    expired) echo "plot-worker-loop: no CI answer on ${PLOT_BRANCH} after ${waited}s — letting go of the slice; a later failure reaches a person." >&2 ;;
  esac
  return 0
}

# THE WORKER'S RECORDS FOLLOW IT TO A NEW DESK. `start_worker`'s wrapper writes
# `.plot-worker.pid` and `.plot-worker.wrapper.pid` into the desk the agent
# starts in. A loop that cannot reset that desk cuts a new one and moves there,
# and the old desk then still names the live pid: `plot-worker-state.sh` reads it
# as `running`, `plot-reap.sh` refuses it as a live worker, and `--release`
# refuses it too. Measured 2026-10-02: pid 60290 started at
# `.worktrees/free-9cbeda11`, moved to a `plot-wt-` desk, and the old desk still
# named 60290 after its PR #1197 merged.
#
# THE VALUES ARE COPIED, NOT RE-DERIVED. The wrapper recorded `$!` of the
# subshell that runs this loop, and the monitors and the agent-liveness walk
# read that pid; `$$` here can differ from it. A desk with no record names no
# worker Plot started, so nothing moves.
#
# THE OLD FILES ARE EMPTIED, NOT DELETED. `plot-reap.sh` and
# `plot-reconcile-scan.sh` §21 recognise a dispatch desk by `.plot-worker.pid`,
# so a deleted file leaves the old desk unplaced and never reaped. Every reader
# reads an empty file as no live worker.
#
# Each write goes to a temporary file in the same directory and is renamed into
# place, so a reader sees the old content or the new and never a partial one.
# A same-desk reset (`$2` = `$1`) changes nothing.
move_worker_record() { # $1=the desk left, $2=the desk taken
  local from="$1" to="$2" name value
  [ -n "$from" ] && [ -n "$to" ] && [ "$from" != "$to" ] || return 0
  for name in .plot-worker.pid .plot-worker.wrapper.pid; do
    [ -f "$from/$name" ] || continue
    value=$(tr -d ' \n' < "$from/$name" 2>/dev/null) || value=""
    [ -n "$value" ] || continue
    printf '%s' "$value" > "$to/$name.tmp" 2>/dev/null && mv -f "$to/$name.tmp" "$to/$name" 2>/dev/null || {
      rm -f "$to/$name.tmp" 2>/dev/null
      echo "plot-worker-loop: could not record $name at $to — leaving $from as it is" >&2
      continue
    }
    : > "$from/$name.tmp" 2>/dev/null && mv -f "$from/$name.tmp" "$from/$name" 2>/dev/null || \
      rm -f "$from/$name.tmp" 2>/dev/null
  done
  return 0
}

# ---------------------------------------------------------------------------
#
# `PLOT_WORKER_LOOP_SOURCED=1` STOPS HERE, so a test can take the definitions
# without launching anything. The desk decision — `desk_is_resettable`,
# `desk_hold_reason`, `reset_desk` — needs one tree per case, each in a
# different state, and driving a whole loop per case would spend a two-minute
# fixture to observe one `if`. `plot-worker-state.sh` is sourced rather than run
# for the same reason and states it in its own first paragraph; this is that
# idiom applied to the file that already sources it.
#
# THE FLAG IS OPT-IN AND NAMED FOR THIS FILE. An unset variable leaves the
# script exactly as it was — no caller changes, and a worker started by the
# fleet cannot reach this return by accident. `return` rather than `exit`
# because a sourced script returns to its sourcer; under `bash file` it would
# be an error, which is why it is reached only when the caller asked for it.
[ -n "${PLOT_WORKER_LOOP_SOURCED:-}" ] && return 0

resolve_prompt_file "$repo_root" "${PLOT_AGENT:-}" || exit 1

# A file rather than a config key because plot-config.sh strips `(...)` as prose,
# and the prompt legitimately contains shell constructs like ${PLOT_BRANCH##*/}.
if [ ! -f "$prompt_file" ]; then
  echo "plot-worker-loop: no prompt file at $prompt_file" >&2
  # WHO ASKED FOR THAT PATH. A missing repo prompt is an unadopted project; a
  # missing DECLARED prompt is a charter pointing at a file nobody wrote, and
  # the two are fixed in different files.
  [ "$prompt_verb" = "declared" ] && \
    echo "  Named by the charter for agent '$prompt_why' ($repo_root/.plot/charters/$prompt_why.json)." >&2
  echo "  Create it with the inner claude -p invocation, e.g.:" >&2
  echo "    claude -p \"You are implementing the branch \$PLOT_BRANCH...\" \"\$PLOT_SESSION_FLAG\" \"\$PLOT_SESSION_ID\" --permission-mode bypassPermissions" >&2
  # THE PAIR IS SHOWN, NOT `--session-id` ALONE. This is the one place a person
  # writes the invocation, and it is the only half of the contract Plot cannot
  # fulfil itself. The flag is the LOOP's decision — `--session-id` on a first
  # slice, `--resume` on every one after — so a prompt file that hardcodes
  # `--session-id` works once and fails on the agent's second slice. Both stay
  # OPTIONAL: without them the worker runs exactly as before and resume reports
  # itself unavailable, which is the honest answer rather than a failure.
  echo "  Interpolating both lets a correction resume the same conversation, and" >&2
  echo "  lets a second slice start at all; hardcoding --session-id fails on it." >&2
  echo "  Without them resume is reported unavailable and a fresh worker is started." >&2
  exit 1
fi

# THE SETTINGS FILE EVERY AGENT THIS LOOP STARTS RECEIVES.
#
# ONCE PER AGENT START, here rather than inside `run_bounded`, which runs once
# per PASS. The answer cannot change between a first prompt and its correction:
# the key is a line in CLAUDE.md and the file it names is committed, so asking
# again per pass would buy nothing and spend a `node` start each time.
#
# EXPORTED BEFORE THE PROMPT IS SOURCED, which is what makes this cover every
# prompt `resolve_prompt_file` returns — a charter-declared one included — and
# every launch path that reaches this loop: a dispatch, a `--restart`,
# `/api/continue` and the supervisor's `--start-agents`. The prompt interpolates
# `${PLOT_AGENT_SETTINGS:+--settings "$PLOT_AGENT_SETTINGS"}` itself, so nothing
# here rewrites a configured command.
#
# A REFUSAL IS ONE LINE AND THE AGENT STILL STARTS. `plot-agent-settings.sh`
# exits 3 for a missing, unparseable or gate-disabling file, and the worker runs
# without the flag: a typo in a config key must not stop every agent on the
# machine. The variable is left UNSET in that case, which is what the prompt's
# `:+` guard reads.
# ASKED ONCE, BOTH STREAMS KEPT. A second call to read the reason would spend
# another `node` start and could answer differently from the first, so the
# refusal's text is captured alongside the path in one reading.
#
# UNSET, NEVER EMPTY, when there is no path to pass. `${VAR:+…}` treats both the
# same, but an exported empty variable is a value a prompt could test for and
# find, and the honest state is that Plot resolved nothing.
# THROUGH `plot-tmp.sh`, like every other temp path this estate creates. The
# helper registers the removal with the one exit registry, so the reason file
# cannot outlive the loop even if it exits between the read and the cleanup.
unset PLOT_AGENT_SETTINGS
plot_tmpfile _settings_reason_file agent-settings
if _settings_path=$(bash "$(dirname "${BASH_SOURCE[0]}")/plot-agent-settings.sh" \
      2>"$_settings_reason_file"); then
  [ -n "$_settings_path" ] && export PLOT_AGENT_SETTINGS="$_settings_path"
else
  # The reason goes where an operator triages this worker, and the agent starts
  # without the flag.
  sed 's/^/plot-worker-loop: /' "$_settings_reason_file" >&2 || true
fi
unset _settings_path

# Determine the main branch for worktree creation.
main_branch=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
[ -z "$main_branch" ] && main_branch=main

# ---------------------------------------------------------------------------
# The bound on a single prompt run — bash alone, no timeout(1)
# ---------------------------------------------------------------------------
#
# THE MECHANISM WAS SPIKED BEFORE IT WAS CHOSEN. The obvious phrasing,
# `timeout $B . "$prompt_file"`, does not exist: line 108 sources a file, and
# `. ` is a shell BUILTIN that runs in the loop's own process — `timeout(1)`
# execs a new process and cannot wrap it. `timeout(1)` is also not assumable:
# measured here it resolves to `/opt/homebrew/bin/timeout` (coreutils), and a
# mac without Homebrew has neither `timeout` nor `gtimeout`. Plot's helpers
# assume nothing beyond POSIX tools and git, so the bound is BASH ALONE.
#
# SO THE PROMPT RUNS IN A CHILD, NOT THE LOOP'S SHELL. `bash -c '. "$f"'` still
# SOURCES the prompt file — `$PLOT_BRANCH` and friends expand at runtime exactly
# as before — but now inside a process that can be killed. The dispatcher sets
# those variables as an exported prefix assignment (plot-dispatch.sh), and the
# loop re-exports them on each hop (below), so they survive the child.
#
# A WATCHDOG, NOT A HANDLER FOR THE ERROR. The `No messages returned` rejection
# happens inside the CLI's own process and never yields an exit code — that IS
# the defect. There is nothing to catch. A wall-clock bound catches the next,
# unseen hang too; matching the log for that one string would recognise only the
# hang already measured.
#
# THE WATCHDOG SIGNALS, IT DOES NOT RACE ON `wait -n`. An earlier version raced
# the prompt against a watchdog `sleep` with `wait -n` and read the loser from
# the survivor's liveness. Measured: on macOS's stock `/bin/bash` (3.2), which
# has no `wait -n`, that builtin errors and returns instantly — the bound read
# every prompt as an honest finish and never fired. The exact system this gate
# is FOR — a mac with no Homebrew, hence no `timeout(1)` — is also the one with
# only bash 3.2, so a bash-4.3 dependency would disable the bound precisely
# where it is needed. So instead: a background watchdog sends SIGALRM to the
# loop after the bound, a trap sets a flag and kills the prompt, and the loop
# merely `wait`s on the prompt (a builtin every bash has). Works on 3.2 and 5.x.
#
# CLEANUP IS ON EVERY EXIT PATH. `run_bounded` tracks the prompt child and its
# watchdog in file-scope variables, and a single EXIT trap reaps BOTH — so a
# normal finish, a timeout, a Ctrl-C, and an outright kill of the loop all leave
# no orphaned sleep and no stray child. A bound that outlived its worker would
# be a new leak inside the fix for a leak.
_prompt_child=""
_watchdog_pid=""
_monitor_watcher_pid=""
# THE WAIT'S SLEEP JOINS THEM, and for the reason the block above gives rather
# than a new one: a free agent spends its time in `sleep` exactly as a bounded
# prompt does, and a sleep that outlived the worker would be the same leak.
_wait_sleep_pid=""
_timed_out=0

# THE PROMPT'S CAPTURED OUTPUT, and when it started.
#
# ONE CLOCK FUNCTION, ASKED EVERYWHERE. The wait compares a reset epoch against
# now in four places — the answer, the sleep's own steps, the monitor's silence
# and `--status` — and a second spelling of `date +%s` is a second answer
# waiting to disagree. `PLOT_CLOCK_OFFSET_SECONDS` is the TEST SEAM, and it is
# the only way to prove a reset two seconds ahead without spending two seconds
# per assertion; it is not a Plot Config key, because a project has no opinion
# about what time it is.
_prompt_out_file=""
_prompt_started_at=0
clock_now() {
  local now
  now=$(date +%s)
  printf '%s' "$(( now + ${PLOT_CLOCK_OFFSET_SECONDS:-0} ))"
}

# WHETHER THIS PROMPT FOLLOWS A LIMIT WAIT, and the desk's `HEAD` when it began.
#
# THE RULE READS BOTH ONLY TOGETHER. `promptExit` answers `no-progress` for a
# prompt that waited, returned inside its progress window and committed
# nothing; with the flag at 0 it reads neither, so an exit from a prompt that
# never waited can never end a worker for want of progress. The pair is cleared
# whenever the agent takes a new slice, because progress is asked about THIS
# slice and a fresh one has its own.
_after_wait=0
_wait_head=""
# THE PROMPT'S OWN EXIT CODE, set by `run_bounded` after its `wait` and read by
# the loop below. It joins the file-scope run state rather than being a local,
# for the reason `_ended_by` and `_ended_detail` are here: the caller reads it
# after the function has returned.
_prompt_status=0

# WHICH READING ENDED THE WORKER. Both the floor and the monitor watcher end the
# prompt the same way — a signal into the loop's `wait` — so the flag alone
# cannot say which fired, and an operator reading `.plot-worker.log` needs to
# know: a monitor verdict says the agent stopped, the floor says nobody knows.
# `_ended_by` is set by whichever trap ran, and the message is written from it.
_ended_by=""
_ended_detail=""

# Kill a process and any descendants it spawned. The prompt child is
# `bash -c '. "$f"'`, which itself launches the agent CLI as a grandchild;
# killing only the immediate child would orphan that CLI, which is the very
# thing being bounded.
#
# THE ROOT DIES FIRST, then its descendants — but the descendants are SNAPSHOT
# before the root is killed. Two failures were measured and both are avoided:
#
#   * Reaping children BEFORE the root leaves a window in which the root shell —
#     the sourced prompt — sees `sleep` die and runs its NEXT line before the
#     kill reaches it (a `git push`, say, on a worktree the bound just declared
#     unmeasured). Measured: "SHOULD NOT PRINT" printed.
#   * Killing the root and THEN asking `pkill -P $root` finds nothing: SIGKILL
#     reparents the orphaned grandchild to init, so it no longer matches the
#     dead root's PID. Measured: the `sleep` leaked.
#
# So the child PIDs are collected first (`pgrep -P`), the root is killed to stop
# it spawning or advancing, then the snapshot is killed. The agent CLI the
# prompt had already launched is in that snapshot.
_kill_tree() { # $1 = root pid
  local root="$1" kid
  [ -n "$root" ] || return 0
  local kids
  kids=$(pgrep -P "$root" 2>/dev/null || true)
  kill -KILL "$root" 2>/dev/null || true
  for kid in $kids; do
    _kill_tree "$kid"
  done
}

# ---------------------------------------------------------------------------
# THE WATCHER'S READING — the verdict this loop now ends on
# ---------------------------------------------------------------------------
#
# `plot_worker_idle_now` (`plot-worker-state.sh`) answers the question the
# bound was guessing at, with six conditions that must hold together: the pid
# is alive, the conversation has spoken, its TRANSCRIPT has been silent past
# the window, no child process is burning CPU behind it, the tree has not
# moved for at least the window either, and commits already exist on the
# branch — one reading, since `bug/the-loop-reports-idle` removed the
# WorkerMonitor process and the two-pass comparison it existed to hold. The
# loop ASKS that rule through `plot_worker_idle_watch_pass` and does not
# re-derive it — a second implementation of one measurement is the drift this
# repo has already paid for, in the classification `plot-worker-state.sh` was
# extracted to hold.
#
# WHERE THE FINDINGS ARE. `plot-dispatch.sh` passes the monitor no
# `PLOT_MONITOR_FILE`, so a dispatched monitor writes to its own derived
# default. This is the SAME derivation, deliberately duplicated at one line
# rather than plumbed through: the wrapper starts the monitor, the loop is
# started BY the wrapper's command, and there is no env var travelling between
# them today. Reading `PLOT_MONITOR_FILE` first means the day the wrapper does
# pass one, this follows it without a second change.
monitor_findings_file() {
  printf '%s' "${PLOT_MONITOR_FILE:-${PLOT_WORKTREE:+$PLOT_WORKTREE/.plot-worker.monitor.worker.jsonl}}"
}

# Take one watcher pass and report whether IT judged `idle` this time.
#
# THE LOOP IS NOW THE ONLY PUBLISHER. Until `bug/the-loop-reports-idle` this
# read a file a SEPARATE WorkerMonitor process wrote to on its own cadence, and
# it read the LAST line because the monitor published a `clear` on recovery —
# a worktree whose agent stalled and resumed carried `idle` followed by `clear`,
# both forever, in one file. That file still exists and the board still reads
# it the same way, but nothing writes to it from outside this process any
# more: `plot_worker_idle_watch_pass` (`plot-worker-state.sh`) takes the six
# readings itself and appends the SAME shape, so the board's reader and
# `attention.ts` see no difference.
#
# ONE WORD BACK, NOT A FILE READ. The old function answered "what does the
# file's last line say", which could be stale by a whole interval; this
# answers "what did THIS pass just measure", which is what the caller needs to
# decide whether to signal.
#
# `idle` AND ONLY `idle`. A dead pid is not a reading this function can make at
# all — the watcher's own pid is alive by construction while it runs
# (`plot_worker_idle_watch_pass`'s own comment) — and `gone` is the wrapper's
# finding now, published after `wait "$agent"` returns in `plot-dispatch.sh`,
# never this loop's to read or act on.
monitor_says_idle() { # → 0 idle | 1 not idle
  local f
  f=$(monitor_findings_file)
  plot_worker_idle_watch_pass "${PLOT_WORKTREE:-$PWD}" "${PLOT_BRANCH:-}" "$f" \
    "$MONITOR_QUIET_SECONDS" "$_prompt_started_at" "$_watch_loop_pid"
}


# Could the agent's transcript be read for this worktree at all? `yes` | `no`.
#
# THE THIRD READING'S ONLY QUESTION. Wave 2 made `unavailable` a first-class
# answer and the monitor honours it by publishing NOTHING — it reports `unknown`
# and leaves the ending to `Worker bound`. That is deliberate and this slice does
# not touch it. But it means the loop reaches its floor by two different routes
# that were indistinguishable in the log: a monitor that measured and stayed
# silent, and a monitor that could never measure at all.
#
# ASKED ONCE, AFTER THE ENDING, ON THE FLOOR'S PATH ONLY. It sets no flag and
# gates nothing; a `no` here changes one sentence in one message. So the cost is
# one `stat` per ended worker, and a slow or wrong answer costs prose rather than
# work — which is why this may ask directly where the end condition may not.
#
# IT CLASSIFIES EXACTLY AS THE WATCHER DOES, and that is the whole
# requirement. `plot_worker_idle_watch_pass` withholds `idle` — publishing
# nothing and leaving the ending to the bound — on an empty silence reading and
# on a non-numeric one as well as on `unavailable` itself
# (`plot-worker-state.sh`'s own guard on `silence`). A digit is the only answer
# that means a reading was made. So the digit is what this matches, and every
# other answer is `no`; matching only the literal word
# would report *the reading was available* for a reader that failed silently,
# which is the sentence this slice exists to stop printing.
#
# THE ANSWER IS ABOUT NOW, NOT ABOUT THE RUN. A transcript deleted between the
# ending and this call reads `unavailable` though the watcher saw one all along.
# That window is the seconds between a signal and a message, and the correction
# it would need — recording each pass's availability across a run — is a fact the
# watcher holds and does not publish. The narrower claim is left as the honest
# one rather than plumbing a channel for a sentence.
ended_reading_available() { # → yes | no
  command -v plot_transcript_quiet_seconds >/dev/null 2>&1 || { printf 'no'; return 0; }
  case "$(plot_transcript_quiet_seconds "${PLOT_WORKTREE:-$PWD}" 2>/dev/null)" in
    ''|*[!0-9]*) printf 'no' ;;
    *)           printf 'yes' ;;
  esac
}

# A WATCHER FIRED. Either the floor's watchdog (SIGALRM) or the monitor watcher
# (SIGUSR1) sent a signal; record which, and end the prompt (and the agent CLI
# it spawned). The flag is what `run_bounded` reads after `wait` returns to tell
# an ending from an honest finish, and `_ended_by` is what the message reads to
# name the reading.
#
# TWO SIGNALS, NOT ONE SHARED FLAG. Both watchers race the same prompt and
# either may win — a monitor that publishes `idle` in the same second the floor
# expires is not a contrived case, it is what a dying monitor's last finding
# looks like. Separate signals mean the trap that ran is the one that answers,
# and no watcher has to inspect another's state to know whether it lost.
_on_alarm() {
  _timed_out=1
  _ended_by='bound'
  _ended_detail="exceeded the ${WORKER_BOUND_SECONDS}s bound"
  [ -n "$_prompt_child" ] && _kill_tree "$_prompt_child"
}
trap _on_alarm ALRM

# The watcher published `idle`: the agent is alive, has committed, its
# transcript has been silent past the window with nothing burning CPU behind
# it, and its tree has not moved for at least the window either — one reading,
# since `bug/the-loop-reports-idle` removed the WorkerMonitor process and the
# two-pass comparison it existed to hold. That is the reading the bound was
# guessing at, and it is a verdict rather than an alarm.
_on_monitor() {
  _timed_out=1
  _ended_by='monitor'
  _ended_detail='the watcher reported idle'
  [ -n "$_prompt_child" ] && _kill_tree "$_prompt_child"
}
trap _on_monitor USR1

# THE MANIFEST IS REMOVED ON EVERY EXIT PATH. A worker that ends stops
# appearing in the registry the moment it exits — the board's next pulse
# will no longer see its row. The trap fires whether the loop ended normally
# (--next returned no more work), broke on a failed cd or lost claim race,
# or timed out via SIGALRM.
#
# THE SWEEP STAYS. A trap cannot run on SIGKILL, so the reconciliation sweep
# is still the thing that catches a worker killed outright (kill -9). This
# trap answers "I am leaving" — a cheaper, immediate cleanup. Reconciliation
# answers "which entries no longer correspond to anything?" — a periodic
# sweep that handles SIGKILL and orphaned manifests from crashes.
_cleanup_on_exit() {
  # Remove the manifest first — it is the externally visible registration.
  [ -n "${PLOT_MANIFEST_FILE:-}" ] && [ -f "$PLOT_MANIFEST_FILE" ] && rm -f "$PLOT_MANIFEST_FILE"

  # Then clean up the watchdog, the monitor watcher and the prompt child (if any
  # are still running). THE WATCHER IS REAPED ON EVERY PATH the watchdog is, and
  # for the same reason recorded there: a watcher that outlived its worker would
  # be a new leak inside the fix for a leak.
  [ -n "$_watchdog_pid" ] && _kill_tree "$_watchdog_pid"
  [ -n "$_monitor_watcher_pid" ] && _kill_tree "$_monitor_watcher_pid"
  [ -n "$_prompt_child" ] && _kill_tree "$_prompt_child"
  # A STOPPED AGENT MAY HAVE BEEN WAITING RATHER THAN WORKING. `--stop` sends
  # SIGTERM and this trap runs; the sleep it was inside is a child, so it must
  # be reaped here like every other one.
  [ -n "$_wait_sleep_pid" ] && _kill_tree "$_wait_sleep_pid"
  _watchdog_pid=""
  _monitor_watcher_pid=""
  _prompt_child=""
  _wait_sleep_pid=""
  # A WORKER THAT IS LEAVING IS NOT WAITING. The record says *this desk is
  # waiting out a limit until <time>*, and a gone worker is waiting for
  # nothing; the monitor and `--status` both read it, so a record left behind
  # would report a wait that no process is serving. The `end-limited` path
  # clears it before writing its marker for the same reason.
  clear_limited_record "${PLOT_WORKTREE:-$PWD}"
}
# Through `plot-tmp.sh`'s one exit registry, which owns EXIT, INT and TERM. The
# ALRM and USR1 traps above stay this script's own.
plot_on_exit _cleanup_on_exit

# Run the prompt under BOTH readings. Returns 0 if it finished on its own
# (whatever its own exit status), or 124 — timeout(1)'s convention — if either
# watcher ended it. `_ended_by` says which, and the caller writes the message
# from that.
#
# TWO WATCHERS, ONE MECHANISM. Both are background subshells that signal the
# loop's own PID, both are answered by a trap that sets the flag and kills the
# prompt tree, and the loop merely `wait`s. That shape was chosen for the bound
# after a `wait -n` version was measured returning instantly on macOS's stock
# bash 3.2 — reading every prompt as an honest finish and never firing — and the
# system that lacks `wait -n` is the same one that lacks `timeout(1)`, so the
# monitor watcher reuses it rather than inventing a second answer.
#
# THE MONITOR WATCHER IS ARMED EVEN WHEN THE FLOOR IS NOT. `Worker bound: 0`
# disables the wall-clock kill, which is what a project asked for when it set
# it; it never asked for an unwatchable worker, and a finding is not a clock.
#
# THE PROMPT CHILD'S OWN EXIT CODE IS NOW KEPT, in `_prompt_status`. It was
# discarded until 2026-09-05: `wait` collected it and the function returned a
# bare 0, so this returned 0 or 124 and nothing else. A `claude` that refused
# outright — *"Session ID … is already in use"*, measured on three agents that
# day — exited non-zero in under a second and read as a completed slice, so the
# loop sealed a declaration for work nobody did and hopped. The caller reads the
# status to tell a prompt that FAILED from one that FINISHED; the return value
# still says only whether a watcher ended it, because the two questions are
# different and a caller that conflated them would report a bound expiry for a
# refused command.
run_bounded() {
  _timed_out=0
  _ended_by=""
  _ended_detail=""
  _prompt_status=0

  # THE PREVIOUS PROMPT'S CAPTURE GOES HERE, not when the exit was classified.
  # The classifier reads the file AFTER this function returns, so removing it
  # on the way out would leave nothing to read; removing it on the way in keeps
  # exactly one prompt's output on disk at a time, which is what stops a long
  # retry sequence or a hop from accumulating them.
  [ -n "$_prompt_out_file" ] && rm -f "$_prompt_out_file" 2>/dev/null
  _prompt_out_file=""

  # THE SESSION DECISION IS MADE HERE, ONCE PER PROMPT, and travels to the
  # prompt file as two exported variables it interpolates without knowing the
  # rule. `PLOT_SESSION_FLAG` is `--session-id` or `--resume`;
  # `PLOT_SESSION_ID` carries the handle the flag applies to.
  #
  # `PLOT_SESSION_ID` IS REWRITTEN RATHER THAN JOINED BY A THIRD NAME. The
  # prompt already guards this one variable — `[ -n … ]`, with a paragraph about
  # why an empty value must never become an argument — and a second name would
  # need a second guard in the one file every project rewrites for itself. On a
  # first slice the value it receives is the launch id it received before, so
  # nothing about an unhopped agent changes.
  #
  # IT IS EXPORTED ON EVERY PASS because the answer changes between them: the
  # first prompt writes the transcript that makes the second read `--resume`.
  export PLOT_SESSION_FLAG
  PLOT_SESSION_FLAG=$(session_flag)
  export PLOT_SESSION_ID
  PLOT_SESSION_ID=$(session_handle) || PLOT_SESSION_ID=""

  # WHERE A CORRECTION WOULD BE, exported so a project's prompt may name the
  # file in its own wording. It is the PATH and not the text: the prompt is
  # sourced afresh on every pass, and a correction written between two passes is
  # read from the desk rather than carried in an environment that was set before
  # it existed.
  #
  # IT IS EXPORTED WHETHER OR NOT A CORRECTION EXISTS, and the absence is the
  # agent's to observe. A variable that appeared only on a corrected pass would
  # make a project's prompt guard on its presence, which is a second rule about
  # the same fact the file already states by existing.
  export PLOT_CORRECTION_FILE
  PLOT_CORRECTION_FILE="${PLOT_WORKTREE:-$PWD}/$(correction_file_name)"

  # THE PROMPT DOES NOT INHERIT `PLOT_REPO_ROOT`. The supervisor's unit sets it
  # for the scripts the supervisor runs, and plain inheritance carried it into
  # every test an agent ran. `plot-config.sh` prefers it over the sandbox's own
  # repository, so a test that dispatched into a temp repo read the HOST's
  # absolute `Agent registry` and wrote its manifest there. Measured 2026-10-02:
  # 9 `feature/caps` manifests from `capabilities.test.mjs` in this estate's
  # registry, which the supervisor counted against the cap and started nobody.
  # The loop keeps the variable; only the agent's process tree loses it. `env`
  # replaces itself with `bash`, so `$!` is still the prompt.
  # THE OUTPUT IS CAPTURED AS WELL AS SHOWN, because the exit is now CLASSIFIED
  # rather than read from the status alone. `promptExit` is asked what the last
  # 200 lines say, and a harness that stopped on the account's usage limit says
  # so in a line nothing read before #1141.
  #
  # PROCESS SUBSTITUTION, NEVER A PIPELINE. `… | tee … &` puts `$!` on `tee`,
  # so `_prompt_child` would name the wrong process: the bound's `_kill_tree`
  # would kill the tee and orphan the agent CLI, the idle watcher's signal
  # would reach a process that is not the prompt, and `--stop` would leave the
  # agent running. All three round-2 jurors measured that, and the test below
  # the bound asserts no prompt process survives it.
  #
  # `tee -a` TO A FILE THE REGISTRY OWNS, through `plot-tmp.sh` like every
  # other temp path here. The file is per-prompt and removed when the function
  # returns, so a long slice's output does not accumulate across a hop.
  # `plot_tmpfile` assigns BY NAME through `printf -v`, which is why the
  # variable is not visibly written here — the substitution form is what
  # `scripts/check-temp-paths.sh` refuses, because it removes or leaks the path.
  #
  # ONE TEE PER STREAM, so stdout stays stdout and stderr stays stderr. A
  # `2>&1` into one tee sends the prompt's stderr to the loop's stdout, and a
  # reader of the loop's stderr then sees nothing the prompt said there. Both
  # tees append to the one capture file, which is all the classifier reads.
  plot_tmpfile _prompt_out_file prompt-out
  # shellcheck source=/dev/null
  env -u PLOT_REPO_ROOT bash -c '. "$1"' _ "$prompt_file" \
    > >(tee -a "$_prompt_out_file") 2> >(tee -a "$_prompt_out_file" >&2) &
  _prompt_child=$!
  _prompt_started_at=$(clock_now)

  # The floor's watchdog: after the bound, signal the loop's own PID. A compound
  # subshell (`sleep; kill`) rather than `sleep && kill` so a killed sleep still
  # cannot fire, and so `$$` inside it is the loop, not the subshell.
  #
  # SKIPPED ENTIRELY at a non-positive bound, rather than armed with a huge
  # number: an explicitly disabled floor should leave no sleeping process behind
  # to reason about.
  if [ "$WORKER_BOUND_SECONDS" -gt 0 ]; then
    ( sleep "$WORKER_BOUND_SECONDS"; kill -ALRM "$$" 2>/dev/null ) &
    _watchdog_pid=$!
  fi

  # The watcher: take the six readings every `MONITOR_INTERVAL_SECONDS`, ask
  # `plot_worker_idle_now`, and publish into the findings file on a change.
  #
  # IT ALWAYS STARTS, REGARDLESS OF THE FLAG. Since `bug/the-loop-reports-idle`
  # removed the WorkerMonitor process this watcher is the ONLY publisher of
  # `idle` — there is no other process left to publish it if this one does not
  # run. `MONITOR_ENDS_WORKER` now gates one thing, the `kill -USR1` below, and
  # nothing about whether a pass is taken or a finding published.
  #
  # IT EXITS AFTER SIGNALLING, never before. A watcher that kept polling after
  # signalling would re-signal a loop already past its `wait` and into the next
  # slice, killing a prompt on the strength of the PREVIOUS branch's finding.
  # `_watch_loop_pid` is captured before the subshell so `$$` inside it names
  # the loop rather than the subshell, exactly as the watchdog does.
  #
  # `PLOT_WATCH_PUBLISHED` IS THE SUBSHELL'S OWN. `plot_worker_idle_watch_pass`
  # holds the last-published finding in that variable so a held finding is
  # published once rather than every pass — exactly the role `published` played
  # inside the old monitor's own process. It dies with this subshell at the end
  # of each prompt, which is fine: no finding is judged between prompts, and a
  # fresh prompt starting a fresh watcher has nothing stale to carry over.
  local _watch_loop_pid=$$
  (
    unset PLOT_WATCH_PUBLISHED PLOT_WATCH_SINCE
    while :; do
      sleep "$MONITOR_INTERVAL_SECONDS" || exit 0
      if monitor_says_idle && [ "$MONITOR_ENDS_WORKER" = "1" ]; then
        kill -USR1 "$_watch_loop_pid" 2>/dev/null
        exit 0
      fi
    done
  ) &
  _monitor_watcher_pid=$!

  # Block on the prompt. If either watcher fires first, its trap kills the prompt
  # and this `wait` returns (interrupted); if the prompt finishes first, `wait`
  # returns normally and both watchers are still going. Either way, read the flag
  # — set only by a trap — to tell which happened.
  wait "$_prompt_child" 2>/dev/null
  _prompt_status=$?

  # Stop both watchers (a no-op for one that already fired) and reap their sleeps.
  #
  # NO `wait` ON A PID WE JUST SIGKILLED. Both lines used to be
  # `_kill_tree "$p"; wait "$p" 2>/dev/null || true`, and the `wait` on the
  # WATCHDOG is where the loop hung — measured on CI, not inferred: stage
  # markers around each call stopped at "B: waiting on watchdog" and never
  # printed C, D or E (PR #563, run 33393895431).
  #
  # WHY REMOVING IT IS SAFE, INDEPENDENT OF WHY IT BLOCKED. The status neither
  # `wait` collects is read by anything — the return is swallowed by
  # `|| true`, and no branch below consults it. Their only purpose was reaping,
  # which `_kill_tree`'s SIGKILL already did. The EXIT trap
  # (`_cleanup_on_exit`) has always called `_kill_tree` on both pids with NO
  # `wait` at all, so this makes the two paths agree rather than inventing a
  # new one.
  #
  # WHY IT HUNG is still open, and deliberately not guessed at here. The
  # watchdog is `( sleep "$BOUND"; kill -ALRM "$$" )` — the subshell that just
  # fired the signal that brought us here — so the loop was waiting on a
  # process mid-signal-delivery. That is consistent with every occurrence
  # landing on a `bound: 1` fixture, the only case where the watchdog fires
  # while the loop is still inside its own `wait`. It does not reproduce on
  # macOS bash 5.3 in ~60 attempts, so the mechanism is Linux-side and the fix
  # rests on what the line DOES, not on a theory of why it blocks.
  [ -n "$_watchdog_pid" ] && _kill_tree "$_watchdog_pid"
  _kill_tree "$_monitor_watcher_pid"
  _watchdog_pid=""
  _monitor_watcher_pid=""
  _prompt_child=""

  [ "$_timed_out" = 1 ] && return 124
  return 0
}

# ---------------------------------------------------------------------------
# WAITING — what a free agent does instead of dying
# ---------------------------------------------------------------------------
#
# THE LINE THIS REPLACES WAS `|| break`. An agent that found no claimable slice
# ended itself, and two departures from the model rode on that one word.
# Measured 2026-09-03 on this estate: 0 live workers, 0 manifests, 4 desks
# standing, and eligible work on the board. Every agent had exited; none had
# failed.
#
#   AN AGENT HAD NO IDLE STATE. `an-agent-says-when-it-is-free` made `free`
#   derivable — `isAgentFree` in `packages/domain/src/rules/free.ts`, alive and
#   naming no branch — and `clear_manifest_branch` writes the empty value the
#   rule reads. But nothing survived long enough to BE free, because the loop
#   terminated on the same condition that would have reported it. The window
#   existed for the length of one `--next` call.
#
#   TERMINATION WAS THE AGENT'S OWN JUDGEMENT. Ending an agent is something
#   done TO it. `:891`'s bound and `:786`'s idle finding stay exactly as they
#   are, and the distinction is what they measure: a clock that expired and a
#   monitor that found nothing running are both readings about THIS AGENT. "No
#   work exists for my plan" is a judgement about the ESTATE, made by the one
#   party with no standing to make it.
#
# SO THE AGENT WAITS, AND THE WAIT REPORTS ITSELF. The manifest already names
# no branch — `clear_manifest_branch` ran before `--next` was asked — so an
# agent inside this function is `free` by the rule as written, with no flag to
# set and nothing new for a reader to learn. That is the whole reason `free`
# was made derivable first: this function had to add no state to be visible.
#
# WHAT IT WAITS ON, AND WHY IT IS A POLL. See `WAIT_POLL_SECONDS`. There is no
# channel to block on until the registry daemon exists, and building a stand-in
# for `feature/the-registry-supervises-its-agents` here would be a second
# registry the real one then has to displace.
#
# IT IS INTERRUPTIBLE, BY CONSTRUCTION. The sleep runs as a BACKGROUND child
# that the loop `wait`s on — the same shape `run_bounded` uses, for the same
# reason. Bash defers signal handling until a FOREGROUND command returns, so a
# plain `sleep 60` would swallow `plot-dispatch.sh --stop` for up to a minute
# and the EXIT trap would run late; a backgrounded sleep leaves the loop in
# `wait`, where a signal arrives at once. The sleep is killed on the way out so
# no orphan outlives the agent.
#
# IT IS BOUNDED, BY `Worker bound`. See `WAIT_BUDGET_SECONDS`. An exhausted
# budget ends the worker the same way an exhausted prompt does — exit 124, the
# floor's own convention — because it is the same floor.
#
# THE SLUG SCOPE IS GONE, AND THE REGISTRY IS WHAT WIDENED IT. This paragraph
# used to argue for keeping `--next "$PLOT_SLUG"`: an agent whose plan was
# finished waited beside an eligible slice of another plan, and taking one would
# have meant arriving at a desk with no brief. The agent no longer asks, so it
# no longer has a scope of its own — the registry reads every plan, refuses a
# slice with no brief at the hand-over, and sends the slug WITH the assignment.
# What the agent could not do for itself without overreaching is now simply
# somebody else's answer.
#
# `--why-nothing` KEEPS ITS SLUG, and that is a different scope. It decides one
# sentence for an operator watching this agent, and *nothing on your plan will
# open by itself* is the sentence they want — not a survey of the estate.
#
# @param $1 the reason `--next` was silent, as `--why-nothing` reported it
# @return 0 when a slice became available (the caller re-asks `--next`),
#         124 when the budget ran out, 124 when the manifest vanished mid-wait
wait_for_work() { # $1=outlook line: "<outlook>[<TAB><blocker>]..."
  # THE SEPARATOR IS A VARIABLE, not a literal in a `case` pattern. A bare tab
  # inside `case ... in (*<TAB>*)` is read as a word separator by bash and the
  # script does not parse at all — measured on the first draft of this function.
  local tab=$'\t'
  local outlook="${1%%$tab*}" blockers="" slept=0

  case "$1" in (*"$tab"*) blockers="${1#*$tab}" ;; esac

  # WHAT IT IS WAITING ON, NAMED, ONCE. A wait an operator cannot see the end
  # of is the stall this function exists to avoid being. `not-yet` names the
  # branches whose landing would open the slice; `none` has none to name, and
  # says so rather than printing an empty list.
  case "$outlook" in
    not-yet)
      echo "plot-worker-loop: free on ${PLOT_SLUG:-?} — nothing handed over yet, and $(printf '%s' "$blockers" | tr "$tab" ' ') has still to land. Reading the manifest every ${WAIT_POLL_SECONDS}s, for up to ${WAIT_BUDGET_SECONDS}s; stop it with /plot-fleet --stop" >&2
      ;;
    *)
      echo "plot-worker-loop: free on ${PLOT_SLUG:-?} — nothing handed over yet. Waiting to be handed work: reading the manifest every ${WAIT_POLL_SECONDS}s, for up to ${WAIT_BUDGET_SECONDS}s; stop it with /plot-fleet --stop" >&2
      ;;
  esac

  while :; do
    # A NON-POSITIVE BUDGET IS NO BOUND, exactly as it is for the floor — the
    # same key, so the same reading of `0`. The agent then waits until it is
    # stopped, which is what a project disabling the wall-clock kill asked for.
    if [ "$WAIT_BUDGET_SECONDS" -gt 0 ] && [ "$slept" -ge "$WAIT_BUDGET_SECONDS" ]; then
      # A FOURTH ENDING, AND IT IS NOT ONE OF THE THREE. The three readings
      # above — the agent went quiet, the bound expired, nobody could tell —
      # all say something ended a PROMPT, and an operator reading
      # `.plot-worker.log` triages them by asking what state the desk is in.
      # This one ends a WAIT: no prompt was running, nothing was cut short, and
      # the desk is clean by construction because the agent got here by
      # finishing. So it leads with its own clause and does not say "ending
      # worker without hopping", which is the phrase that marks the other
      # three. `workerloop.test.mjs` holds that partition.
      echo "plot-worker-loop: the wait ran out on ${PLOT_SLUG:-?} — free for ${slept}s with no slice offered, past the ${WAIT_BUDGET_SECONDS}s wait bound; ending worker. Nothing was cut short: no prompt was running, the agent holds no branch, and its work is pushed." >&2
      return 124
    fi

    sleep "$WAIT_POLL_SECONDS" &
    _wait_sleep_pid=$!
    wait "$_wait_sleep_pid" 2>/dev/null
    _kill_tree "$_wait_sleep_pid"
    _wait_sleep_pid=""
    slept=$((slept + WAIT_POLL_SECONDS))

    # THE ASK IS THE AGENT'S OWN MANIFEST, and it is a file read rather than a
    # 12.7 s scan. That is the second thing removing `--next` bought: the wait
    # used to run a whole fleet scan per pass to find out whether anything had
    # become claimable, and it now reads one small JSON file to find out whether
    # anything was handed over. The poll interval could be shortened on that
    # cost alone; it is left where it is because the registry's tick is what
    # decides how often the answer can change.
    if assigned_branch "${PLOT_MANIFEST_FILE:-}" >/dev/null; then
      echo "plot-worker-loop: taken up on ${PLOT_SLUG:-?} after waiting ${slept}s — the registry handed over a slice." >&2
      return 0
    fi

    # THE MANIFEST ITSELF MAY HAVE VANISHED. `#1101` measured a continuation
    # that spawned a loop with NO `PLOT_MANIFEST_FILE` at all — `unset`, which
    # keeps waiting, exactly as it always has. This is the other shape: a NAME
    # naming a manifest the registry has since removed. `unset` must not take
    # this branch, which is why `loop_registration` reads `[ -z ]` before
    # `[ -f ]` rather than folding the two into one test.
    case "$(loop_registration "${PLOT_MANIFEST_FILE:-}")" in
      gone)
        echo "plot-worker-loop: the manifest named at ${PLOT_MANIFEST_FILE} is gone — ending worker. Nothing was cut short: no prompt was running and the agent holds no branch." >&2
        write_ending "$PLOT_WORKTREE" 'unregistered' 'agent' "${PLOT_BRANCH:-}" "the manifest named at ${PLOT_MANIFEST_FILE} is gone"
        return 124
        ;;
    esac
  done
}

while true; do
  # A BRANCHLESS AGENT WAITS; IT DOES NOT RUN THE PROMPT.
  #
  # `plot-dispatch.sh --start` brings agents into existence with no slice
  # assigned — free, registered, and waiting for the registry to hand one over.
  # An agent in that state reaches this line with `PLOT_BRANCH` empty, and the
  # whole of the block below is about a branch: `run_bounded` sources the
  # project's prompt, which begins *"You are implementing the branch
  # $PLOT_BRANCH"*, and `seal_declaration` writes a record naming it.
  #
  # Measured 2026-09-05: no guard on `PLOT_BRANCH` existed anywhere above this
  # line, so a branchless start ran the worker prompt with the variable empty —
  # an agent told to implement nothing, burning its bound on a sentence with a
  # hole in it, and arriving at the hand-over having already spent the run.
  #
  # THE WAIT IS NOT NEW AND NEITHER IS ITS SENTENCE. `wait_for_work` already
  # holds an agent that finished one slice and has not been handed the next, and
  # its own message already reads *"the agent holds no branch"*. What was
  # missing is REACHING it: the wait sits on the hop path, after a prompt has
  # already run. So the block below is skipped rather than duplicated, and a
  # free agent falls through to exactly the hand-over an agent between slices
  # takes.
  #
  # THE THREE SKIPPED STEPS ARE ALL ABOUT A FINISHED BRANCH, which is why
  # skipping them costs nothing: there is no prompt to bound, no branch to
  # declare, and no manifest field to clear — `--start` wrote it empty.
  if [ -n "${PLOT_BRANCH:-}" ]; then
  # Run the worker prompt in the current worktree, watched by both readings.
  # The prompt file is sourced (inside a child) so $PLOT_BRANCH etc. expand at
  # runtime. If either watcher fires the worker EXITS rather than hopping: an
  # agent that stopped has left the worktree in a state nobody measured, and
  # starting a second branch on top of that guess is worse than stopping. That
  # is `a-hung-child-does-not-hold-the-loop`'s 2026-08-25 property, and this
  # slice changed the READING rather than the protection.
  if ! run_bounded; then
    # THE MESSAGE NAMES WHICH READING ENDED IT, because the three mean
    # different things about the work in the worktree and an operator reading
    # `.plot-worker.log` triages them differently:
    #
    #   the agent went quiet   a verdict. The agent is alive, has committed, its
    #                          transcript has been silent past the window with
    #                          nothing burning CPU behind it, and its tree has
    #                          not moved for at least the window either. The
    #                          desk holds finished-looking work worth rescuing.
    #   the bound expired      only that time passed. The floor fires when the
    #                          monitor itself went silent, so nobody knows what
    #                          state the desk is in — but the reading WAS
    #                          available and said nothing.
    #   nobody could tell      no transcript can be read for this worktree, so
    #                          no reading distinguishes thinking from stuck. The
    #                          bound ended it and the reason is an ABSENCE.
    #
    # THE THIRD IS NEW WITH WAVE 2 and had no sentence before this slice: it
    # printed the bound's, which claims a measurement was made and came back
    # empty. `the-registry-supervises-its-agents` settles that an unprovided
    # capability is `unavailable` rather than failed or zero, and a log that
    # collapses it into a bound expiry hides that Plot never had the reading —
    # which is an adopter's `.plot/worker-prompt.sh` to fix, not an agent's.
    #
    # BOTH FLOOR ARMS STILL SAY "exceeded the Ns bound", and that is not a
    # leftover. The bound genuinely expired in both — it is what ended the
    # worker either way — and the two differ in what was known WHILE it ran, not
    # in what stopped it. A reader grepping for the bound must find every worker
    # the bound ended, so the phrase stays on both and the leading clause is what
    # separates them.
    case "$_ended_by" in
      monitor)
        echo "plot-worker-loop: the agent went quiet on ${PLOT_BRANCH:-?} — the watcher reported idle: the agent is alive and has committed but its transcript has been silent past the window with nothing burning CPU behind it, and its tree has not moved for at least the window either; ending worker without hopping" >&2
        # THE SAME THREE READINGS THE SENTENCES ABOVE DRAW, written where a
        # reader that outlives the process can find them. The log says it once
        # to whoever is watching; the record says it to whoever asks later.
        write_ending "${PLOT_WORKTREE:-$PWD}" quiet monitor "${PLOT_BRANCH:-}" "$_ended_detail"
        ;;
      *)
        # THE TRANSCRIPT IS ASKED ONLY HERE, on the floor's path, and only to
        # tell the second reading from the third. The monitor watcher fired on
        # neither, so nothing about the ending changes — this decides one
        # sentence.
        case "$(ended_reading_available)" in
          no)
            echo "plot-worker-loop: nobody could tell on ${PLOT_BRANCH:-?} — no transcript could be read for this worktree, so no reading distinguishes a thinking agent from a stopped one; the prompt exceeded the ${WORKER_BOUND_SECONDS}s bound and that is an absence of a reading, not a measurement. Pass --session-id from .plot/worker-prompt.sh to make the reading available; ending worker without hopping" >&2
            # THE FLOOR FIRED AND NOTHING COULD BE READ. The actor is the bound
            # either way; the reason is what separates this from the arm below,
            # and it is an ABSENCE of a reading rather than a measurement.
            write_ending "${PLOT_WORKTREE:-$PWD}" unreadable bound "${PLOT_BRANCH:-}" "$_ended_detail"
            ;;
          *)
            echo "plot-worker-loop: the bound expired on ${PLOT_BRANCH:-?} — the prompt exceeded the ${WORKER_BOUND_SECONDS}s bound with the agent's transcript readable, and no monitor finding said why; ending worker without hopping" >&2
            write_ending "${PLOT_WORKTREE:-$PWD}" bound bound "${PLOT_BRANCH:-}" "$_ended_detail"
            ;;
        esac
        ;;
    esac
    exit 124
  fi

  # ---------------------------------------------------------------------------
  # THE PROMPT RAN AND FAILED — a fourth ending, and the only one no watcher saw
  # ---------------------------------------------------------------------------
  #
  # `run_bounded` RETURNED 0, WHICH USED TO MEAN THE SLICE FINISHED. The prompt
  # child's own exit code was collected by `wait` and discarded, so a `claude`
  # that refused outright reached this line indistinguishable from one that
  # worked for six hours. Measured 2026-09-05 on three agents at once:
  # `Error: Session ID … is already in use`, an exit in under a second, and a
  # loop that sealed a declaration, cleared its branch and reported itself free.
  # Every exit code involved was zero, so the board rendered `running · idle`
  # and what found it was a person reading a log.
  #
  # THE SLICE STAYS CLAIMED. `clear_manifest_branch` below is what returns a
  # slice to the queue, and it is not reached on this path: the agent still
  # holds the desk, the claim ref and the branch, so nothing else may be handed
  # them. A `continue` re-enters the loop with `$PLOT_BRANCH` unchanged and runs
  # the prompt again, which is the retry.
  #
  # THE RETRY IS BOUNDED ON `attempts`, or the agent spins for the full
  # `Worker bound`. Past the budget the worker ENDS: an ending record naming
  # what the runtime said, a `PLOT-BLOCKED` marker so the desk reads as owing a
  # person an answer rather than as reapable, and a non-zero exit.
  #
  # THE ACTOR IS `agent`. The agent's own process ran the command and received
  # the refusal; `bound` and `monitor` name watchers that did not fire here.
  # This is `EndingActorSchema`'s only unwritten value getting its first writer,
  # and no actor is invented for the runtime — `detail` is where the text that
  # separates one ending from another already goes.
  #
  # THE EXIT IS 1 AND DELIBERATELY NOT 124. `plot-worker-state.sh` answers
  # `failed` on any non-zero code, which is all this path needs; 124 is the
  # bound's own number and reading it here would tell an operator a clock fired.
  # THE EXIT IS CLASSIFIED BEFORE THE STATUS IS TESTED, because a usage limit
  # is not always a non-zero exit: a harness may print the limit line and exit
  # 0, and the rule reads a status-0 run's LAST non-empty line for exactly
  # that. Testing the status first would send such a run down the finished-slice
  # path and seal a declaration for work the limit stopped.
  _ran_seconds=$(( $(clock_now) - _prompt_started_at ))
  [ "$_ran_seconds" -lt 0 ] && _ran_seconds=0
  _commits_since_wait=0
  if [ "$_after_wait" = "1" ] && [ -n "$_wait_head" ]; then
    _commits_since_wait=$(git -C "${PLOT_WORKTREE:-$PWD}" rev-list --count \
      "$_wait_head..HEAD" 2>/dev/null) || _commits_since_wait=0
    case "$_commits_since_wait" in (''|*[!0-9]*) _commits_since_wait=0 ;; esac
  fi
  _exit_answer=$(ask_prompt_exit "$_prompt_status" "$_ran_seconds" "$_commits_since_wait")
  _exit_verdict=${_exit_answer%%$'\t'*}

  # ---------------------------------------------------------------------------
  # THE ACCOUNT HIT ITS USAGE LIMIT — and the loop waits rather than retrying
  # ---------------------------------------------------------------------------
  #
  # `attempts` IS NOT RAISED. The budget exists to stop a spin on a broken
  # invocation, and a limit is the opposite reading: the invocation worked and
  # the account is out of capacity. Spending the budget here is what made #1141
  # end a working agent in 974 ms.
  #
  # THE SLICE IS NOT RELEASED AND THE DESK IS NOT RESET. `continue` re-enters
  # the loop with `$PLOT_BRANCH` unchanged, so the agent resumes the same slice
  # with its work still on the floor.
  if [ "$_exit_verdict" = "wait" ]; then
    _limit_reset=$(printf '%s' "$_exit_answer" | cut -f2)
    _limit_iso=$(printf '%s' "$_exit_answer" | cut -f3)
    _limit_line=$(printf '%s' "$_exit_answer" | cut -f4-)
    write_limited_record "${PLOT_WORKTREE:-$PWD}" "$_limit_reset" "$_limit_iso" "$_limit_line"
    # THE DESK'S `HEAD` AT THE START OF THE WAIT, which is what makes the next
    # exit's progress reading possible: a limit that returns with no commit
    # since this oid is a limit that is not lifting.
    _wait_head=$(git -C "${PLOT_WORKTREE:-$PWD}" rev-parse HEAD 2>/dev/null) || _wait_head=""
    _after_wait=1
    echo "plot-worker-loop: usage limit on ${PLOT_BRANCH:-?} until $_limit_iso; waiting" >&2
    sleep_until_reset "$_limit_reset"
    continue
  fi

  # ---------------------------------------------------------------------------
  # A LIMIT THE LOOP MAY NOT WAIT OUT — a sixth ending, and nothing to repair
  # ---------------------------------------------------------------------------
  #
  # THREE GATES, AND THE RULE SAYS WHICH. `no-reset` is a limit whose reset
  # could not be read, `past-bound` a reset further away than `Worker bound`,
  # and `no-progress` a limit that returned without the desk gaining a commit.
  #
  # NO PROMPT FIX IS NAMED. That sentence is `unstarted`'s and it is false
  # here: the invocation worked. The marker asks for time and names
  # `--restart`, which is what resumes the slice once the limit lifts.
  if [ "$_exit_verdict" = "end-limited" ]; then
    _limit_reset=$(printf '%s' "$_exit_answer" | cut -f2)
    _limit_iso=$(printf '%s' "$_exit_answer" | cut -f3)
    _limit_cause=$(printf '%s' "$_exit_answer" | cut -f4)
    _limit_line=$(printf '%s' "$_exit_answer" | cut -f5-)
    _limit_until="with no reset time"
    [ "$_limit_reset" != "unknown" ] && _limit_until="until $_limit_iso"
    clear_limited_record "${PLOT_WORKTREE:-$PWD}"
    echo "plot-worker-loop: the account hit its usage limit on ${PLOT_BRANCH:-?} $_limit_until ($_limit_cause) — the prompt ran and the harness stopped. The slice stays claimed and a person is asked; ending worker.$(desk_holding_clause "${PLOT_WORKTREE:-$PWD}")" >&2
    write_ending "${PLOT_WORKTREE:-$PWD}" limited agent "${PLOT_BRANCH:-}" \
      "the harness stopped on the account's usage limit $_limit_until ($_limit_cause)"
    write_blocked_marker "${PLOT_WORKTREE:-$PWD}" \
      "PLOT-BLOCKED: the account hit its usage limit while \`${PLOT_BRANCH:-?}\` was being worked, $_limit_until. The harness reported:

> $_limit_line

Nothing is broken and there is nothing to fix in the prompt — the invocation worked and the account is out of capacity.$(desk_holding_clause "${PLOT_WORKTREE:-$PWD}") The slice is still claimed by this agent and its work is still in the desk. Once the limit lifts, restart this agent with \`/plot-dispatch --restart ${PLOT_BRANCH:-<branch>}\`."
    exit 1
  fi

  if [ "$_exit_verdict" = "unstarted" ]; then
    _start_attempts=$(manifest_attempts "${PLOT_MANIFEST_FILE:-}")
    if [ "$_start_attempts" -lt "$START_ATTEMPT_BUDGET" ]; then
      raise_manifest_attempts "${PLOT_MANIFEST_FILE:-}"
      # THE SENTENCE READS THE DESK. It said *"the desk is untouched"*
      # unconditionally until this slice, and #1141's desk held two pushed
      # commits and ten uncommitted files while it was printed. The clause is
      # empty where both counts are zero, so a genuinely untouched desk keeps
      # the sentence it always had.
      echo "plot-worker-loop: the prompt failed to run on ${PLOT_BRANCH:-?} — the command exited $_prompt_status without the agent doing any work. The slice stays claimed; retrying ($(( _start_attempts + 1 )) of $START_ATTEMPT_BUDGET).$(desk_holding_clause "${PLOT_WORKTREE:-$PWD}")" >&2
      continue
    fi
    echo "plot-worker-loop: the prompt never started on ${PLOT_BRANCH:-?} — the command exited $_prompt_status on each of $START_ATTEMPT_BUDGET attempts. The slice stays claimed and a person is asked; ending worker.$(desk_holding_clause "${PLOT_WORKTREE:-$PWD}")" >&2
    write_ending "${PLOT_WORKTREE:-$PWD}" unstarted agent "${PLOT_BRANCH:-}" \
      "the worker prompt exited $_prompt_status without running, on $START_ATTEMPT_BUDGET attempts"
    write_blocked_marker "${PLOT_WORKTREE:-$PWD}" \
      "PLOT-BLOCKED: the worker prompt for \`${PLOT_BRANCH:-?}\` exited $_prompt_status without running, $START_ATTEMPT_BUDGET times.$(desk_holding_clause "${PLOT_WORKTREE:-$PWD}") The slice is still claimed by this agent. Read \`.plot-worker.log\` for what the runtime said, fix the invocation in the prompt file, then restart this agent with \`/plot-dispatch --restart ${PLOT_BRANCH:-<branch>}\`."
    exit 1
  fi

  # THE PROMPT RAN. A limit record from an earlier wait is removed here: the
  # slice is finishing, and a stale record would tell the monitor and
  # `--status` that this desk is still waiting.
  clear_limited_record "${PLOT_WORKTREE:-$PWD}"

  # ---------------------------------------------------------------------------
  # THE DESK HOLDS UNLANDED WORK — a ninth ending, asked before any of the
  # three acts that give the desk away
  # ---------------------------------------------------------------------------
  #
  # Measured 2026-10-03 and 2026-10-04 (#1246): an agent ended its turn while it
  # waited on a background job, the loop found the desk dirty, cut a new desk
  # for the next slice and left 14 files behind — twice, each time found by a
  # person on a desk no agent and no manifest named.
  #
  # THE SAME QUESTION THE HOP ALREADY ASKS, asked here first. `desk_reset_refusal`
  # is the shell side of `resetRefusals`, and a second rule asking the same three
  # questions is what `corpus/desk-reset.corpus.test.ts` exists to prevent.
  #
  # THE WORD, NOT THE STATUS. The function returns 0 for `blocked-marker` too —
  # a desk holding an agent-written `PLOT-BLOCKED` keeps today's path, because
  # the marker already tells a person. Only `uncommitted-changes` and
  # `unpushed-commits` are unlanded work this slice is about.
  #
  # BEFORE `wait_for_checks` AND THE BUILD-FAILED ARM, not after. Unpushed
  # commits have no CI run to wait on, and a dirty tree is not what the checks
  # measure — waiting here would ask a question this desk cannot answer.
  #
  # BEFORE `seal_declaration`, `record_slice_spend` AND `clear_manifest_branch`,
  # which is the position the mechanism depends on. After any of them the agent
  # has already declared the slice finished and given the branch back to the
  # queue, so the manifest would read this agent as free while its desk still
  # holds the work.
  #
  # ASKED A SECOND TIME RIGHT BEFORE `seal_declaration`, through the same
  # function: a background job that writes during `wait_for_checks` leaves the
  # desk dirty after the first answer, and the hop would cut a new desk for it.
  end_if_holding_work

  # ---------------------------------------------------------------------------
  # THE BUILD FAILED — a fifth ending, and the first one Plot corrects instead
  # ---------------------------------------------------------------------------
  #
  # THE PROMPT RAN AND THE AGENT PUSHED. Every reading above says the slice
  # finished, and until this slice that was the end of it: the declaration was
  # sealed, the branch cleared, and CI's verdict arrived minutes later with
  # nobody left reading it.
  #
  # SO THIS IS ASKED BEFORE THE DECLARATION AND BEFORE THE BRANCH IS CLEARED,
  # and the position is the whole mechanism rather than a tidy place to put it.
  # Both writes below are about a FINISHED branch — `seal_declaration` records
  # what the agent did, `clear_manifest_branch` returns the slice to the queue —
  # and a corrected agent has not finished. Asking after either would mean
  # correcting an agent that had already let go of the desk, the claim, and the
  # branch, with the slice available for somebody else to be handed.
  #
  # THE CORRECTION IS A FILE IN THE DESK, and that is structural rather than
  # convenient. A build's verdict arrives minutes after the push, so it cannot be
  # a return value: the monitor publishes when it learns and the loop consumes
  # when it next looks. The agent may be mid-slice, already hopped, or dead — a
  # file survives all three, and the loop already reads the desk on every pass to
  # decide whether it is resettable.
  #
  # WHY A FILE AND NOT A SENTENCE IN THE PROMPT. `.plot/worker-prompt.sh` belongs
  # to the adopting project (`plot-worker-loop.sh:19`) and Plot reads nothing back
  # out of it, so there is no line in it Plot may rewrite. What Plot exports is an
  # environment variable and what it writes is a file; the prompt's own standing
  # instruction to read the desk is what carries the correction to the agent.
  # `PLOT_CORRECTION_FILE` is exported beside it for a project that wants to name
  # the file in its own wording.
  #
  # THE FAILURE TEXT GOES IN VERBATIM. The monitor's `evidence` already reads
  # *"the run at <url> for <sha> concluded <conclusion>"* — the run URL and the
  # conclusion are what a person would read, and paraphrasing here is the same
  # error as a lookup table for context windows: usually right, and unexplainable
  # when wrong.
  #
  # THE AGENT NEVER CONTROLS THE RETRY. The budget is this loop's, read from
  # `Correction budget`, and counted in a manifest field the agent does not
  # write. An agent cannot extend it by declaring itself unfinished, and that is
  # the property separating a correction loop from an agent that never stops.
  #
  # RESUMING IS `session_flag`'s DECISION AND NOT THIS BLOCK'S. A correction
  # continues an existing conversation, so it wants `--resume` — but the flag is
  # decided by the transcript probe on the next pass through `run_bounded`, which
  # answers `--resume` for exactly the reason this path needs it and answers
  # `--session-id` when there is no transcript to resume. Hardcoding the flag here
  # would reintroduce the failure `session_flag` exists to prevent, in the one
  # place that most looks like it knows better.
  # THE CHECKS ARE WAITED FOR FIRST. CI reports minutes after the push, and the
  # question below reads only what the BuildMonitor has already published, so
  # without the wait it was asked before any answer could exist.
  wait_for_checks

  if [ -n "${PLOT_BRANCH:-}" ] && _correction=$(build_says_failed); then
    _corrections=$(manifest_corrections "${PLOT_MANIFEST_FILE:-}")
    if [ "$_corrections" -lt "$CORRECTION_BUDGET" ]; then
      raise_manifest_corrections "${PLOT_MANIFEST_FILE:-}"
      write_correction "${PLOT_WORKTREE:-$PWD}" "${PLOT_BRANCH:-}" \
        "$_correction" "$(( _corrections + 1 ))" "$CORRECTION_BUDGET"
      echo "plot-worker-loop: the build failed on ${PLOT_BRANCH:-?} — $_correction. The slice stays claimed and the desk is untouched; handing it back to the agent (correction $(( _corrections + 1 )) of $CORRECTION_BUDGET)." >&2
      continue
    fi

    # THE BUDGET'S END IS STILL A PERSON. Today's behaviour, reached later
    # rather than first: the correction loop does not remove the human gate, it
    # stops reaching for it on the first failure.
    #
    # THE MARKER SAYS HOW MANY ATTEMPTS WERE MADE AND WHAT FAILED EACH TIME, or
    # the person inherits a stopped agent with no account of what was tried. The
    # per-attempt text is in the correction file the desk still holds, so the
    # marker names it rather than re-stating findings this loop no longer has.
    #
    # IT GOES THROUGH `write_blocked_marker`, which refuses to overwrite. A
    # marker already in the tree is the agent's own question to a person, and
    # replacing it with Plot's would answer a question nobody asked. That
    # function also names the branch and the session that wrote it.
    echo "plot-worker-loop: the build kept failing on ${PLOT_BRANCH:-?} — $CORRECTION_BUDGET corrections were handed back and the last still failed: $_correction. The slice stays claimed and a person is asked; ending worker." >&2
    write_ending "${PLOT_WORKTREE:-$PWD}" corrections-spent agent "${PLOT_BRANCH:-}" \
      "the build failed on each of $CORRECTION_BUDGET corrections; the last was: $_correction"
    write_blocked_marker "${PLOT_WORKTREE:-$PWD}" \
      "PLOT-BLOCKED: the build for \`${PLOT_BRANCH:-?}\` failed after $CORRECTION_BUDGET corrections were handed back to the agent. The last failure: $_correction. Every attempt is recorded in \`$(correction_file_name)\` in this worktree, newest last. The work is pushed and the slice is still claimed by this agent. Read the run, fix what CI is failing on, then restart this agent with \`/plot-dispatch --restart ${PLOT_BRANCH:-<branch>}\`."
    exit 1
  fi

  # THE BRANCH FINISHED, so declare it — before `--next` is asked and before any
  # hop moves `$PLOT_BRANCH`. Both orderings matter: a declaration written after
  # the hop would name the branch the worker moved TO, and one written after the
  # loop ends would never exist for any branch but the last.
  #
  # THE DESK IS ASKED AGAIN FIRST — see `end_if_holding_work`. The checks wait
  # above can run for `Checks wait` seconds, and a late write in it is unlanded
  # work the first answer could not see.
  end_if_holding_work
  seal_declaration "${PLOT_WORKTREE:-$PWD}" "${PLOT_BRANCH:-}"

  # AND RECORD WHAT IT SPENT, at the same moment and for the same reason: this
  # is the last point at which `$PLOT_BRANCH` still names the branch that
  # finished. It records nothing and stays silent on every refusal, and cannot
  # change how this worker ends.
  record_slice_spend "${PLOT_WORKTREE:-$PWD}" "${PLOT_BRANCH:-}"

  # THE AGENT IS NOW FREE, so the manifest stops naming a slice — before
  # `--next` is asked, for the same reason the declaration is written before it.
  # From here until `update_manifest_on_hop` names the next branch, the agent
  # holds nothing, and a reader asking `free = alive AND no branch` gets the
  # true answer instead of the last one.
  #
  # THE ORDER WITH THE DECLARATION MATTERS ONE WAY ONLY: the declaration names
  # the branch that finished and must be written while `$PLOT_BRANCH` still
  # holds it. Clearing the manifest touches neither the variable nor the desk,
  # so it is safe on either side; it goes second because a reader that sees
  # `branch: ""` should already be able to find the declaration explaining what
  # the agent last did.
  if [ -n "${PLOT_MANIFEST_FILE:-}" ] && [ -f "$PLOT_MANIFEST_FILE" ]; then
    clear_manifest_branch "$PLOT_MANIFEST_FILE"
  fi
  # END of the branch-holding block. The body it closes is NOT re-indented: the
  # guard adds no behaviour to any line inside it, and shifting 85 commented
  # lines by two columns would destroy `git blame` for every one of them to say
  # nothing. Same measurement that scoped the domain package's arrow conversion.
  fi

  # Take the slice the registry handed over — see `assigned_branch`.
  #
  # `--offline --next` USED TO BE HERE and its whole trade went with it. That
  # flag existed because the scan asks the host and an unreachable host makes
  # every unmerged branch read `unknown`, which `--next` will not hand out — so
  # an agent stopped taking work whenever the host was down, silently. The
  # agent no longer asks the host, or git, or the plans: it reads one field of
  # its own manifest, so there is nothing left for a rate limit to break.
  #
  # WHAT IT COST WENT TOO, AND THE BILL HAD ARRIVED. The hop claimed on git
  # alone and could take a branch whose merge state nobody had verified,
  # accepted at the time because the claim push re-checked it. Measured
  # 2026-09-04: ten refs whose tip commit is `plot: claim <branch>` dated hours
  # after their own merge, one branch re-claimed twice 35 minutes after its ref
  # was deleted, and four waves held blocked behind it — the push cannot be the
  # check, because the merge DELETED the ref and the push simply re-creates it.
  # The registry checks before it assigns, so the push is a backstop.
  # ---------------------------------------------------------------------------
  # CREATE OR RESET — the agent decides what happens to its desk
  # ---------------------------------------------------------------------------
  #
  # THE HOP USED TO CREATE A DESK PER BRANCH and abandon the one it left.
  # Measured 2026-09-02 on this estate: 2 manifests, 11 worktrees, 8 loop
  # processes, 5 desks whose branch had already merged. An identity issued once
  # per agent was being issued once per slice, and `plot-reap.sh` — a backstop
  # with five refusals — was the only actor that ever removed one.
  #
  # THE AGENT DECIDES, BECAUSE IT IS THE ONLY PARTY THAT CAN SEE ITS OWN TREE.
  # The registry sees identities and the machine sees processes; neither sees an
  # uncommitted change, a `PLOT-BLOCKED` marker, or a checkout still holding
  # unpushed commits. So the decision is made here, at the desk, from two
  # readings `plot-worker-state.sh` already owns.
  #
  # TAKING OVER THE NEXT SLICE IS THE FREEING. When the desk is reset, the old
  # checkout ceases to exist because it became the new one — nothing is
  # abandoned, and `finished → reapable → gone` needs no separate step on the
  # normal path. `git worktree add` becomes the EXCEPTION: a full checkout is
  # paid once per agent rather than once per slice.
  #
  # SILENCE IS NOT A REASON TO DIE. This line read `|| break` until 2026-09-03
  # and that word was the whole of an agent's idle handling: no claimable slice
  # meant the process ended. It is now a wait — see `wait_for_work`, which owns
  # the argument, the bound and the sentence an operator reads.
  #
  # THE LOOP RE-READS RATHER THAN BEING HANDED THE ANSWER. `wait_for_work`
  # returns 0 when the manifest has just named a branch, and this line reads it
  # again instead of taking that answer through. The re-read is now a file read
  # rather than a fleet scan, so it costs almost nothing and still buys the
  # single take path: every branch this loop works came from the read on THIS
  # line, so nothing downstream has to know whether the agent waited.
  #
  # A SECOND SILENCE WAITS AGAIN. The re-read can come back empty — the
  # registry cleared the field, or wrote it between two of this agent's reads —
  # so the wait is re-entered rather than fallen out of.
  #
  # IT LOOPS HERE RATHER THAN `continue`ING TO THE TOP, and that changed with
  # the read. `continue` sent the agent back to `run_bounded`, which re-ran the
  # PROMPT on the branch it had just finished before asking again — acceptable
  # when the ask was a 12.7 s fleet scan and the loop was structured around it,
  # and pure waste now that the ask is a file read. A finished branch has
  # nothing left for its prompt to do, and running it again is how a clean desk
  # acquires a second empty commit.
  #
  # THE OUTLOOK IS STILL THE SCAN'S, AND IT DECIDES NOTHING. `--why-nothing`
  # names the branches whose landing would open a slice, which is the one
  # sentence an operator waiting needs and the manifest cannot supply. It is
  # asked ONCE per wait, on the way in, and never inside the poll.
  #
  # THE OUTLOOK IS ASKED ONLY OF AN AGENT THAT HAS A PLAN. A free agent started
  # by `plot-dispatch.sh --start` holds no slug, and `--why-nothing` with an
  # empty one walks the whole estate — an 18.3 s scan to produce a sentence that
  # would name branches belonging to plans this agent was never given. It has no
  # slice waiting on anything, so `none` is the true outlook: *nothing handed
  # over yet*, which is exactly what the wait's second arm already prints.
  while ! next_branch=$(assigned_branch "${PLOT_MANIFEST_FILE:-}"); do
    if [ -n "${PLOT_SLUG:-}" ]; then
      wait_for_work "$("$script_dir/plot-fleet-scan.sh" --offline --why-nothing "$PLOT_SLUG" 2>/dev/null)" || exit 124
    else
      wait_for_work none || exit 124
    fi
  done

  wt_root=$(dirname "$PLOT_WORKTREE")
  suffix=$(printf '%s' "$next_branch" | tr '/' '-')

  # ASKED ONCE, and the answer drives both arms. `desk_is_resettable` is the
  # same question and stays for its callers; here the refusal itself is wanted,
  # because the log names the condition and the prose reads off it.
  if ! desk_refusal=$(desk_reset_refusal "$PLOT_WORKTREE"); then
    hop_wt="$PLOT_WORKTREE"
    if ! reset_desk "$hop_wt" "$next_branch"; then
      echo "plot-worker-loop: could not reset the desk at $hop_wt onto $next_branch — leaving it as it is and creating a new one" >&2
      hop_wt="$wt_root/plot-wt-$suffix"
      git worktree add -b "$next_branch" "$hop_wt" "origin/$main_branch" 2>/dev/null || \
        git worktree add "$hop_wt" "$next_branch" 2>/dev/null || break
    fi
  else
    # THE DESK HOLDS SOMETHING NOBODY HAS ACCOUNTED FOR, so it is left exactly
    # as it is and a new one is cut. `feature/the-sweep-names-every-leftover`
    # owns what happens to it next; this loop's job is to not destroy it.
    # THE CONDITION IS NAMED, not just its prose. `blocked-marker` is the word
    # `rules/reapable.ts` uses, `plot-reap.sh` renders and an operator can
    # grep `.plot-worker.log` for — and a reset refused because a person owes
    # this desk an answer reads differently from one refused because a push
    # never happened. The loop said only "unlanded work" until this slice.
    echo "plot-worker-loop: the desk at $PLOT_WORKTREE is held by $desk_refusal ($(desk_hold_reason "$PLOT_WORKTREE")) — creating a new desk for $next_branch and leaving this one for the sweep" >&2
    hop_wt="$wt_root/plot-wt-$suffix"
    git worktree add -b "$next_branch" "$hop_wt" "origin/$main_branch" 2>/dev/null || \
      git worktree add "$hop_wt" "$next_branch" 2>/dev/null || break
  fi

  # SPOTLIGHT IS TOLD NOT TO INDEX THE DESK, on every path above — a desk that
  # was reset and one that was freshly cut both arrive here as `$hop_wt`.
  #
  # A desk is a full checkout plus its `node_modules`, and the fleet makes and
  # unmakes them all day. Measured 2026-09-04 on this estate: 21 desks totalling
  # 4.9 GB, with `mediaanalysisd` taking 32% of a machine whose load average was
  # 33. The file is Spotlight's own documented opt-out, needs no privilege, and
  # is inert everywhere else, so no `uname` guard earns its keep.
  #
  # IGNORED VIA `info/exclude`, NEVER VIA `.gitignore`. A `.gitignore` rule
  # lives in the branch's own content, so a desk cut from a branch older than
  # the rule would not see it — and an untracked file in a desk is not
  # cosmetic: `plot-worker-state.sh` reads it as unlanded work and answers
  # `stalled`, and `plot-reap.sh` refuses to remove a tree with uncommitted
  # changes. An unignored marker would make every desk look busy and
  # unreapable. `info/exclude` is per-REPOSITORY and shared by every worktree.
  #
  # Best-effort throughout: a desk that cannot take the marker still works.
  plot_desk_exclude "$hop_wt" '.metadata_never_index'
  : > "$hop_wt/.metadata_never_index" 2>/dev/null || true

  # Claim the branch with an empty commit.
  git -C "$hop_wt" commit --allow-empty -m "plot: claim $next_branch" 2>/dev/null

  # THE PUSH IS REJECTED, AND THAT IS NOT ROUTINE.
  #
  # This line read *"another worker won the race"* and removed the worktree
  # silently. Under the model this plan installs, the registry is the assignment
  # lock and the push is a backstop that should never fire — so a rejection is a
  # BUG REPORTING ITSELF: two agents were handed one slice. The estate is
  # already broken at the moment this branch is taken, and a silent `continue`
  # is the one response that guarantees nobody learns it.
  #
  # THE RETRY STAYS; the silence does not. The loop still asks `--next` again,
  # because taking a different branch is the right recovery for the agent even
  # though it is not the fix for the estate.
  #
  # THE DESK IS NOT REMOVED HERE ANY MORE, and that follows from the reset: on
  # the reset path `$hop_wt` IS the agent's own desk, so removing it would
  # destroy the checkout the agent is standing in. A desk cut on the create path
  # is left for the sweep, which is the same treatment every other unaccounted
  # desk gets — one rule rather than two.
  push_err=""
  if ! push_err=$(git -C "$hop_wt" push -u origin "$next_branch" 2>&1 >/dev/null); then
    # WHAT ORIGIN HOLDS, ASKED THROUGH THE DOMAIN. `claimAnswer` takes the
    # ref's presence, the raw commit log and the live holders (this agent's own
    # manifest excluded), and answers one of five — `held-by-agent` is the only
    # case genuinely two agents handed one branch; `stale-claim` and
    # `work-on-ref` are a stale hand-over, not a lock violation.
    if git -C "$hop_wt" fetch -q origin "$next_branch" 2>/dev/null; then
      ref_word=present
      log_text=$(git -C "$hop_wt" log --boundary --format='%m|%H|%T|%P|%at|%s' "origin/$main_branch..origin/$next_branch" 2>/dev/null) \
        || ref_word=unknown
    elif [ -z "$(git ls-remote --heads origin "$next_branch" 2>/dev/null)" ]; then ref_word=absent
    else ref_word=unknown
    fi
    # OUR OWN MANIFEST IS EXCLUDED, the same test `checkout_is_registered`
    # applies to a worktree: the supervisor wrote THIS branch into it before
    # the push, so counting it would answer `held-by-agent` on every rejection
    # and `stale-claim` would never be reached.
    holder_sessions=$([ -n "${PLOT_MANIFEST_FILE:-}" ] && live_holders_of_branch \
      "$(dirname "$PLOT_MANIFEST_FILE")" "$next_branch" "$PLOT_MANIFEST_FILE" "" | cut -f1)
    answer=$(claim_answer "$script_dir/board/plot-claim-answer.mjs" \
      "$ref_word" "${log_text:-}" "$holder_sessions") || answer=unknown
    [ -n "$answer" ] || answer=unknown
    case "$answer" in
      held-by-agent)
        echo "plot-worker-loop: REGISTRY LOCK VIOLATION — the claim push for $next_branch was rejected, so another agent already holds a slice this agent was handed. The registry is the assignment lock and this push is only its backstop; a rejection here means two agents were given one branch. Asking for another branch, but the estate needs the double assignment found." >&2
        ;;
      stale-claim)
        echo "plot-worker-loop: origin/$next_branch holds only an empty claim and no live agent names it; release it with plot-dispatch.sh --release $next_branch" >&2
        ;;
      work-on-ref)
        echo "plot-worker-loop: origin/$next_branch carries work that no live agent holds; a person decides" >&2
        ;;
      *)
        # AN ABSENT REMOTE BRANCH IS NOT A COLLISION. `remoteHead` asks the same
        # question a hand-over checks at the moment it is made: a branch gone
        # from origin was handed over from a reading already stale, not taken
        # by a second agent. `absent` and `unknown` both keep #1252's message.
        echo "plot-worker-loop: the claim push for $next_branch was rejected and origin has no such branch: $push_err" >&2
        ;;
    esac

    # THE LOOP GIVES UP THE HAND-OVER IT COULD NOT MAKE. `PLOT_BRANCH` is only
    # ever set by a SUCCESSFUL hop (below), so on this path it still names the
    # agent's PREVIOUS slice — the gap `8111e3ec` fell into: a silent
    # `continue` here ran that finished slice's prompt again in the desk this
    # loop had just reset onto `$next_branch`, and sealed a declaration for
    # work it did not do. Clearing the manifest and emptying `PLOT_BRANCH`
    # sends the next pass to `wait_for_work` as a free agent instead — the
    # guard at the branch-holding block already skips the prompt when
    # `PLOT_BRANCH` is empty. This does not return the slice to the queue: the
    # ref on origin still locks it, and slice 1 reports it orphaned once it is
    # older than one tick.
    clear_manifest_branch "${PLOT_MANIFEST_FILE:-}"
    export PLOT_BRANCH=""
    continue
  fi

  # Update the manifest to reflect the hop.
  # The manifest tracks where the worker IS, so it must update before the worker
  # starts on the new branch. Without this, the registry would show the worker
  # on its starting branch forever.
  #
  # `worktree` IS STILL WRITTEN even though a reset does not move it. The
  # function's contract is *the manifest names where the agent is*, and passing
  # the desk it actually holds keeps that true on both paths without the caller
  # having to know which one it took. On a reset the write is a no-op in value
  # and `branch` and `wavesCount` still change, which is what
  # `packages/board/src/server/registry.ts:114` reads.
  if [ -n "${PLOT_MANIFEST_FILE:-}" ] && [ -f "$PLOT_MANIFEST_FILE" ]; then
    update_manifest_on_hop "$PLOT_MANIFEST_FILE" "$next_branch" "$hop_wt" "$(session_handle)" "${PLOT_BRANCH:-}"
  fi

  # THE WAIT STATE BELONGS TO THE SLICE THAT WAITED, so the hop clears it.
  # `no-progress` asks whether THIS slice gained a commit since ITS wait, and a
  # flag carried across a hop would judge a fresh slice by the previous one's
  # history. The record goes with it: a desk handed to a new slice is not
  # waiting on anything.
  clear_limited_record "${PLOT_WORKTREE:-$PWD}"
  _after_wait=0
  _wait_head=""

  # The pid records follow the loop, so the desk it leaves names no live worker.
  # After the claim push, because a rejected push leaves the loop where it is.
  move_worker_record "$PLOT_WORKTREE" "$hop_wt"

  # Move to the desk and update environment for the next iteration. On a reset
  # this `cd` lands where the loop already stood; the export is what makes the
  # next pass read the new branch.
  cd "$hop_wt" || break
  export PLOT_BRANCH="$next_branch"
  export PLOT_WORKTREE="$hop_wt"
done
