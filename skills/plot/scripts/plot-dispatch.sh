#!/usr/bin/env bash
# Plot helper: hand one slice + its brief to the registry per eligible branch.
# Usage: plot-dispatch.sh [--dry-run] [--no-start] [--no-brief] [--offline]
#                         [--max N] [--allow-local] <slug>
#        plot-dispatch.sh --migrate [--yes] [--max N]
#   --status    list fleet worktrees with worker pid, liveness, and last log
#               line; then exit. Works regardless of plan phase.
#   --stop <br> stop the worker on <br> (branch required — never "all").
#   --restart <br>
#               start a worker on <br>, which already holds a claim — the
#               counterpart to --stop, and the only way to hand a stopped
#               branch to a new worker through Plot. Branch required, never a
#               slug: deciding that a stopped worker should be replaced rather
#               than its work reviewed, reaped or abandoned is a person's call.
#               Refuses on an open or merged PR (asked FIRST, before the state
#               word), on a live worker, and on a PLOT-BLOCKED marker. The
#               worktree is inherited exactly as it stands — uncommitted work
#               is what a stall leaves behind, and this must not destroy it.
#   --migrate   move legacy worktrees into the configured `Worktree root:`. An
#               idle worktree (no live worker, no unlanded work) is moved; a
#               busy one is skipped with the reason. Requires a `Worktree root:`
#               config — without one there is no destination. --dry-run by
#               default; --yes to actually move.
#   --dry-run   print what would happen; create nothing, push nothing
#   --monitors  with --dry-run, also name which monitors would be attached to
#               which worktree. Opt-in so the default --dry-run output stays
#               byte-identical, which is what lets it be diffed against a run
#               from before a change to this script.
#   --yes       with --migrate, actually move the worktrees (default is dry-run)
#   --no-start  hand nothing over. Dispatch starts no worker either way, so
#               this now suppresses the hand-over itself — the inspect-first
#               run that reports what is eligible and writes nothing.
#   --no-brief  hand a slice over even when its branch has no brief. The named
#               escape for the brief gate: a missing brief is not handed over,
#               because the agent's first instruction is to read
#               `.plot/briefs/<branch>.md` and it has nothing to read. A refused
#               slice leaves no desk and no claim and stays in the queue.
#               --no-brief overrides that and says so.
#   --offline   skip `git fetch`
#   --max N     dispatch at most N branches this run (default: all eligible)
#   --allow-local  read the plan's phase from the working tree when
#               origin/<main> cannot be resolved (no remote, fresh clone).
#               The explicit escape for a remote-less repo — never a default,
#               because a working-tree read is what this gate exists to avoid.
#   --allow-waiting  dispatch a branch whose `waits:` prerequisite has not
#               merged. The named escape for the prerequisite gate, in the
#               tradition of --allow-local: a gate with no exit is one people
#               route around by never annotating at all. It says so on the
#               line it overrides, so the override is on the record.
#   <slug>      the plan to fan out
# Output: one line per branch, each optionally followed by an indented
#         `in flight:` line naming a branch that already holds files, then the
#         summary block — an optional prose consequence line, then a
#         machine-countable footer.
#         A branch whose worktree exists with UNMERGED work is refused rather
#         than dispatched — counted `skipped`, with the worktree path named,
#         in `--dry-run` identically to a real run. See "THE HELD-BRANCH GATE".
#             3 worktrees prepared, 0 workers started, no `Worker command` configured
#             summary: dispatched=2 reused=0 skipped=1 started=2 brief=missing worker=unconfigured brief_asked=0
#
# THE CONSEQUENCE IS STATED IN THE SUMMARY, NOT PER BRANCH. start_worker has
# always said "no 'Worker command' configured" beside the branch it could not
# start — buried in per-branch output, after the fan-out already happened. On
# 2026-08-17 that message was printed and missed five times: worktrees sat
# claimed with nobody working on them, and the last line a caller read said
# `started=0` with no reason beside it. A caller reading only the summary is
# the case this exists for, so the fact travels twice: as `worker=` in the
# footer for machines, and as one prose line above it for people.
#
# `worker=` is unconfigured | declined | configured | suppressed:
#   unconfigured — no `Worker command` in Plot Config, and nobody has been
#                  asked. This is the state the summary line exists for.
#   declined     — `Worker command: none`. Asked, and answered "we start them
#                  by hand". A DELIBERATE absence, distinct from a missing key
#                  precisely so the skill stops asking: an empty answer is a
#                  first-class answer, and a prompt that returns every dispatch
#                  is a nag. `none` is never run as a command.
#   configured   — a command exists (whether or not every start succeeded)
#   suppressed   — `--no-start`, which means exactly what it says and implies
#                  nothing else. The inspect-first workflow is deliberate, so
#                  its zero is reported as a choice rather than as a defect.
#
# `brief=missing` is CONSTANT, and that is the point: this script cannot write a
# hand-off brief and never will. A brief is interpretation (which alternatives
# the plan rejected, and what killed them), and no script here invokes a skill —
# bash cannot reach one at all. /plot-implement owns the brief; the plot-dispatch
# SKILL invokes it after a fan-out. The field reports the gap so a direct call
# says what it left undone instead of leaving a claimed worktree looking handed
# over. It does NOT refuse: --dry-run and --status are legitimate direct calls,
# and a gate that blocks looking-before-leaping is a gate in the wrong place.
#
# `brief_asked=N` counts what the script did about it, and the distinction from
# `brief=missing` is exact: this script still writes no brief, it ASKS one to be
# written. `Brief command` names how to run an agent headless for one prompt,
# and the prompt is `/plot-implement <slug>` — the skill that already owns brief
# authorship. Absent key, or `none`: nothing is asked, the branch is refused as
# before, and the per-branch line names `no-brief-command` so the log says which
# arm ran. A project that never sets the key sees `brief_asked=0` and today's
# behaviour exactly.
#
# `brief_asked=N` COUNTS COMMANDS STARTED, NEVER BRIEFS WRITTEN. The command is
# detached by design and this script never waits on it, so a command that dies
# in its first millisecond is counted the same as one that writes and pushes a
# brief. Measured 2026-09-02: a `Brief command` that could not reach
# `/plot-implement` wrote a 33-byte log and the summary reported
# `brief_asked=1`. The per-branch line names the log for exactly this reason —
# the log is the evidence, the count is only that an attempt was made.
#
# THIS IS THE ONE SCRIPT IN THE FLEET THAT WRITES. Everything else
# (plot-fleet-scan.sh, plot-reconcile-scan.sh) is read-only. Consequently every
# write here is either idempotent or refused:
#
#   - Claim by ref push, where the claim carries an empty COMMIT. Two
#     independent claims diverge, so the loser's push is rejected as
#     non-fast-forward — that rejection is the concurrency control. Pushing a
#     branch that merely points at origin/<main> would NOT work: the remote
#     already has that commit, so both pushes succeed and both dispatchers
#     think they won. Git is the lock only when the refs actually diverge.
#   - Worktrees are adopted, never duplicated. A dispatcher that dies halfway
#     through a fan-out is safe to re-run.
#   - Nothing is ever deleted. Cleanup belongs to /plot-reconcile, which can
#     tell a deliberately abandoned claim from a dead worker.
#   - The `Started:` record is booked on the DEFAULT BRANCH, after the claims,
#     and only for branches this run newly claimed. A re-run books nothing it
#     merely re-adopted. If the booking cannot be pushed, the fan-out stands
#     and the script says the record is missing — see book_started.
#
# Eligibility is NOT decided here: this script asks plot-fleet-scan.sh, which
# owns the wave arithmetic. Dispatch only acts on the answer. Keeping the rule
# in one place is why a blocked wave can never be fanned out by accident.
#
# Workers are started DETACHED, one per worktree, so the fleet outlives the
# dispatching session — close the laptop and they keep going. That is also why
# the reaper (/plot-reconcile) is load-bearing rather than a nicety: a detached
# worker dies without telling anyone.
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# The shared worker classifier. Sourced by both this script and
# plot-fleet-scan.sh so a worker has ONE state, not one per reader.
# shellcheck source=plot-worker-state.sh
. "$script_dir/plot-worker-state.sh"

# The ONE answer to "did the host merge ANY PR for this branch?" — `pr_merged`,
# read by `held_worktree` rather than derived from ancestry. Sourced for the
# same reason `plot-reap.sh` and `plot-release-refs.sh` source it: three callers
# gate on one fact and must never disagree about it. The helper defines two
# functions and does nothing else on load.
# shellcheck source=plot-pr-merged.sh
. "$script_dir/plot-pr-merged.sh"

# ---------------------------------------------------------------------------
# WHERE THE WORKTREES LIVE, and by what name
# ---------------------------------------------------------------------------
#
# Two facts, resolved together because the second is a PROPERTY OF THE FIRST:
# the root directory the worktrees sit in, and the prefix their directory names
# carry. `plot-wt-` exists to make Plot's worktrees identifiable AMONG UNRELATED
# directories — it is a workaround for sharing a parent with other projects.
# Under a dedicated `Worktree root:` the directory already says what they are,
# so the prefix answers a question nobody is asking and is dropped. The legacy
# default keeps it, where it is still doing its job. Two conventions coexist
# permanently, and that is the intended outcome, not a transition cost.
#
#   `Worktree root:` absent  → repo_root/.. , prefix `plot-wt-`   (today's behaviour)
#   relative value           → repo_root/<value> , NO prefix
#   absolute value           → <value> as given , NO prefix
#
# THIS FUNCTION ONLY COMPOSES A ROOT AND A PREFIX. It is the CREATION side. Every
# read of "which worktree holds this branch" asks `git worktree list` instead —
# see THE HELD-BRANCH GATE. A second naming convention gives path-guessing a
# second way to be wrong, so path-guessing is confined to creation alone.
resolve_wt_root() { # $1=repo_root → sets globals wt_root, wt_prefix
  local rr="$1" configured
  configured=$("$script_dir/plot-config.sh" get "Worktree root" "")
  if [ -z "$configured" ]; then
    # The legacy default: beside the repo, prefixed. No existing checkout moves.
    wt_root=$(cd "$rr/.." && pwd)
    wt_prefix="plot-wt-"
    return
  fi
  case "$configured" in
    /*) wt_root="$configured" ;;                 # absolute: taken as given
    *)  wt_root="$rr/$configured" ;;             # relative: against the repo root
  esac
  # Normalise away a trailing slash so composed paths never double it. The
  # directory may not exist yet (created on first dispatch), so this is pure
  # string work, not a `cd`.
  wt_root="${wt_root%/}"
  wt_prefix=""
}

dry_run=0
show_monitors=0
no_start=0
no_brief=0
mode=dispatch
stop_branch=""
restart_branch=""
offline=""
allow_local=0
allow_waiting=0
max=0
slug=""
migrate_yes=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)  dry_run=1 ;;
    # --monitors NAMES what would be attached, and it is OPT-IN for a reason
    # that is a protection rather than a preference. `plot-dispatch.sh` is the
    # largest script here and a mistake in start_worker starts no workers at
    # all, so this slice pins `--dry-run` output as BYTE-IDENTICAL before and
    # after on the same estate — the dry run exercises every refusal against
    # real worktrees and real pids without starting or removing anything, which
    # is the same protection the reap and dispatch domain work used. A line
    # added to the default output would forfeit exactly that check. So the
    # naming lives behind its own flag: `--dry-run --monitors`.
    --monitors) show_monitors=1 ;;
    --status)   mode=status ;;
    --migrate)  mode=migrate ;;
    --yes)      migrate_yes=1 ;;
    # Only a value containing "/" is taken as the branch: otherwise a bare
    # `--stop <slug>` would silently treat the plan slug as a branch name and
    # stop the wrong thing (or nothing) without saying so.
    --stop)     mode=stop; case "${2:-}" in */*) stop_branch="$2"; shift ;; esac ;;
    # Same rule as --stop, for the same reason and one more: a bare
    # `--restart <slug>` would fall through to the plan gate and report "no
    # plan for feature/x", which describes neither what was asked nor what
    # went wrong. The branch is consumed only when it looks like one.
    --restart)  mode=restart; case "${2:-}" in */*) restart_branch="$2"; shift ;; esac ;;
    --no-start) no_start=1 ;;
    --no-brief) no_brief=1 ;;
    --offline|--no-fetch) offline="--offline" ;;
    --allow-local) allow_local=1 ;;
    --allow-waiting) allow_waiting=1 ;;
    --max)      max="${2:?--max needs a value}"
                case "$max" in
                  ''|*[!0-9]*) echo "plot-dispatch: --max needs a number, got '$max'" >&2; exit 1 ;;
                esac
                shift ;;
    -h|--help)  sed -n '2,46p' "$0"; exit 0 ;;
    *)          slug="$1" ;;
  esac
  shift
done

git rev-parse --git-dir >/dev/null 2>&1 || { echo "not a git repository" >&2; exit 1; }
[ -n "$slug" ] || [ "$mode" != dispatch ] || { echo "plot-dispatch: need a plan slug" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Worker launch, and the identity it records
# ---------------------------------------------------------------------------
#
# DEFINED HERE, ABOVE THE INSPECTION BLOCK, because `--restart` calls
# start_worker and that block exits before the fan-out is ever reached. Bash
# resolves a function when the call RUNS, so a definition further down the file
# is not yet in scope — the restart path found `start_worker: command not found`
# until this moved. Nothing here executes at definition time; only the position
# changed.

# A session id, in the shape the runtime uses for its transcript filename.
#
# `uuidgen` where it exists (macOS and most Linux), falling back to `/dev/urandom`
# — never to `$RANDOM` or a timestamp. Two workers launched in the same second by
# the same fan-out would collide on either, and a collision here silently merges
# two agents into one manifest.
#
# Lowercased because the runtime writes its transcript filename in lowercase and
# the board joins on exact string equality; `uuidgen` on macOS returns uppercase.
plot_session_id() {
  local id=""
  if command -v uuidgen >/dev/null 2>&1; then
    id=$(uuidgen 2>/dev/null | tr 'A-Z' 'a-z')
  fi
  if [ -z "$id" ]; then
    # 16 random bytes rendered as a v4-shaped id. The shape matters only for
    # recognisability; nothing parses it.
    id=$(od -An -tx1 -N16 /dev/urandom 2>/dev/null | tr -d ' \n' \
         | sed -E 's/(.{8})(.{4})(.{4})(.{4})(.{12})/\1-\2-\3-\4-\5/')
  fi
  printf '%s' "$id"
}

# JSON-escape one string for a manifest value.
#
# `printf %s` through a substitution chain rather than `jq`: Plot's helpers must
# run where only POSIX tools exist, and a Worker command routinely contains
# double quotes and newlines — this repo's is a 1,400-character prompt full of
# both. Backslash first, or it re-escapes what the later rules add.
json_escape() {
  printf '%s' "$1" \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/\\t/g' \
    | awk 'BEGIN{ORS=""} {if (NR>1) print "\\n"; print}'
}

# Write one agent manifest: launch-time facts, keyed on the session id.
#
# Model and context are still absent on purpose: they belong to the runtime and
# are read from the transcript, so a manifest that named them would be a guess.
#
# `resumeId` AND `session` ARE TWO FIELDS THAT HOLD ONE VALUE AT LAUNCH, and
# they are written separately on purpose. `session` is the transcript join key
# and STAYS FIXED across a branch hop, by design — `plot-worker-loop.sh` rewrites
# `branch` and `worktree` on each hop and leaves `session` alone. The resume
# handle is a different identity with a different lifetime, and whether it should
# follow a hop cannot even be ASKED while one field carries both meanings. They
# will usually agree; nothing may assume they always do.
#
# `attempts` IS THE SUPERVISOR'S OWN COUNTER, DISTINCT FROM `relaunches`.
# `relaunches` counts operator-initiated restarts — a human's record, written by
# the launch stamp. `attempts` counts a supervisor's own retries and is what a
# bound would read. Merging them would let a person's three manual restarts
# exhaust an automatic budget, or the reverse. It is written 0 here and by
# nothing else in this script: no component in Plot raises it yet, and a launch
# that guessed at one would be recording a retry nobody made.
# The `pid` starts EMPTY here and is stamped by the wrapper the instant it learns
# its own child — see `stamp_manifest_pid`. The dispatcher does not know the
# agent pid at this line (only the wrapper does, from its `$!`), so it writes the
# field as a placeholder the wrapper fills rather than guessing it now.
#
# Written to a temp file and moved into place, so a scan reading the directory
# never sees a half-written manifest. `mv` within one directory is atomic.
write_agent_manifest() { # $1=path $2=session $3=branch $4=worktree $5=command
  local out="$1" tmp="$1.plot-tmp"
  {
    printf '{\n'
    printf '  "session": "%s",\n' "$(json_escape "$2")"
    printf '  "resumeId": "%s",\n' "$(json_escape "$2")"
    printf '  "branch": "%s",\n' "$(json_escape "$3")"
    printf '  "worktree": "%s",\n' "$(json_escape "$4")"
    printf '  "command": "%s",\n' "$(json_escape "$5")"
    printf '  "pid": "",\n'
    printf '  "attempts": 0,\n'
    printf '  "startedAt": "%s"\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '}\n'
  } > "$tmp" 2>/dev/null || { rm -f "$tmp"; return 1; }
  mv "$tmp" "$out" 2>/dev/null || { rm -f "$tmp"; return 1; }
}

# THE MANIFEST PID IS STAMPED BY THE WRAPPER, NOT HERE. The agent's pid is
# knowable only to the wrapper (`$!` of its own backgrounded child), so the stamp
# is inline in the wrapper's `sh -c` below — a fresh shell that cannot reach a
# function defined in this bash script, the same isolation that makes the wrapper
# own `.plot-worker.pid`. The write above leaves `"pid": ""` as a placeholder the
# wrapper replaces; the mechanics and their safety are documented at that call.

# Start one DETACHED worker per worktree. Detached is the whole point: the
# fleet must outlive the dispatching session. Logs go beside the worktree so a
# human can read them without knowing anything about how the worker was started.
#
# The worker command is configurable because "how do I run an agent headless"
# is a per-project, per-tool answer that Plot must not hardcode (Principle 5).
# THE BRIEF GATE. A branch's hand-off brief is its specification: the `Worker
# command`'s first instruction is "Read `.plot/briefs/<branch-suffix>.md` first
# — it is the specification". Without it the worker reads nothing and improvises,
# the one thing the brief exists to prevent (measured 2026-08-20: 2:12 against a
# 700-line wave with no spec). So a missing brief PREPARES but does not START —
# the worktree and claim above are correct and stay; only the launch is refused.
#
# READABLE AND NON-EMPTY, not merely present. A zero-byte or permission-denied
# file is not a specification, and `[ -f ]` alone passes for an empty one — the
# naive check the plan calls out. This is STRICTER than the board's `briefState`
# row hint (which treats any existing file as present, because a person will look
# either way): here the cost of guessing wrong is an agent burning minutes on
# nothing, so an unreadable brief reads as missing.
#
# The path is the branch after its last `/` — the same convention
# `/plot-implement` writes and `briefPathOf` reads on the board side.
#
# READ FROM `origin/<main>`, NOT THE WORKING TREE, for the same reason the phase
# gate above does: the question is not "does a brief exist in this filesystem?"
# but "will the WORKER find one?". The worker's worktree is created from
# `origin/$MAIN` (see `git worktree add` below), so a brief committed nowhere —
# or committed locally and never pushed — is invisible to it. Checking the
# working tree passes the gate and starts a worker into an empty specification,
# which is the exact failure this gate exists to prevent.
#
# Both directions were measured 2026-08-27. Running the filesystem check from a
# checkout 8 commits behind main reported three branches' briefs missing while
# all three existed on `origin/main` at 4-5 KB — a benign refusal. The inverse
# is not benign, and it is the one a working-tree read permits.
#
# NON-EMPTY, not merely present: a zero-byte brief is what a half-finished write
# leaves behind, and `cat-file -e` alone passes for it. This is STRICTER than the
# board's `briefState` row hint (which treats any existing file as present,
# because a person will look either way): here the cost of guessing wrong is an
# agent burning minutes on nothing.
brief_path() { printf '.plot/briefs/%s.md' "${1##*/}"; }
brief_ref() { printf 'origin/%s:%s' "$MAIN" "$(brief_path "$1")"; }
brief_present() { # $1 = branch → 0 if a usable brief exists on origin/<main>
  local sz
  sz=$(git cat-file -s "$(brief_ref "$1")" 2>/dev/null) || return 1
  [ "${sz:-0}" -gt 0 ]
}

# WHAT HAPPENS AFTER THE GATE FIRES. The gate above is correct and stays: a
# missing brief still prepares and still refuses to start. What it never had is
# a next step — it named the file, and every brief on this estate was then
# written by hand.
#
# `Brief command` is that step, and it is a CONFIG KEY rather than a new script
# for one reason: `/plot-implement` step 4 already owns brief authorship. A
# script here would be a SECOND brief writer, and two writers drift. So the key
# names how to run an agent headless — the shape `Idea command`, `Story command`
# and `Approve command` already use — and the prompt it is handed asks for
# `/plot-implement <slug>` and nothing else.
#
# ABSENT IS NOT AN ERROR. A project with no `Brief command` behaves exactly as
# it does today: the gate refuses, and the refusal now names WHY nothing was
# called — `no-brief-command`, the shape `commission.ts` gives `no-idea-command`.
# `none` reads the same way as it does for `Worker command`: asked, and answered
# "we write them by hand".
brief_command() { # → the usable `Brief command`, or empty
  local cmd
  cmd=$("$script_dir/plot-config.sh" get "Brief command" "")
  case "$cmd" in none|NONE|None) cmd="" ;; esac
  printf '%s' "$cmd"
}

# Run the brief command for one branch, detached, and say what was done.
#
# DETACHED AND NOT WAITED ON, for the reason `commission.ts` gives: this is a
# `claude -p` session of unknown length, and a fan-out that blocks on one would
# hold every later branch behind it. The dispatch run reports that it asked; the
# brief lands in a later commit, and the NEXT dispatch of the same branch starts
# it. That is the whole loop.
#
# The prompt travels as ONE argument through `"$@"`, never interpolated into the
# command string — `Brief command` is a shell FRAGMENT run through `sh -c`, so
# anything spliced into it would be shell source. The slug is the only value
# that reaches it and it is a plan slug, but the rule holds regardless of the
# value: the safety is in the shape, not in the input.
# WHAT THE AGENT IS ASKED FOR, and the one thing it must not be asked for.
#
# It is asked to run `/plot-implement <slug>`, and it is NOT asked to write a
# brief in its own words. `/plot-implement` step 4 owns brief authorship; a
# prompt that described the brief here would be a second author, and two
# authors drift. The branch and the path are named because the skill writes for
# one branch and the gate reads one path — `brief_path` is the same function
# `brief_present` reads with, so writer and reader cannot disagree.
#
# It is told to COMMIT AND PUSH, because the gate reads `origin/<main>`. A brief
# written and left in a working tree is invisible to the gate that asked for it,
# and the next dispatch would ask again — a loop that writes a file every pass
# and never starts a worker.
brief_prompt() { # $1 = branch, $2 = slug
  printf '/plot-implement %s — write the hand-off brief for branch `%s` at %s, then commit and push it to %s. The dispatch gate reads that path on origin/%s, so a brief left uncommitted is invisible to it.' \
    "$2" "$1" "$(brief_path "$1")" "$MAIN" "$MAIN"
}

request_brief() { # $1 = branch, $2 = slug → 0 if a command was started
  local branch="$1" bslug="$2" cmd log
  cmd=$(brief_command)
  if [ -z "$cmd" ]; then
    echo "      no-brief-command — no \`Brief command\` in Plot Config, so nothing was asked to write it"
    return 1
  fi
  log="$repo_root/.plot/brief-$(printf '%s' "${branch##*/}").log"
  mkdir -p "$(dirname "$log")" 2>/dev/null || true
  # `nohup ... &` inside a subshell, the same detachment `start_worker` uses:
  # this outlives the dispatch run by design, because the fan-out must not block
  # on a `claude -p` session of unknown length. `setsid` is not used — it does
  # not exist on macOS, where most of this fleet runs.
  ( cd "$repo_root" \
    && PLOT_UNATTENDED=1 PLOT_PLAN_SLUG="$bslug" PLOT_BRIEF_BRANCH="$branch" \
       nohup sh -c "$cmd \"\$@\"" plot-brief \
       "$(brief_prompt "$branch" "$bslug")" \
       >"$log" 2>&1 </dev/null & ) 2>/dev/null
  echo "      asked the \`Brief command\` to write it — log: $log"
  # SAYS WHAT WAS MEASURED, WHICH IS THE START AND NOT THE RESULT. The command
  # is detached and never waited on, so this returns 0 the moment it is spawned
  # and a command that fails in its first millisecond still counts. Measured
  # 2026-09-02, first real use: the log held 33 bytes, `Unknown command:
  # /plot-implement`, and the summary still reported `brief_asked=1`. Naming the
  # log as the evidence is what keeps the count from reading as a promise.
  echo "      started, not awaited — read the log to see whether it wrote anything"
  echo "      dispatch $bslug again once it lands; the gate reads $(brief_ref "$branch")"
  return 0
}

# STALENESS REPORTS AND NEVER REFUSES, and the measurement says why.
#
# Compared 2026-09-01, all three live briefs were older than their plans and all
# three were CORRECT — every plan edit between them was bookkeeping (a PR
# annotation, a measurement note, a re-measure before approval). A timestamp
# gate would have refused 3 of 3 on the day it shipped, and a gate that refuses
# everything is one people disable in its first week.
#
# It would also have missed the real case. The teardown brief was written AFTER
# its plan and was still wrong, citing 80 `fs.rmSync` sites where the tree held
# 76 — the CODE moved, not the plan. Freshness against the plan is the wrong
# input: a brief's claims are about the repository, and nothing here compares
# those to the repository. What would actually gate is judgement about which
# numbers in a paragraph are claims, which grep cannot reach.
#
# So this prints a hint and SAYS it is a hint, naming the plan commit it
# compared against so the reader can look at that commit rather than guess.
brief_staleness_note() { # $1 = branch → prints a hint, or nothing
  local branch="$1" bc pc bs ps
  [ -n "$gate_sha" ] || return 0        # nothing shared to compare against
  [ -n "${plan_path:-}" ] || return 0
  bc=$(git log -1 --format='%H %ct' "$gate_ref" -- "$(brief_path "$branch")" 2>/dev/null) || return 0
  pc=$(git log -1 --format='%H %ct' "$gate_ref" -- "$plan_path" 2>/dev/null) || return 0
  [ -n "$bc" ] && [ -n "$pc" ] || return 0
  bs=${bc##* }; ps=${pc##* }
  [ "$bs" -lt "$ps" ] 2>/dev/null || return 0
  echo "    brief older than the plan — a HINT, not a gate: the plan may have moved, or the edit may have been bookkeeping"
  echo "      plan commit ${pc%% *} touched $plan_path after the brief's last change; read it before trusting the brief"
}

start_worker() {
  local branch="$1" wt="$2"
  local cmd
  cmd=$("$script_dir/plot-config.sh" get "Worker command" "")
  # `none` means "asked, and this repo starts them by hand". Running it would
  # spawn a worker per branch that fails with `none: command not found` — a
  # deliberate answer turned into N crashed workers.
  case "$cmd" in none|NONE|None) cmd="" ;; esac
  if [ -z "$cmd" ]; then
    # Not an error: Plot deliberately hardcodes no agent tooling (Principle 5).
    # Word it as the next step rather than a failure, or a first run reads as
    # "it did nothing".
    #
    # This line carries the ONE thing the summary cannot: which worktree to cd
    # into. The consequence itself — that nothing started, and why — is stated
    # in the summary, because per-branch output is exactly where it was missed
    # five times on 2026-08-17. Saying it in both places would train the reader
    # to skip both.
    if [ "$worker_cmd_declined" = 1 ]; then
      echo "    worktree ready — start it yourself:"
    else
      echo "    worktree ready — no 'Worker command' configured, so start it yourself:"
    fi
    echo "      cd $wt   # branch $branch is claimed and waiting"
    return 1
  fi
  local log="$wt/.plot-worker.log"
  rm -f "$wt/.plot-worker.exit"

  # THE MANIFEST, AND WHY IT IS KEYED ON A SESSION ID RATHER THAN A BRANCH.
  #
  # An agent survives the branch it was launched on: it finishes one and takes
  # another, and everything the board knows about it today lives INSIDE a
  # worktree — `.plot-worker.pid` is a file in it, and the transcript directory
  # is derived from its path. So an agent that moves on loses every identity the
  # board holds, and the states that matter most (`waiting`, and an agent between
  # branches) are exactly the ones no worktree can express.
  #
  # The manifest is the identity that outlives the worktree. It records ONLY
  # launch-time knowledge — what this function has in hand at this line — because
  # a record that infers is a record that can be wrong about the past. Model and
  # context are absent here on purpose: they belong to the runtime and are read
  # from the transcript, which the board joins by the id below.
  #
  # THE DISPATCHER MINTS THE ID. The plan assumed the runtime was already invoked
  # with `--session-id`, but this repo's `Worker command` carries none, so reading
  # one back would mean guessing at the newest file in a directory that holds one
  # to eight of them (measured 2026-08-20) — the guess the manifest exists to
  # remove. Minting keeps it launch-time knowledge, and exporting it as
  # `PLOT_SESSION_ID` lets a `Worker command` forward it so the runtime's
  # transcript lands where the manifest points. A command that ignores the
  # variable still gets a complete manifest; only the transcript join degrades,
  # to the absence the board already treats as the honest answer.
  #
  # WRITTEN BEFORE THE LAUNCH, for the reason the pid file's own comment gives
  # one paragraph down: there is a window between spawn and first write, and a
  # scan landing inside it must not read a started agent as absent. The manifest
  # carries the identity, so its window would be worse than the pid's.
  #
  # WHERE THE MANIFEST GOES IS THE `Agent registry` KEY'S ANSWER, not this
  # dispatcher's cwd. `readAgentRegistry` has honoured that key since #420 and
  # `resolveManifestDir` resolves it; this writer did not, so it wrote
  # `$repo_root/.plot/agents` — and `repo_root` is `git rev-parse
  # --show-toplevel` from wherever the dispatcher was invoked. Auto-dispatch is
  # invoked from the BOARD's checkout (`dispatch.ts` passes `cwd: repoRoot`), so
  # its manifests landed in a directory nothing reads. Measured 2026-08-27: five
  # live workers, five manifests, and the board reporting `2 manifests, 9
  # synthesized` — every agent had one, two were reachable.
  #
  # The case split is `resolve_wt_root`'s, deliberately: absolute taken as given,
  # relative joined onto the repo root, trailing slash trimmed as pure string
  # work because the directory need not exist yet. A second convention for
  # resolving a configured directory is a second way to be wrong.
  local session manifest_dir
  session=$(plot_session_id)
  manifest_dir=$("$script_dir/plot-config.sh" get "Agent registry" ".plot/agents")
  case "$manifest_dir" in
    /*) ;;
    *)  manifest_dir="$repo_root/$manifest_dir" ;;
  esac
  manifest_dir="${manifest_dir%/}"
  mkdir -p "$manifest_dir" 2>/dev/null || true
  # `printf` per field with no interpretation: a command containing quotes,
  # newlines or backslashes must survive into valid JSON, and this is the one
  # place a Worker command's full text is recorded.
  write_agent_manifest "$manifest_dir/$session.json" \
    "$session" "$branch" "$wt" "$cmd" || true
  #
  # THE GATE: NO MANIFEST, NO WORKER.
  #
  # Both writes above are `|| true`, so until this check existed a worker whose
  # manifest could not be written started anyway and was invisible to the
  # registry for its whole life. `always write a manifest` is a RULE the code
  # already believed it followed — and did; the file was simply unreachable.
  # The enforceable condition is that the manifest is WHERE THE READER LOOKS,
  # which only a test at the resolved path can establish, so this asserts the
  # post-condition rather than either write's exit status: a future edit may
  # rearrange the writing, and this still holds.
  #
  # REFUSE RATHER THAN LAUNCH. An agent outside the registry cannot be seen,
  # stopped, restarted or reaped through the board, and it holds a claim nobody
  # can release. A worker that cannot be registered is worse than one that never
  # started, because the second state is VISIBLE. The worktree and the claim are
  # left exactly as they are, so the operator retries for free once the cause is
  # fixed — this refuses a launch, it does not undo the setup.
  #
  # BEFORE THE SPAWN, AND THE ORDERING IS THE WHOLE DESIGN. The spawn is ~75
  # lines below, deliberately: there is a spawn-to-first-write window a scan
  # must not misread as an absent agent. So this has a launch to PREVENT rather
  # than a process to kill — no race, no kill path, no orphan risk. An earlier
  # draft of the plan said *assert after launch, then kill*; that would have
  # built a teardown path for a state that cannot arise.
  #
  # It NAMES THE PATH. The defect this closes was a directory nobody could see;
  # a refusal reading only "could not start" would send the operator into the
  # script to learn where it had looked. `return 1` is the same refusal contract
  # the briefless and no-Worker-command arms above use, so the fan-out does not
  # count this branch as started.
  #
  # `/api/continue`'s tolerance of a manifest-less worktree is NOT this gate and
  # must stay tolerant: that is about CONTINUING a worker in a worktree older
  # than manifests. This is CREATION, where the dispatcher has just minted a
  # session id and there is no older-worktree case to tolerate.
  if [ ! -f "$manifest_dir/$session.json" ]; then
    echo "    refusing to start $branch — its agent manifest could not be written:"
    echo "      $manifest_dir/$session.json"
    echo "      An unregistered worker cannot be seen, stopped or reaped, and holds"
    echo "      a claim nobody can release. The worktree and claim are untouched —"
    echo "      fix the path above (see the 'Agent registry' key) and dispatch again."
    return 1
  fi
  # TWO PIDS, TWO NAMES. `.plot-worker.pid` must name the AGENT — the process
  # doing the work, which is what the panel, `--status` and the scan describe.
  # `$!` from the parent names the `sh -c` WRAPPER, and recording that is the
  # bug this fixes: every field read correctly off the dispatcher's shell rather
  # than off the agent. The wrapper is the one thing that knows its own child,
  # so the wrapper writes the agent's pid; only the wrapper can, and a `pgrep`
  # by command string is the failure this repo already recorded (`wait on your
  # own PID, not a process name`).
  #
  # The wrapper's own pid is KEPT, under `.plot-worker.wrapper.pid`, because the
  # wrapper is what writes `.plot-worker.exit` when the agent exits and that must
  # keep working — `--stop` kills the agent, the wrapper survives to record the
  # code. The paths travel as env vars so no quoting level inside the
  # single-quoted `sh -c` mangles a path with spaces, exactly as the exit file
  # already does.
  #
  # AND THE WRAPPER WRITES IT ITSELF, from `$$` inside the `sh -c`. Until
  # 2026-08-31 the dispatcher wrote `echo $!` beside the spawn, which named an
  # intermediate subshell rather than the wrapper: three of three live workers
  # measured that day recorded a pid one process above the agent's real parent
  # (7357 against 7358, 71953 against 71954, 92947 against 92949).
  #
  # The cause is that `$!` names the last job THIS shell backgrounded, and with
  # an env-var prefix in front of `nohup` bash cannot collapse the AND-list into
  # one child — it forks a subshell, and that subshell is what `$!` reports.
  # (Without the prefix bash `exec`s the command in place and `$!` is correct,
  # which is why the shape matters and a smaller repro does not show it.)
  #
  # So the same rule the agent pid already follows applies here: THE PROCESS
  # THAT KNOWS A PID IS THE ONE THAT WRITES IT. The wrapper knows `$$`; no
  # ancestor can name it without guessing. It is written FIRST, before the
  # monitors and the agent, so the file exists as early as it can.
  #
  # The agent runs backgrounded inside the wrapper so the wrapper can capture its
  # `$!` and `wait` for it. There is a sub-millisecond window after the wrapper
  # starts and before it writes `.plot-worker.pid`; a scan landing in it reads an
  # absent pid file as `none` — honest, never "running" off a stale value.
  #
  # THE WRAPPER ALSO STAMPS THE MANIFEST PID, for the same reason it writes the
  # pid file: it is the one process that knows the agent's own pid. The manifest
  # path travels as `PLOT_MANIFEST_FILE`, beside the exit/pid paths, so no quoting
  # level inside the single-quoted `sh -c` mangles a path with spaces. The stamp
  # is inline `awk` rather than a bash helper, because a helper would live in this
  # bash script and the detached `sh -c` is a fresh shell with no access to it —
  # the same isolation that makes the wrapper own the pid.
  #
  # ONE CONTRACT, TWO IMPLEMENTATIONS. This inline `awk` is the mechanical twin of
  # `manifest-stamp.ts`'s `stampManifest`; `/api/continue` calls that helper, and a
  # parity test (`manifest-stamp-parity.test.ts`) runs THIS awk against the same
  # inputs and asserts a byte-identical result. The two exist because the callers
  # cannot share code — a detached `sh -c` reaches no TypeScript, and a bash helper
  # is out of a fresh shell's reach — but they must not drift, the
  # `plot-worker-state.sh` lesson after five of six states diverged in duplicate.
  #
  # It replaces ANY `pid` line, not only the empty placeholder — a full-line
  # anchored match on bytes we control, so nothing in the command value (one
  # escaped JSON string on its own line) can be mistaken for it. On a FIRST
  # dispatch the placeholder is empty: the pid is filled and nothing else changes,
  # byte-identical to the manifest before relaunch bookkeeping existed. On a
  # RELAUNCH the line already holds a pid: it is overwritten, `startedAt` is
  # rewritten to now, and two lines are inserted after `pid` — `previousPid` (the
  # corpse displaced) and `relaunches` (the restart count, +1 from any it carried).
  # The dispatcher mints a fresh session per launch so its own manifest is always a
  # first stamp; the relaunch arms exist for parity with `/api/continue`, which
  # reuses a worktree's existing manifest. A pid is digits, so no JSON escaping is
  # needed. Rewritten through a temp file and `mv`, atomic like the original write.
  # Any failure leaves the pid untouched — the registry reads an absent one as
  # `unknown`.
  #
  # The awk reads the manifest TWICE — the same file passed as two arguments, so
  # `FNR==NR` is the pre-scan. Pass one learns whether the pid is already filled
  # (a relaunch) and the count any prior `relaunches` line held; pass two rewrites.
  # This mirror of a two-pass read is what lets a SECOND relaunch increment rather
  # than reset: the old count sits AFTER the pid line, so a single pass could not
  # know it when it must emit the new `relaunches` immediately after `pid`.
  #
  # On the pid line: an empty placeholder is filled and nothing else changes (a
  # first stamp, byte-identical to before); a filled pid is overwritten and the
  # two relaunch records — `previousPid` then `relaunches` — are emitted right
  # after it, then any stale copies of those lines are dropped and `startedAt` is
  # rewritten to the current run. This is exactly `stampManifest`, line for line,
  # which the parity test pins byte for byte.
  #
  # EVERY WORKER IS BORN MONITORED, AND THAT IS ENFORCED HERE OR NOWHERE.
  #
  # Three monitors start INSIDE the wrapper, as its children, immediately before
  # the agent: one watches the process (`plot-worker-monitor.sh`), one watches
  # the desk (`plot-agent-monitor.sh`), one watches the run
  # (`plot-build-monitor.sh`). Each has a subject the others do not and a
  # cadence it cannot share — seconds on the process table, minutes on the host,
  # seconds again on a run but only while one is live.
  #
  # WHY INSIDE THE WRAPPER RATHER THAN BESIDE IT. The wrapper already outlives
  # its agent by construction — it must, or there would be no exit code to
  # write — so a child of it inherits that survival for free. Two processes
  # started SIDE BY SIDE are independently mortal: the monitor could be killed
  # or crash with nothing noticing, which is the failure being fixed one level
  # up. `--stop` kills the agent; the monitors and the exit record survive it.
  #
  # WHY HERE RATHER THAN ANYWHERE ELSE. `start_worker` is the single path to a
  # worker, which is what makes "every worker is born monitored" a gate rather
  # than a rule: there is no other place to forget. Ask CLAUDE.md's test — *can
  # you answer "did I attach a monitor?" without doing the work?* Here you
  # cannot: no monitor start, no monitored worker, and a mutation test says so.
  #
  # ORDER, AND WHY IT IS THIS WAY ROUND. The monitors are backgrounded FIRST so
  # they exist before their subject does; the agent is backgrounded next and
  # `$!` is captured on the VERY NEXT command, because `$!` names the most
  # recent background job and the pid file must name the AGENT. Starting a
  # monitor between the agent and its `$!` would record a monitor's pid as the
  # worker's — the panel bug the two-pid split already exists to prevent.
  #
  # THEY INHERIT THE STARTUP WINDOW RATHER THAN WIDENING IT. There is a
  # sub-millisecond gap after the wrapper starts and before `.plot-worker.pid`
  # is written, and a scan landing in it reads `none` — honest. The monitors
  # start inside that same window; they must never turn an unwritten pid file
  # into a `gone` finding, which is why the no-op reads no pid at all and the
  # next slice treats an absent pid file as *not yet*.
  #
  # THE PATHS TRAVEL AS ENV VARS, like every other path the wrapper needs. The
  # `sh -c` body is single-quoted and a path with spaces would not survive
  # interpolation into it — the same reason the exit, pid and manifest paths are
  # passed this way. An EMPTY value means "not attached", which is what keeps a
  # missing script from turning into `command not found` in a detached shell
  # nobody is reading.
  #
  # A HAND-MADE WORKTREE GETS NEITHER, and that falls out rather than being
  # enforced: this is the only code that starts a wrapper, and a worktree with
  # no wrapper has nothing for a monitor to be a child of.
  local worker_monitor='' agent_monitor='' build_monitor=''
  [ -x "$script_dir/plot-worker-monitor.sh" ] && worker_monitor="$script_dir/plot-worker-monitor.sh"
  [ -x "$script_dir/plot-agent-monitor.sh" ] && agent_monitor="$script_dir/plot-agent-monitor.sh"
  # THE THIRD MONITOR, born the same way and for the same reason. It watches the
  # RUN — a Build is its own entity in the spec, so a monitor per entity is the
  # pattern rather than an exception to it. Its cadence is the WorkerMonitor's
  # 30 s rather than the AgentMonitor's 300 s, and it can afford that against a
  # HOST because it asks nothing while no run is live.
  [ -x "$script_dir/plot-build-monitor.sh" ] && build_monitor="$script_dir/plot-build-monitor.sh"
  local stamp_now
  stamp_now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  ( cd "$wt" && PLOT_BRANCH="$branch" PLOT_WORKTREE="$wt" \
      PLOT_SLUG="$slug" \
      PLOT_SESSION_ID="$session" \
      PLOT_MANIFEST_FILE="$manifest_dir/$session.json" \
      PLOT_STAMP_STARTED="$stamp_now" \
      PLOT_WORKER_MONITOR="$worker_monitor" \
      PLOT_AGENT_MONITOR="$agent_monitor" \
      PLOT_BUILD_MONITOR="$build_monitor" \
      PLOT_EXIT_FILE="$wt/.plot-worker.exit" PLOT_PID_FILE="$wt/.plot-worker.pid" \
      PLOT_WRAPPER_PID_FILE="$wt/.plot-worker.wrapper.pid" \
      nohup sh -c 'printf "%s" "$$" > "$PLOT_WRAPPER_PID_FILE"; wmon=""; amon=""; bmon=""; if [ -n "$PLOT_WORKER_MONITOR" ]; then "$PLOT_WORKER_MONITOR" & wmon=$!; fi; if [ -n "$PLOT_AGENT_MONITOR" ]; then "$PLOT_AGENT_MONITOR" & amon=$!; fi; if [ -n "$PLOT_BUILD_MONITOR" ]; then "$PLOT_BUILD_MONITOR" & bmon=$!; fi; ( '"$cmd"' ) & agent=$!; printf "%s" "$agent" > "$PLOT_PID_FILE"; if [ -f "$PLOT_MANIFEST_FILE" ]; then awk -v pid="$agent" -v started="$PLOT_STAMP_STARTED" -v wrapper="$$" -v wmon="$wmon" -v amon="$amon" -v bmon="$bmon" '"'"'
        BEGIN { relaunch = 0; count = 1; stamped = 0 }
        FNR == NR {
          if ($0 ~ /^  "pid": "[^"]*",$/) {
            p = $0; sub(/^  "pid": "/, "", p); sub(/",$/, "", p)
            if (p != "") { relaunch = 1; displaced = p }
          }
          if ($0 ~ /^  "relaunches": [0-9]+,$/) {
            n = $0; sub(/^  "relaunches": /, "", n); sub(/,$/, "", n); count = n + 1
          }
          next
        }
        !stamped && $0 ~ /^  "pid": "[^"]*",$/ {
          stamped = 1
          print "  \"pid\": \"" pid "\","
          print "  \"wrapperPid\": \"" wrapper "\","
          print "  \"workerMonitorPid\": \"" wmon "\","
          print "  \"agentMonitorPid\": \"" amon "\","
          print "  \"buildMonitorPid\": \"" bmon "\","
          if (relaunch) {
            print "  \"previousPid\": \"" displaced "\","
            print "  \"relaunches\": " count ","
          }
          next
        }
        $0 ~ /^  "wrapperPid": "[^"]*",$/ { next }
        $0 ~ /^  "workerMonitorPid": "[^"]*",$/ { next }
        $0 ~ /^  "agentMonitorPid": "[^"]*",$/ { next }
        $0 ~ /^  "buildMonitorPid": "[^"]*",$/ { next }
        relaunch && $0 ~ /^  "previousPid": "[^"]*",$/ { next }
        relaunch && $0 ~ /^  "relaunches": [0-9]+,$/ { next }
        relaunch && $0 ~ /^  "startedAt": "[^"]*"$/ { print "  \"startedAt\": \"" started "\""; next }
        { print }
      '"'"' "$PLOT_MANIFEST_FILE" "$PLOT_MANIFEST_FILE" > "$PLOT_MANIFEST_FILE.plot-pid-tmp" 2>/dev/null && mv "$PLOT_MANIFEST_FILE.plot-pid-tmp" "$PLOT_MANIFEST_FILE" 2>/dev/null || rm -f "$PLOT_MANIFEST_FILE.plot-pid-tmp"; fi; wait "$agent"; rc=$?; printf "%s" "$rc" > "$PLOT_EXIT_FILE"' \
      >"$log" 2>&1 </dev/null & )
  echo "    started worker (log: $log)"
  return 0
}

# ---------------------------------------------------------------------------
# Inspection and shutdown
# ---------------------------------------------------------------------------
#
# Deliberately BEFORE the phase gate: work that is already running must stay
# inspectable and stoppable even if the plan was since delivered or rejected.
# Refusing to show a running worker because of a phase change would strand it.
repo_root_early=$(git rev-parse --show-toplevel)
resolve_wt_root "$repo_root_early"
wt_root_early="$wt_root"
wt_prefix_early="$wt_prefix"

# States: "running <pid>" | "finished <pid>" | "waiting <pid> (answer it)"
#       | "stalled <pid> (work unfinished)" | "failed <pid> (exit N)"
#       | "ended <pid> (status unknown)" | "no worker"
#
# THE CLASSIFICATION LIVES IN plot-worker-state.sh, sourced above and shared
# with plot-fleet-scan.sh. This function is now only the RENDERING half: it
# turns the shared facts into the prose `--status` has always printed. The scan
# renders the same facts as tab-separated JSON fields.
#
# The two copies of this logic agreed on five of six states and split on the
# sixth (a non-numeric exit code), which is what a duplicate does while nobody
# is looking. `no worker` is spelled that way HERE and `none` in the scan —
# both are the shared `none`, rendered for their own audience.
# Has this branch's work reached review — an open or merged PR?
#
# ASKED HERE TOO, AND THAT IS THE POINT. The PR fact outranks every local signal
# in the classification, so a consumer that cannot supply it reports `stalled`
# where the other reports `finished` — the same one-fact-two-verdicts drift
# wave 1 removed, re-entering through the new parameter. The contract test
# drives both consumers from one fixture precisely to catch that.
#
# AFFORDABLE HERE, unlike in the scan's inner loop. `--status` runs when a
# person types it and iterates the handful of `plot-wt-*` worktrees on this
# disk; the scan is polled by the board every 5 s across every branch of every
# plan, which is why IT caches one reply per branch per run. Same question, two
# costs, and only one of them needs the machinery.
#
# `--offline` IS HONOURED, because it promises no network and a flag that lied
# would be worse than a slower answer. Offline, or with no backend, the fact is
# simply not supplied and the local signals answer alone — `stalled` rather
# than `finished`, which sends a reader to look rather than telling them to stop.
reached_review() { # $1=branch → 0 when an open or merged PR exists
  [ -z "$offline" ] || return 1
  [ -n "$1" ] && [ "$1" != "?" ] || return 1
  [ "$("$script_dir/plot-host.sh" backend 2>/dev/null)" != "none" ] || return 1
  local js st
  # Exit code first: a non-zero is a transport failure and its stdout is not an
  # answer. GitHub returned 503 all afternoon on 2026-08-17, and a reader that
  # trusted the payload on failure would have called every branch reviewed.
  js=$("$script_dir/plot-host.sh" pr-state "$1" </dev/null 2>/dev/null) || return 1
  st=$(printf '%s' "$js" | sed -n 's/.*"state":"\([A-Z]*\)".*/\1/p')
  case "$st" in OPEN|MERGED) return 0 ;; *) return 1 ;; esac
}

worker_state() { # $1=worktree [$2=branch]
  local row state pid code pr_fact=""
  reached_review "${2:-}" && pr_fact="pr"
  row=$(plot_worker_state "$1" "$pr_fact")
  state=$(printf '%s' "$row" | cut -f1)
  pid=$(printf '%s' "$row" | cut -f2)
  code=$(printf '%s' "$row" | cut -f3)
  case "$state" in
    running)  echo "running $pid" ;;
    finished) echo "finished $pid" ;;
    # THE TWO TASK STATES, rendered as prose here and as bare words in the
    # scan's JSON — one computation, two renderings, the split this file's
    # `worker_state` exists to keep. Each names the move rather than the
    # condition: a reader of `--status` is deciding what to do next, and
    # "answer it" versus "resume it" is that decision.
    waiting)  echo "waiting $pid (answer it)" ;;
    stalled)  echo "stalled $pid (work unfinished)" ;;
    failed)   echo "failed $pid (exit $code)" ;;
    ended)    echo "ended $pid (status unknown)" ;;
    *)        echo "no worker" ;;
  esac
}

if [ "$mode" = "status" ]; then
  n_live=0 n_done=0 n_waiting=0 n_stalled=0 n_failed=0 n_ended=0 n_none=0
  for wt in "$wt_root_early"/"$wt_prefix_early"*; do
    [ -d "$wt" ] || continue
    br=$(git -C "$wt" branch --show-current 2>/dev/null || echo "?")
    st=$(worker_state "$wt" "$br")
    case "$st" in
      running*)  n_live=$((n_live + 1)) ;;
      finished*) n_done=$((n_done + 1)) ;;
      waiting*)  n_waiting=$((n_waiting + 1)) ;;
      stalled*)  n_stalled=$((n_stalled + 1)) ;;
      failed*)   n_failed=$((n_failed + 1)) ;;
      ended*)    n_ended=$((n_ended + 1)) ;;
      *)         n_none=$((n_none + 1)) ;;
    esac
    echo "  $br — $st"
    echo "      worktree: $wt"
    if [ -f "$wt/.plot-worker.log" ]; then
      echo "      log: $wt/.plot-worker.log"
      echo "      last: $(tail -1 "$wt/.plot-worker.log" 2>/dev/null)"
    fi
  done
  [ $((n_live + n_done + n_waiting + n_stalled + n_failed + n_ended + n_none)) -gt 0 ] \
    || echo "  (no fleet worktrees under $wt_root_early)"
  echo "summary: running=$n_live finished=$n_done waiting=$n_waiting stalled=$n_stalled failed=$n_failed ended=$n_ended no_worker=$n_none"
  exit 0
fi

if [ "$mode" = "stop" ]; then
  # An explicit branch is REQUIRED. A --stop that could mean "all" is one
  # fat-finger away from killing a whole fleet.
  if [ -z "$stop_branch" ]; then
    echo "plot-dispatch: --stop needs a branch name, e.g. --stop feature/x" >&2
    echo "  Refusing to guess — stopping the wrong worker discards its work." >&2
    exit 1
  fi
  wt="$wt_root_early/$wt_prefix_early$(printf '%s' "$stop_branch" | tr '/' '-')"
  [ -d "$wt" ] || { echo "plot-dispatch: no worktree for '$stop_branch' at $wt" >&2; exit 1; }
  st=$(worker_state "$wt" "$stop_branch")
  case "$st" in
    running*)
      pid=${st#running }
      kill "$pid" 2>/dev/null && echo "stopped $stop_branch (pid $pid)" \
        || { echo "plot-dispatch: could not stop pid $pid" >&2; exit 1; }
      # The worktree and its claim are left in place: the branch is still taken,
      # and deleting either would be the kind of write this design avoids.
      echo "  worktree kept at $wt — the claim stands until you release it"
      ;;
    finished*|waiting*|stalled*|failed*|ended*) echo "$stop_branch is not running ($st)" ;;
    *)      echo "$stop_branch has no worker" ;;
  esac
  exit 0
fi

if [ "$mode" = "restart" ]; then
  # THE COUNTERPART TO --stop, AND THE WHOLE FEATURE. `--stop` kills a worker;
  # nothing started one on a branch that already holds a claim, because the
  # dispatcher asks the scan for `--next` and `--next` fills claimable[] only
  # where the branch is `open` — meaning NO REF EXISTS. A branch that has ever
  # been claimed is `claimed` or `wip`, so it was never offered and
  # `plot-dispatch.sh <slug>` answered `dispatched=0`: not a refusal with a
  # reason, an empty set, which has nothing to say about what it filtered out.
  #
  # That `open`-only rule is Plot's LOCK and must not widen — three callers
  # consume `--next`, and the board's auto-dispatch would begin restarting
  # stalled work on a five-second timer with nobody deciding anything. So this
  # is a SECOND QUESTION, asked only when a person asks it.
  #
  # HERE, BESIDE --stop AND BEFORE THE PHASE GATE, for the reason that block
  # already gives: a branch that is already claimed and already has a worktree
  # is work in flight, and the plan's phase says nothing about whether a
  # stopped worker on it should be replaced. Refusing on phase would strand
  # exactly the branch this exists to rescue.
  if [ -z "$restart_branch" ]; then
    echo "plot-dispatch: --restart needs a branch name, e.g. --restart feature/x" >&2
    echo "  A slug is not enough: which stopped branch to hand to a new worker" >&2
    echo "  is your call, not something this should guess." >&2
    exit 1
  fi

  # ASK GIT WHICH WORKTREE HOLDS THE BRANCH — never rebuild the path from the
  # name. This file's own rule (see resolve_wt_root): path-guessing is confined
  # to CREATION, because a second naming convention gives it a second way to be
  # wrong. It matters more here than anywhere: the population this verb serves
  # includes the worktree a person made by hand after the tool had no verb for
  # them, and a hand-made worktree rarely follows dispatch's naming.
  restart_wt=$(git worktree list --porcelain </dev/null 2>/dev/null | awk -v want="refs/heads/$restart_branch" '
    /^worktree /  { path = substr($0, 10) }
    /^branch /    { if (substr($0, 8) == want) { print path; exit } }')
  if [ -z "$restart_wt" ] || [ ! -d "$restart_wt" ]; then
    echo "plot-dispatch: no worktree holds '$restart_branch' — nothing to restart." >&2
    echo "  --restart hands an EXISTING checkout to a new worker; it creates none." >&2
    echo "  To start this branch fresh, dispatch its plan." >&2
    exit 1
  fi

  # THE PR IS ASKED FIRST, BEFORE THE STATE WORD. This ordering is the round-one
  # correction to the plan, and it comes from a measurement: five of five
  # `failed` worktrees in this estate held a PR — four open, one already merged.
  #
  # `plot-worker-state.sh` refines `finished` by the TREE (an open or merged PR
  # turns it into "the work reached review") but deliberately does NOT refine
  # `failed`, `ended` or `none`, because "a recorded non-zero exit is already a
  # specific answer about the process." True about the PROCESS, and silent about
  # the WORK: a worker that opened its PR and then exited non-zero reads
  # `failed` with nothing left to redo. A gate written on the state word alone
  # would have restarted all five and discarded exactly what the `finished`
  # refusal exists to protect.
  #
  # Same lesson plot-reap.sh learned from the other side: it reads `mergedAt`
  # and never `state`, because a merged PR reports CLOSED. There the state word
  # lies about merging; here the exit code lies about completion.
  if reached_review "$restart_branch"; then
    pr_json=$("$script_dir/plot-host.sh" pr-state "$restart_branch" </dev/null 2>/dev/null || true)
    pr_num=$(printf '%s' "$pr_json" | sed -n 's/.*"number":\([0-9]*\).*/\1/p')
    pr_state=$(printf '%s' "$pr_json" | sed -n 's/.*"state":"\([A-Z]*\)".*/\1/p')
    echo "plot-dispatch: $restart_branch has a pull request (#${pr_num:-?}, ${pr_state:-OPEN}) — refusing." >&2
    echo "  The work reached review, whatever the worker's exit code says. A" >&2
    echo "  restart here redoes work someone is already looking at." >&2
    echo "  Review it, or reap the worktree once it merges." >&2
    exit 1
  fi

  # Only now the process. `worker_state` is the ONE answer to "is a worker
  # running here" — asked rather than re-derived, so this cannot drift from
  # `--status` and the scan the way five of six states already did once.
  restart_state=$(worker_state "$restart_wt" "$restart_branch")
  case "$restart_state" in
    running*)
      # THE REFUSAL THAT PREVENTS TWO WORKERS ON ONE BRANCH. There is no
      # --force: a flag overriding this is the flag typed reflexively, and what
      # it would override is another agent's work in progress.
      echo "plot-dispatch: a worker is alive on $restart_branch (pid ${restart_state#running }) — refusing." >&2
      echo "  Stop it first if you mean to replace it:" >&2
      echo "    plot-dispatch.sh --stop $restart_branch" >&2
      exit 1
      ;;
    waiting*)
      # A person owes this branch an answer. A new worker meets the same
      # question and writes the same marker.
      # ASKED, NOT RE-GLOBBED. The marker's spelling lives with the
      # classification in plot-worker-state.sh and only there; a copy of the
      # glob here is the drift `workerstate.test.mjs` pins against.
      marker=$(plot_worker_blocked_file "$restart_wt" || true)
      echo "plot-dispatch: $restart_branch is blocked on a question — refusing." >&2
      echo "  the question is in $restart_wt/${marker:-the marker file}" >&2
      echo "  Answer it and delete the marker, then restart." >&2
      exit 1
      ;;
  esac
  # `stalled`, `failed`, `ended` and `no worker` all restart. The PR question
  # above is what makes `failed` safe to include — and including it is the
  # point: a gate that simply refused `failed` would pass every refusal test
  # here and leave the verb unable to do the one thing it exists for.

  echo "restarting $restart_branch ($restart_state)"
  echo "  worktree: $restart_wt"

  # THE TREE IS INHERITED EXACTLY AS IT STANDS. A `stalled` worktree holds
  # uncommitted work — that is what `stalled` MEANS, and a measured stall in
  # this repo left 324 finished lines on the floor. Nothing here cleans,
  # resets or stashes: a restart that discards that is worse than the missing
  # affordance, because it looks like a supported operation. The new worker's
  # brief already tells it to commit and push before verifying.
  if [ -n "$(git -C "$restart_wt" status --porcelain </dev/null 2>/dev/null)" ]; then
    echo "  uncommitted work in the tree is kept — the new worker inherits it"
  fi

  # start_worker is the ORDINARY DISPATCH PATH, and reusing it is half this
  # feature. The bypass this plan replaces produced an unregistered agent, so
  # the board showed a branch name in the agent-name slot; a restart that
  # spawned a worker without a manifest would reproduce the exact defect it
  # exists to prevent. One writer, so the two cannot drift.
  #
  # These two globals are set below the phase gate, which this path exits
  # before reaching. `slug` stays empty on purpose: a restart is not a plan
  # fan-out, and the manifest records what this line actually knows.
  repo_root="$repo_root_early"
  worker_cmd_declined=0
  case "$("$script_dir/plot-config.sh" get "Worker command" "")" in
    none|NONE|None) worker_cmd_declined=1 ;;
  esac
  start_worker "$restart_branch" "$restart_wt" || exit 1
  exit 0
fi

# ---------------------------------------------------------------------------
# Migration mode: move legacy worktrees into the configured root
# ---------------------------------------------------------------------------
#
# THE REFUSALS ARE THE FEATURE. `git worktree move` on a checkout an agent is
# writing to breaks it mid-run. So this mode moves a worktree only when it has
# NO LIVE WORKER AND NO UNLANDED WORK, and names every one it skipped with the
# reason. Modelled on plot-reap.sh, which refuses on five MEASUREMENTS rather
# than judgements.
#
# A MIXED ESTATE IS AN ORDINARY STATE, NOT A TRANSITION TO COMPLETE. Existing
# worktrees stay where they are and keep working; every read asks git, so a
# mixed estate is not a special case. `--migrate` must never be required — a
# repo that adopts `Worktree root:` and never migrates is correctly configured.
#
# That is why this is opt-in and idempotent rather than automatic, and why a
# worktree it refuses is not an error.
if [ "$mode" = "migrate" ]; then
  # Resolve where worktrees SHOULD go — the configured root.
  configured_root=$("$script_dir/plot-config.sh" get "Worktree root" "")
  if [ -z "$configured_root" ]; then
    echo "plot-dispatch --migrate: no 'Worktree root:' configured — nothing to migrate."
    echo "  When Worktree root is absent, worktrees live beside the repo (plot-wt-*)."
    echo "  To migrate, first add a 'Worktree root:' key to ## Plot Config."
    exit 0
  fi

  # Resolve the target root to an absolute path.
  case "$configured_root" in
    /*) target_root="$configured_root" ;;
    *)  target_root="$repo_root_early/$configured_root" ;;
  esac
  target_root="${target_root%/}"

  # Create the target directory if needed.
  if [ "$migrate_yes" = 1 ] && [ ! -d "$target_root" ]; then
    mkdir -p "$target_root" 2>/dev/null || {
      echo "plot-dispatch --migrate: cannot create '$target_root'" >&2
      exit 1
    }
  fi

  # The legacy location: beside the repo, with `plot-wt-` prefix.
  legacy_root=$(cd "$repo_root_early/.." && pwd)
  legacy_prefix="plot-wt-"

  # If the configured root is the same as the legacy root, there is nothing to
  # migrate — the worktrees are already in the right place (only the prefix
  # would change, and renaming worktrees for a prefix is not worth the churn).
  if [ "$target_root" = "$legacy_root" ]; then
    echo "plot-dispatch --migrate: target root matches legacy root ($legacy_root)."
    echo "  Worktrees are already in the right place — nothing to migrate."
    exit 0
  fi

  n_moved=0 n_skipped=0 n_would=0
  dry_label="would move"
  [ "$migrate_yes" = 1 ] && dry_label="moved"

  printf '%-8s %-52s %s\n' "verdict" "worktree" "reason"

  for wt in "$legacy_root"/"$legacy_prefix"*; do
    [ -d "$wt" ] || continue
    # Extract the branch from the worktree.
    br=$(git -C "$wt" branch --show-current 2>/dev/null || echo "")

    # If we hit --max, stop processing.
    if [ "$max" -gt 0 ] && [ "$((n_moved + n_would))" -ge "$max" ]; then
      printf '%-8s %-52s %s\n' "keep" "$(basename "$wt")" "--max $max reached"
      n_skipped=$((n_skipped + 1))
      continue
    fi

    # FOUR READINGS, GATHERED HERE AND DECIDED ELSEWHERE. This block holds no
    # `if` about whether a worktree may move; it collects what was measured and
    # `plot-movable.mjs` returns the refusal. The four were shell `if`s until
    # 2026-09-01, and nothing could trigger one in isolation — least of all the
    # combinations this estate will not produce on demand, a live pid and a
    # dirty tree at once.
    #
    # LIVENESS AND UNLANDED WORK STAY TWO SEPARATE MEASUREMENTS, exactly as they
    # were: plot_worker_state answers "is a process running or waiting here" and
    # is keyed on the records a dispatch writes (`.plot-worker.pid`,
    # `.plot-worker.exit`). A hand-made worktree that never ran one reads `none`
    # however dirty its tree is — and hand-made worktrees are precisely the
    # estate this mode exists to tidy. The rule reads them as two fields for
    # that reason.
    #
    # plot_worker_state is the ONE liveness answer, sourced by both this script
    # and the fleet scan. It carries what a bare `ps` cannot — pid-reuse
    # detection via the manifest's `startedAt`, and the `waiting` state a
    # PLOT-BLOCKED* marker produces.
    wstate_row=$(plot_worker_state "$wt")
    state=$(printf '%s' "$wstate_row" | cut -f1)
    pid=$(printf '%s' "$wstate_row" | cut -f2)

    # `plot_worker_dirty` applies the shared filter (editor leftovers and Plot's
    # own bookkeeping do not count), so this reads real work only.
    dirty=$(plot_worker_dirty "$wt" | head -1 | cut -c1-40)

    # Only the branch's OWN upstream answers "pushed?". An absent upstream
    # leaves the field EMPTY, which the rule reads as unanswerable rather than
    # as zero — and an unanswered question is not a refusal, the principle
    # plot_worker_task_state reached the hard way when counting against
    # origin/main marked every clean branch stalled in a remote-less repo.
    ahead=""
    if [ -n "$br" ]; then
      ahead=$(git -C "$wt" rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo "")
    fi

    # THE DECISION. One call per tree, and the answer is a named refusal.
    #
    # A rule that cannot be asked REFUSES: a missing `node`, a missing bundle or
    # a throwing module all leave `mv_verdict` empty, and an empty verdict keeps
    # the worktree and says the rule could not be asked. Silence is never
    # permission — and here the permissive direction moves a checkout an agent
    # may be writing to, which `git worktree move` breaks mid-run.
    mv_verdict=$(printf '%s\t%s\t%s\t%s' "$state" "$pid" "$dirty" "$ahead" \
      | node "$script_dir/board/plot-movable.mjs" 2>/dev/null || true)
    mv_refusal=${mv_verdict%%$'\t'*}
    mv_detail=${mv_verdict#*$'\t'}

    # RENDERING, not deciding. The rule named the measurement; this names what
    # it means to someone reading the table, which is the caller's half because
    # only the caller knows it is printing one.
    if [ "$mv_refusal" != "move" ]; then
      case "$mv_refusal" in
        live-worker)         reason="worker alive (pid $mv_detail)" ;;
        blocked-marker)      reason="blocked marker — needs a person" ;;
        uncommitted-changes) reason="uncommitted: $mv_detail" ;;
        unpushed-commits)    reason="unpushed commits ($mv_detail ahead)" ;;
        *)                   reason="rule could not be asked — keeping" ;;
      esac
      printf '%-8s %-52s %s\n' "keep" "$(basename "$wt")" "$reason"
      n_skipped=$((n_skipped + 1))
      continue
    fi

    # This worktree is idle — it can be moved.
    # Compute the destination path: the target root plus the branch name
    # (flattened, no prefix).
    if [ -n "$br" ]; then
      dest_name=$(printf '%s' "$br" | tr '/' '-')
    else
      # Fallback: use the existing directory name minus the legacy prefix.
      dest_name=$(basename "$wt")
      dest_name="${dest_name#$legacy_prefix}"
    fi
    dest="$target_root/$dest_name"

    if [ "$migrate_yes" = 1 ]; then
      # Actually move the worktree.
      if git worktree move "$wt" "$dest" 2>/dev/null; then
        printf '%-8s %-52s %s\n' "moved" "$(basename "$wt")" "→ $dest"
        n_moved=$((n_moved + 1))
      else
        printf '%-8s %-52s %s\n' "FAILED" "$(basename "$wt")" "git worktree move refused"
        n_skipped=$((n_skipped + 1))
      fi
    else
      printf '%-8s %-52s %s\n' "would" "$(basename "$wt")" "→ $dest"
      n_would=$((n_would + 1))
    fi
  done

  if [ "$migrate_yes" = 1 ]; then
    echo "summary: moved=$n_moved skipped=$n_skipped"
  else
    echo "summary: would_move=$n_would skipped=$n_skipped dry_run=1"
    if [ "$n_would" -gt 0 ]; then
      echo "  Run with --yes to actually move the worktrees."
    fi
  fi
  exit 0
fi

# ---------------------------------------------------------------------------
# Phase and ceremony gate
# ---------------------------------------------------------------------------
#
# A GATE, not a rule (CLAUDE.md, "Gates Over Rules"): the check lives here, in
# the script, because prose in a SKILL.md is something an agent can rationalise
# around and a human calling this script directly bypasses entirely. Fanning
# out is the one place a user can do real damage — branches and worker
# processes for a plan nobody approved.
#
# FAIL CLOSED, unlike plot-phase-gate.sh. That one is a PreToolUse hook, so a
# broken gate would lock every commit in the repo and it must fail open. This
# is a command the user invoked: if the plan's phase cannot be read, refusing
# costs one confused re-run, while proceeding costs several agents doing
# unapproved work. The damage is asymmetric, so the default is too.
#
# THE PHASE IS READ FROM THE SHARED REF, NOT THE WORKING TREE. The working tree
# is the least trustworthy surface in a repo with several agents in it: it
# carries whatever branch was last checked out plus whatever is uncommitted,
# and neither is a fact anyone else shares. Reading it got this gate wrong in
# BOTH directions, both reproduced 2026-08-18:
#
#   - it REFUSED approved work, when a concurrent agent's `git checkout` parked
#     the shared checkout on a branch carrying an older copy of the plan. The
#     approval was on origin/<main> the whole time.
#   - it PERMITTED unapproved work, when an approval was committed to a local
#     branch and never pushed. Manifesto P2 is "plans are approved before
#     implementation"; a gate that accepts an approval nobody else can see
#     enforces "someone typed Approved in this filesystem" instead.
#
# So the question the gate asks is: has this plan been approved WHERE EVERYONE
# CAN SEE IT? `git show origin/<main>:<path>` is that question. There is
# deliberately NO fallback to the working tree — that would reintroduce the bug
# exactly where nothing can catch it. --allow-local is the explicit escape, and
# it is named in the refusal so an operator learns it exists when they need it.
MAIN=$(bash "$script_dir/plot-config.sh" get "Main branch")
[ -n "$MAIN" ] || MAIN=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
[ -n "$MAIN" ] || MAIN="main"
[ -n "$offline" ] || git fetch -q origin "$MAIN" 2>/dev/null

PLAN_DIR_CFG=$("$script_dir/plot-config.sh" get "Plan directory" "docs/plans/")
ACTIVE_DIR_CFG=$("$script_dir/plot-config.sh" get "Active index" "docs/plans/active/")

gate_ref="origin/$MAIN"
gate_sha=$(git rev-parse --verify --quiet "$gate_ref^{commit}" 2>/dev/null) || gate_sha=""

# The plan as it exists on the shared ref. Path resolution runs against the ref
# too (`git ls-tree`), not the filesystem: a plan that exists only locally must
# not be found here, and a plan whose local copy was deleted must still gate.
#
# The active index is a directory of SYMLINKS, and git stores a symlink as mode
# 120000 whose blob content is the TARGET PATH — so `git show <ref>:active/g.md`
# yields the string "../2026-01-01-g.md", not the plan. On a filesystem `[ -e ]`
# follows the link and this never comes up; against a ref it must be
# dereferenced by hand, or the gate parses a one-line path as a plan and reports
# an unreadable phase instead of the real one.
deref_on_ref() { # $1=path on $gate_ref → prints the path the blob really lives at
  local p="$1" target dir hops=0
  while [ "$(git ls-tree "$gate_ref" -- "$p" 2>/dev/null | awk '{print $1}')" = "120000" ]; do
    hops=$((hops + 1))
    [ "$hops" -le 8 ] || return 1        # a symlink cycle must not hang the gate
    target=$(git show "$gate_ref:$p" 2>/dev/null) || return 1
    case "$target" in
      /*) return 1 ;;                    # absolute: not a path within the ref
      *)  dir=$(dirname "$p")
          # Normalise ../ and ./ without touching the filesystem.
          p=$(printf '%s\n' "$dir/$target" | awk -F/ '{
                n=0
                for (i=1; i<=NF; i++) {
                  if ($i == "" || $i == ".") continue
                  if ($i == "..") { if (n>0) n--; continue }
                  s[++n]=$i
                }
                out=""
                for (i=1; i<=n; i++) out = (i==1 ? s[i] : out "/" s[i])
                print out
              }') ;;
    esac
  done
  printf '%s\n' "$p"
}

plan_path=""
if [ -n "$gate_sha" ]; then
  for cand in "$ACTIVE_DIR_CFG$slug.md" \
              $(git ls-tree -r --name-only "$gate_ref" -- "$PLAN_DIR_CFG" 2>/dev/null \
                | grep -E "/[0-9]{4}-[0-9]{2}-[0-9]{2}-${slug}\.md$|/${slug}\.md$"); do
    git cat-file -e "$gate_ref:$cand" 2>/dev/null || continue
    plan_path=$(deref_on_ref "$cand") || { plan_path=""; continue; }
    [ -n "$plan_path" ] && break
  done
fi

# --allow-local: read the working tree instead, and say so. The escape for a
# repo with no remote at all; never reached silently.
if [ -z "$gate_sha" ] && [ "$allow_local" = 1 ]; then
  echo "plot-dispatch: cannot resolve '$gate_ref' — reading the working tree (--allow-local)." >&2
  for cand in "$ACTIVE_DIR_CFG$slug.md" "$PLAN_DIR_CFG"*"$slug".md; do
    [ -e "$cand" ] && { plan_path="$cand"; break; }
  done
fi

if [ -z "$gate_sha" ] && [ "$allow_local" != 1 ]; then
  echo "plot-dispatch: cannot resolve '$gate_ref' — refusing to dispatch." >&2
  echo "  The phase gate reads the plan as it exists on the shared ref, so an" >&2
  echo "  approval only you can see cannot open it. Run \`git fetch origin $MAIN\`," >&2
  echo "  or pass --allow-local to gate on the working tree instead." >&2
  exit 1
fi

if [ -z "$plan_path" ]; then
  if [ "$allow_local" = 1 ]; then
    echo "plot-dispatch: no plan found for '$slug' — looked in $ACTIVE_DIR_CFG and $PLAN_DIR_CFG" >&2
  else
    echo "plot-dispatch: no plan for '$slug' on $gate_ref — looked in $ACTIVE_DIR_CFG and $PLAN_DIR_CFG" >&2
    echo "  A plan that exists only in this working tree has not been shared yet: push it first." >&2
  fi
  exit 1
fi

# plot-plan-meta.sh is the format contract and takes a PATH, so the blob is
# materialised into a temp file rather than parsed here — the parser stays the
# one place that knows what a plan file looks like.
#
# The template's X's must TRAIL: BSD mktemp (macOS) rejects a template with a
# suffix after them, while GNU accepts it. The first version wrote
# `plot-gate-XXXXXX.md` and failed on macOS — and because the failure fell back
# to the working tree, the gate silently went back to reading the exact surface
# this fix exists to stop reading. Hence also: NO working-tree fallback below.
# If the shared blob cannot be materialised, the gate refuses.
plan_file="$plan_path"
gate_blob=""
if [ -n "$gate_sha" ]; then
  gate_dir=$(mktemp -d "${TMPDIR:-/tmp}/plot-gate-XXXXXX") || gate_dir=""
  if [ -n "$gate_dir" ]; then
    trap 'rm -rf "$gate_dir"' EXIT
    gate_blob="$gate_dir/$(basename "$plan_path")"
    git show "$gate_ref:$plan_path" >"$gate_blob" 2>/dev/null || gate_blob=""
  fi
  if [ -z "$gate_blob" ]; then
    echo "plot-dispatch: could not read '$gate_ref:$plan_path' — refusing to dispatch." >&2
    echo "  The gate does not fall back to the working tree: an approval only you" >&2
    echo "  can see must not open it. Pass --allow-local if that is what you mean." >&2
    exit 1
  fi
else
  gate_blob="$plan_path"   # --allow-local only; guarded above
fi

# What the gate actually read, for messages: the shared ref by default, the
# working tree only under --allow-local. A refusal that names `origin/main@<sha>`
# is debuggable in seconds; "still Draft" alone sent an operator looking at a
# file that already said Approved.
if [ -n "$gate_sha" ]; then
  gate_source="$gate_ref@${gate_sha:0:8}:$plan_path"
else
  gate_source="$plan_path (working tree, --allow-local)"
fi

gate_meta=$("$script_dir/plot-plan-meta.sh" "$gate_blob" 2>/dev/null) || gate_meta=""
gate_phase=$(printf '%s' "$gate_meta" | sed -n 's/.*"phase":"\([^"]*\)".*/\1/p')
gate_impl=$(printf '%s' "$gate_meta" | sed -n 's/.*"impl":"\([^"]*\)".*/\1/p')

case "$gate_phase" in
  approved) ;;
  draft)
    echo "plot-dispatch: plan '$slug' is still Draft on $gate_source — nothing may be dispatched." >&2
    echo "  The gate reads the plan as it exists on the shared ref. If you approved it" >&2
    echo "  locally, push that approval; an approval nobody else can see is not one." >&2
    echo "  Review it, then: /plot-approve $slug" >&2
    exit 1 ;;
  delivered|released)
    echo "plot-dispatch: plan '$slug' is already $gate_phase — its work is done." >&2
    exit 1 ;;
  "")
    echo "plot-dispatch: cannot read the phase of '$slug' ($gate_source)." >&2
    echo "  Refusing rather than guessing — dispatching starts real work." >&2
    exit 1 ;;
  *)
    echo "plot-dispatch: plan '$slug' is in phase '$gate_phase', not Approved." >&2
    exit 1 ;;
esac

# Fan-out only makes sense where implementation happens on its own branches
# here. NONE means a pre-Plot-2 plan that never recorded an answer — allowed,
# since those predate the question.
case "$gate_impl" in
  own-branches|NONE|"") ;;
  same-branch)
    echo "plot-dispatch: plan '$slug' records 'Impl: same branch' — plan and code" >&2
    echo "  travel on one branch, so there is nothing to fan out." >&2
    exit 1 ;;
  other-repo)
    echo "plot-dispatch: plan '$slug' records 'Impl: other repo' — implementation" >&2
    echo "  happens elsewhere. Dispatch from the implementation repo instead." >&2
    exit 1 ;;
  none)
    echo "plot-dispatch: plan '$slug' records 'Impl: none' — knowledge-only work," >&2
    echo "  nothing to implement." >&2
    exit 1 ;;
  *)
    echo "plot-dispatch: plan '$slug' records an unrecognised 'Impl:' answer" >&2
    echo "  ('$gate_impl'). Refusing rather than guessing." >&2
    exit 1 ;;
esac

# MAIN was resolved and origin fetched above, before the phase gate — the gate
# needs the shared ref to read the plan from it.

# ---------------------------------------------------------------------------
# THE PREREQUISITE GATE: a branch that waits on another plan's branch
# ---------------------------------------------------------------------------
#
# A plan may annotate one of its branches `<!-- waits: <branch> -->`, naming ONE
# branch — usually of another plan — that must merge before this one may start.
# The parser exposes it as `waves[].branches[].waits_on`; the scan turns it into
# the branch states `waiting` and `blocked`, so `--next` already stops OFFERING
# such a branch.
#
# THAT IS ONE HALF, AND THIS IS THE OTHER. An empty offer has nothing to say
# about what it filtered out: `plot-dispatch.sh <slug>` answered `dispatched=0`
# with no reason attached, which is the same silence `--restart` was built to
# break. So this names the branch AND the prerequisite, and it names them in
# `--dry-run` identically to a real run.
#
# IT HAS COST TWO WORKERS. Measured 2026-09-02:
# `feature/the-domain-forgets-the-vendor-list` was re-dispatched at 04:50 into a
# prerequisite that had not merged, hit its own gate, and wrote a PLOT-BLOCKED
# marker. Its report names the cause: *"plot-dispatch.sh gates on the plan's
# phase, and this plan is Approved, so the slice read as eligible."*
#
# THE ANNOTATION IS READ FROM THE SHARED REF, out of the same `gate_meta` the
# phase gate parsed. A `waits:` that exists only in this working tree is an
# ordering constraint nobody else can see, exactly as a local approval is.
#
# THE PREREQUISITE IS ASKED OF THE HOST, NEVER OF THE REFS.
# `plot-release-refs.sh` deletes the remote refs of a delivered plan's merged
# branches, so a prerequisite that SUCCEEDED and was then reaped has no ref —
# and a rule reading refs would hold its dependent forever BECAUSE its
# dependency succeeded. That is the worst available failure: correct work
# producing a permanent block. `pr-state` answers about PULL REQUESTS, and a
# merged PR outlives the branch it was cut from.
#
# `NONE` AND SILENCE ARE DIFFERENT ANSWERS. `NONE` means the host was asked and
# has never seen a PR for that branch — a typo, which is `blocked`. A host that
# could not be asked is neither permission nor proof of a typo, so it HOLDS the
# branch at `waiting`. Both refuse; only one tells the operator to fix the plan.

# What the host says about the prerequisite's pull requests.
#
# Four answers, and the last two must never be collapsed — see the header
# above. `--offline` promises no network, so it answers `unreachable`: the
# question was not put, and a flag that lied would be worse than a slower
# answer. The same reasoning `reached_review` applies one screen up.
prereq_answer() { # $1=prerequisite branch → merged|unmerged|none|unreachable
  local js st
  [ -z "$offline" ] || { echo unreachable; return; }
  [ "$("$script_dir/plot-host.sh" backend 2>/dev/null)" != "none" ] || { echo unreachable; return; }
  # Exit code first: a non-zero is a transport failure and its stdout is not an
  # answer. GitHub returned 503 all afternoon on 2026-08-17, and a reader that
  # trusted the payload on failure would have started every waiting branch.
  js=$("$script_dir/plot-host.sh" pr-state "$1" </dev/null 2>/dev/null) || { echo unreachable; return; }
  st=$(printf '%s' "$js" | sed -n 's/.*"state":"\([A-Z]*\)".*/\1/p')
  case "$st" in
    MERGED) echo merged ;;
    NONE)   echo none ;;
    # OPEN and CLOSED both mean the host has SEEN the branch. A closed, unmerged
    # PR is `unmerged` rather than `none`: nothing is misspelled — somebody
    # withdrew the work, and that resolves by reopening it, not by editing the
    # plan.
    OPEN|CLOSED) echo unmerged ;;
    # A state word this adapter does not emit, or none at all. Unread is not
    # answered, and this gate's silence holds rather than permits.
    *) echo unreachable ;;
  esac
}

# Every branch the plan annotates `waits:`, with what it waits on — read from
# the same blob, in the plan's own order, one line of `branch<TAB>prerequisite`.
#
# NON-DEFERRED ONLY. `deferred:` is a JUDGEMENT — somebody gave the branch up —
# and it outranks a wait for the same reason the scan lets it: a branch nobody
# will start does not need to be told what it is waiting for. The two
# annotations sit on one line and neither reads the other's value.
waits_pairs() { # → branch<TAB>prerequisite, one per annotated branch
  printf '%s' "$gate_meta" | awk '
    {
      n = split($0, parts, /\{"branch":"/)
      for (i = 2; i <= n; i++) {
        rec = parts[i]
        br = rec; sub(/".*$/, "", br)
        if (rec ~ /"deferred":true/) continue
        if (match(rec, /"waits_on":"[^"]*"/)) {
          w = substr(rec, RSTART + 12, RLENGTH - 13)
          if (w != "") print br "\t" w
        }
      }
    }'
}

# THE PREFLIGHT, run once before the fan-out, and it is where the REFUSAL lives.
#
# WHY IT CANNOT LIVE IN THE LOOP ALONE. The fan-out loop only ever sees what
# `plot-fleet-scan.sh` offered, and the scan ALREADY reports a waiting branch as
# `waiting` rather than `open` — so it is filtered out before this script hears
# of it, and the run ends `dispatched=0 skipped=0` with nothing said about what
# was withheld. That silence is the exact defect: an empty offer has nothing to
# say about what it filtered out, and a worker was dispatched twice on 2026-09-02
# by an operator reading it as "nothing to do here".
#
# So the plan is walked DIRECTLY. This script already holds the parsed plan from
# the shared ref — the same blob its phase gate read — so naming what the fan-out
# will not reach costs one host call per annotated branch, on a population of six
# plans in 188.
#
# IT FILLS `waits_held`, WHICH THE LOOPS THEN CONSULT. Two mechanisms, one
# decision: this states the refusal, and the loops refuse to write for a branch
# it named — belt to that brace, because a scan that could not reach the host
# still offers the branch as `open`.
declare -a waits_held=()
is_waits_held() {
  local x
  for x in ${waits_held[@]+"${waits_held[@]}"}; do [ "$x" = "$1" ] && return 0; done
  return 1
}

# AND IT FILLS `waits_freed`, WHICH IS WHERE `--allow-waiting` GETS ITS
# CANDIDATE FROM.
#
# The override cannot work by relaxing a test in this script, because the branch
# never reaches a test here: `plot-fleet-scan.sh` reports a waiting branch as
# `waiting` rather than `open`, so `--list-eligible` and `--next` both withhold
# it and the loops are handed an empty set. Measured 2026-09-02 — the flag
# printed its override line and the run still reported `dispatched=0 skipped=0`,
# counting the branch neither way.
#
# So the flag ADDS a candidate rather than removing a filter. The preflight
# already walked the plan from the shared ref and asked the host about the
# prerequisite, so it holds the one fact the scan withheld, and naming it here
# costs no further call.
#
# ONLY A BRANCH THE PREFLIGHT ITSELF HELD, and only under the flag. This adds
# nothing the scan refused for any OTHER reason — a claimed branch, a `wip` one,
# an incomplete prior wave — because those verdicts are not this flag's to
# override and the scan remains the only thing that decides them. The branch
# still passes every gate the loops apply after it: `held_worktree`, the claim
# race, and the brief.
declare -a waits_freed=()
is_waits_freed() {
  local x
  for x in ${waits_freed[@]+"${waits_freed[@]}"}; do [ "$x" = "$1" ] && return 0; done
  return 1
}

# Runs the preflight: prints its refusals, fills `waits_held`, and adds what it
# withheld to `n_skipped`.
#
# NOT A COMMAND SUBSTITUTION, and that is not a style choice. `$( … )` is a
# SUBSHELL, so an array filled inside one is discarded on return — the loops
# below would consult an empty `waits_held` and the refusal would be a message
# with no effect behind it. So this writes its two results into globals and the
# caller invokes it plainly.
#
# PRINTED IDENTICALLY BY --dry-run AND THE REAL RUN, the discipline `report_held`
# already sets: a dry run that offers what a real run would refuse is worse than
# no dry run — it is the same wrong answer with a reassurance attached.
run_waits_preflight() { # → prints refusals; fills waits_held, adds to n_skipped
  local br prereq answer held
  while IFS=$'\t' read -r br prereq; do
    [ -n "$br" ] || continue
    answer=$(prereq_answer "$prereq")
    case "$answer" in
      merged) continue ;;
      none)   held=blocked ;;
      *)      held=waiting ;;
    esac
    # `--allow-waiting` SAYS SO ON THE LINE IT OVERRIDES. An override nobody can
    # see in the output is an override nobody can audit.
    if [ "$allow_waiting" = 1 ]; then
      echo "$br waits on $prereq ($held) — dispatching anyway (--allow-waiting)"
      waits_freed+=("$br")
      continue
    fi
    waits_held+=("$br")
    n_skipped=$((n_skipped + 1))
    if [ "$held" = "blocked" ]; then
      echo "skipped $br (blocked — no PR found for $prereq)"
      echo "  the plan says this branch waits on $prereq, and the host has never"
      echo "  seen a pull request for it. Check the branch name in the plan."
    else
      echo "skipped $br (waiting on $prereq)"
      echo "  the plan says this branch waits on $prereq, which has not merged."
      echo "  Dispatch it when that lands, or pass --allow-waiting to start anyway."
    fi
  done < <(waits_pairs)
}

# Where the worktrees live and what their names carry — see resolve_wt_root.
# The default is beside the repo with the `plot-wt-` prefix; a `Worktree root:`
# key relocates them (and drops the prefix, which was only earning its keep
# among unrelated sibling directories). A nested root is made invisible to
# `git status` and the marker grep by a `.gitignore` line, not by living
# outside the repo.
repo_root=$(git rev-parse --show-toplevel)
resolve_wt_root "$repo_root"

n_dispatched=0 n_reused=0 n_skipped=0 n_started=0
n_brief_asked=0

# Whether this run COULD have started anything, read once and up front.
#
# Read here rather than inside start_worker so the answer exists even on the
# paths start_worker never reaches: --dry-run, --no-start, and a run where
# every candidate was skipped. Those are precisely the runs whose `started=0`
# used to arrive with no explanation attached.
#
# --no-start wins over the config, and does not mean the config is missing:
# a repo that HAS a `Worker command` and was told not to use it is reporting a
# choice, not a gap. Conflating them would be the one-label-two-states mistake
# this whole plan exists to remove.
#
# `none` is a DELIBERATE absence, and it is not the same as a missing key —
# it is the repo's established sentinel (`Implementation home: none`) and here
# it records that the question was asked and answered "I start them myself".
# The skill writes it so it stops asking; the script must never try to RUN it,
# which is what a bare emptiness check would do.
worker_cmd_configured=0
worker_cmd_declined=0
case "$("$script_dir/plot-config.sh" get "Worker command" "")" in
  "")     ;;
  none|NONE|None) worker_cmd_declined=1 ;;
  *)      worker_cmd_configured=1 ;;
esac

worker_state_field() {
  if [ "$no_start" = 1 ]; then echo "suppressed"
  elif [ "$worker_cmd_configured" = 1 ]; then echo "configured"
  elif [ "$worker_cmd_declined" = 1 ]; then echo "declined"
  else echo "unconfigured"
  fi
}

# The summary: the machine-countable footer, and nothing above it.
#
# THE PROSE LINE IS GONE, BY ITS OWN RULE. It existed to explain a zero that
# had a cause worth naming — a `Worker command` nobody had configured, read off
# a run that had prepared desks and staffed none. Dispatch starts no worker at
# all now, so `started=0` is structural: the line would print on every run,
# always true and never informative. `--dry-run` was held to exactly this rule
# from the start — *"a dry run starts nothing BY CONSTRUCTION, so it explains
# nothing"* — and the fan-out has become the same case.
#
# `worker=` still travels in the footer. It says how this repo is configured,
# which remains a fact about the repo even where it no longer explains a count.
print_summary() { # $1=dispatched $2=reused $3=skipped $4=started
  echo "summary: dispatched=$1 reused=$2 skipped=$3 started=$4 brief=missing worker=$(worker_state_field) brief_asked=${n_brief_asked:-0}"
}

# ---------------------------------------------------------------------------
# Parallel-agents cap: warn and raise when exceeded
# ---------------------------------------------------------------------------
#
# THE CAP GATES AUTO-DISPATCH AND WARNS A PERSON (a-worker-asks-for-the-next-wave,
# "Counted" wave). maybeAutoDispatch REFUSES at the cap; plot-dispatch.sh WARNS
# and PROCEEDS. An operator running `/plot-dispatch` has asked for something
# specific; refusing them to defend a setting they can change is the wrong
# direction. But proceeding past a cap must not leave the cap behind: a stored
# `3` beside six running workers is a number the board itself knows to be false.
# So exceeding the cap UPDATES it.
#
# LIVE STATES occupy a slot: `running` and `waiting`. This matches LIVE_STATES
# in auto-dispatch.ts — the two must agree, or the cap means different things
# to different readers.
FLEET_CONTROLS_FILE="$repo_root/.plot/state/fleet-controls.json"

# Read the current parallel-agents cap from the fleet controls file.
# Returns the default (3) if the file does not exist or cannot be parsed.
read_parallel_agents_cap() {
  if [ ! -f "$FLEET_CONTROLS_FILE" ]; then
    echo 3
    return
  fi
  # A simple extraction: the file is {"autoDispatch":..., "parallelAgents": N}
  local cap
  cap=$(sed -n 's/.*"parallelAgents"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' "$FLEET_CONTROLS_FILE" | head -1)
  [ -n "$cap" ] && echo "$cap" || echo 3
}

# Count workers in live states (running or waiting) across all fleet worktrees.
# These are the slots that count against the cap.
count_live_workers() {
  local n=0 wt br st
  for wt in "$wt_root"/"$wt_prefix"*; do
    [ -d "$wt" ] || continue
    br=$(git -C "$wt" branch --show-current 2>/dev/null || echo "?")
    st=$(worker_state "$wt" "$br")
    case "$st" in
      running*|waiting*) n=$((n + 1)) ;;
    esac
  done
  echo "$n"
}

# Get the branches currently occupying slots (for the warning message).
live_worker_branches() {
  local wt br st
  for wt in "$wt_root"/"$wt_prefix"*; do
    [ -d "$wt" ] || continue
    br=$(git -C "$wt" branch --show-current 2>/dev/null || echo "?")
    st=$(worker_state "$wt" "$br")
    case "$st" in
      running*|waiting*) echo "$br" ;;
    esac
  done
}

# Update the parallel-agents cap in the fleet controls file.
# Creates the file (and directory) if needed, preserving autoDispatch if present.
update_parallel_agents_cap() { # $1 = new cap
  local new_cap="$1"
  local auto_dispatch="false"

  mkdir -p "$(dirname "$FLEET_CONTROLS_FILE")" 2>/dev/null || true

  if [ -f "$FLEET_CONTROLS_FILE" ]; then
    # Preserve the existing autoDispatch setting
    local existing
    existing=$(sed -nE 's/.*"autoDispatch"[[:space:]]*:[[:space:]]*(true|false).*/\1/p' "$FLEET_CONTROLS_FILE" | head -1)
    [ -n "$existing" ] && auto_dispatch="$existing"
  fi

  # Write atomically through a temp file, the same discipline as writeFleetControls
  local tmp="${FLEET_CONTROLS_FILE}.$$-dispatch.tmp"
  printf '{"autoDispatch":%s,"parallelAgents":%d}' "$auto_dispatch" "$new_cap" > "$tmp"
  mv "$tmp" "$FLEET_CONTROLS_FILE"
}

# Check if the dispatch exceeded the cap; if so, warn and raise it.
# Called AFTER the dispatch, with the count of newly started workers.
check_and_update_cap() { # $1 = n_started this run
  local n_started="$1"
  [ "$n_started" -gt 0 ] || return 0

  local cap live_before live_after
  cap=$(read_parallel_agents_cap)
  # Count AFTER starting — the workers we just started are now live
  live_after=$(count_live_workers)

  if [ "$live_after" -gt "$cap" ]; then
    local branches
    branches=$(live_worker_branches | paste -sd', ' -)
    echo "WARNING: dispatch exceeded parallel-agents cap ($cap → $live_after)"
    echo "  Slots now held by: $branches"
    echo "  Raising cap to $live_after so auto-dispatch sees the true count"
    update_parallel_agents_cap "$live_after"
  fi
}

# Branches CLAIMED by this run, for the `Started:` record. Only newly claimed
# ones: a reused worktree was dispatched by an earlier run, which booked it.
declare -a claimed_now=()

# Branches this run cannot dispatch. --next re-asks each iteration (pull
# semantics), and a branch that is never CLAIMED keeps coming back — without
# this the loop spins forever on the first undispatchable branch.
declare -a exhausted=()
is_exhausted() {
  local x
  for x in ${exhausted[@]+"${exhausted[@]}"}; do [ "$x" = "$1" ] && return 0; done
  return 1
}

# Record what was started, ON THE DEFAULT BRANCH.
#
# WHERE THIS IS WRITTEN IS THE WHOLE DIFFICULTY. The plan file found above
# lives in this dispatcher's LOCAL WORKING TREE — `docs/plans/active/<slug>.md`
# relative to whatever branch happens to be checked out here. The board reads
# the plan from the DEFAULT BRANCH. Appending the record to the local file and
# committing it would book the start on the dispatcher's branch, where the
# board never looks: the plan would keep reading as Ready while agents edit its
# branches. That is not hypothetical — it had to be back-filled by hand twice
# on this repo on 2026-08-16, which is why the naive version is called out here
# rather than merely avoided.
#
# So dispatch books the way every other Plot command books: through a
# disposable branch off origin/<default>, pushed with plot-push-main.sh.
#
# A SEPARATE WORKTREE, not `git checkout -b` in this one. The plan's sketch
# said checkout, but the dispatcher's working tree belongs to the user and may
# carry uncommitted work; switching it out from under them to save a note is
# exactly the kind of write this script otherwise refuses. A throwaway worktree
# reaches the same commit without touching anyone's checkout, and is removed
# whether the push succeeded or not.
#
# plot-push-main.sh rather than a bare `git push`, so a repo whose protection
# is configured but not enforced hears about the bypass instead of it passing
# silently — the reason that helper exists at all.
book_started() { # $@ = branches dispatched this run
  [ $# -gt 0 ] || return 0

  if write_started_record "$@"; then
    return 0
  fi

  # A FAILED BOOKING NEVER UNWINDS A FAN-OUT. By the time we are here the
  # worktrees exist and the claims are pushed, and those are the real state;
  # the record is a report ABOUT that state. Rolling back real work because a
  # note could not be saved is the larger damage, and aborting mid-fan-out
  # would leave exactly the inconsistency the record exists to prevent.
  #
  # Said ONCE, here, and on STDOUT beside the summary it qualifies. Why the
  # write failed belongs on stderr and was printed there; that the record is
  # missing while the work is running is part of this command's report, and a
  # caller reading only stdout would otherwise see a clean fan-out with no hint
  # that the plan still reads as Ready.
  echo "  note: Started: could not be recorded on $MAIN — the fan-out stands."
  echo "        Record it by hand, or re-run this dispatch once the push works."
  return 1
}

# The write itself. Every failure path returns non-zero after saying WHY on
# stderr; the caller owns the one user-facing consequence line.
write_started_record() { # $@ = branches
  local who date rel tmpwt bookbr rc=0
  who="${PLOT_CLAIM_WHO:-$(git config user.name 2>/dev/null || echo plot)}"
  date=$(date +%Y-%m-%d)

  # The CANONICAL plan file, not the index symlink: the record belongs in the
  # dated file both indexes point at, or a later `active/` → `delivered/` move
  # would carry the symlink and leave the record behind.
  rel=$(cd "$repo_root" && real_plan_path "$plan_file") || rel=""
  if [ -z "$rel" ]; then
    echo "plot-dispatch: $plan_file is outside the repository root" >&2
    return 1
  fi

  bookbr="plot/start-$slug"
  tmpwt="$wt_root/.plot-start-$slug.$$"

  # Fetch even under --offline: booking is a push, so the network is already
  # required. Without a fresh origin/<default> the branch would fork from a
  # stale tip and the push would be a guaranteed non-fast-forward.
  git fetch -q origin "$MAIN" 2>/dev/null

  # -B: a leftover branch from an earlier failed booking must not block this
  # one. It is disposable by construction — created here, pushed, deleted.
  if ! git worktree add -q -B "$bookbr" "$tmpwt" "origin/$MAIN" 2>/dev/null; then
    echo "plot-dispatch: could not prepare a booking worktree at $tmpwt" >&2
    return 1
  fi

  if [ -f "$tmpwt/$rel" ]; then
    local br wrote=0
    for br in "$@"; do
      # A BRANCH ALREADY RECORDED IS NOT RECORDED AGAIN, and this check is what
      # the CLAIM used to do. Dispatch pushed a claim, a claimed branch was
      # never offered again, and a second run therefore booked nothing — the
      # idempotence was a side effect of the lock rather than a property of the
      # record. The claim went with the fan-out's writes, so the record owns its
      # own idempotence now: a plan dispatched three times must not read as
      # started three times, or the count drifts from the refs it describes.
      #
      # MATCHED ON THE BRANCH IN BACKTICKS, the shape `append_started_line`
      # writes and `plot-plan-meta.sh` parses. A bare substring match would let
      # `feature/api` find itself inside `feature/api-v2`.
      if grep -qF -- "\`$br\`" "$tmpwt/$rel" 2>/dev/null \
         && grep -q -- "Started:.*\`$br\`" "$tmpwt/$rel" 2>/dev/null; then
        continue
      fi
      append_started_line "$tmpwt/$rel" "$date" "$who" "$br" || {
        echo "plot-dispatch: $rel has no '## Status' section — nowhere to record" >&2
        rc=1
        break
      }
      wrote=1
    done
    # NOTHING NEW TO SAY IS NOT A FAILURE. Every branch this run handed over was
    # already on the record, so there is no commit to make and no push to
    # attempt — and a run that pushed an empty commit would leave one per
    # re-dispatch on the default branch.
    if [ "$rc" = 0 ] && [ "$wrote" = 0 ]; then
      git worktree remove --force "$tmpwt" 2>/dev/null || true
      git branch -D "$bookbr" >/dev/null 2>&1 || true
      return 0
    fi
    if [ "$rc" = 0 ]; then
      git -C "$tmpwt" add -- "$rel" 2>/dev/null
      git -C "$tmpwt" -c "user.name=$who" commit -q \
        -m "plot: record start of $slug" 2>/dev/null || rc=1
    fi
  else
    echo "plot-dispatch: $rel is not on origin/$MAIN" >&2
    rc=1
  fi

  # The helper's own words, indented: which rules were stepped over and which
  # checks did not run is information only the remote has. Its stderr is folded
  # in so a `rejected` report is visible rather than swallowed by 2>/dev/null
  # somewhere upstream.
  if [ "$rc" = 0 ]; then
    "$script_dir/plot-push-main.sh" "$bookbr" "$MAIN" 2>&1 | sed 's/^/  /'
    # The pipeline's status is sed's, so ask the helper's directly.
    rc=${PIPESTATUS[0]}
  fi

  git worktree remove --force "$tmpwt" 2>/dev/null || true
  git branch -D "$bookbr" >/dev/null 2>&1 || true
  return "$rc"
}

# The plan path relative to the repo root, with the index symlink resolved.
# Called from within $repo_root.
real_plan_path() { # $1=plan file as found (possibly a symlink, possibly relative)
  local p="$1" d b t
  d=$(cd "$(dirname "$p")" 2>/dev/null && pwd) || return 1
  b=$(basename "$p")
  t=$(readlink "$d/$b" 2>/dev/null || true)
  if [ -n "$t" ]; then
    case "$t" in
      /*) d=$(cd "$(dirname "$t")" 2>/dev/null && pwd) || return 1 ;;
      *)  d=$(cd "$d/$(dirname "$t")" 2>/dev/null && pwd) || return 1 ;;
    esac
    b=$(basename "$t")
  fi
  case "$d" in
    "$repo_root")   printf '%s' "$b" ;;
    "$repo_root"/*) printf '%s/%s' "${d#$repo_root/}" "$b" ;;
    *) return 1 ;;
  esac
}

# Insert one `- **Started:** ...` line into the plan's `## Status` section, in
# /plot-implement's exact shape so nothing downstream learns a second format.
#
# Placed after the LAST list item of `## Status`, never appended to the end of
# the file: plot-plan-meta.sh reads these records out of that section, so a
# line below it would parse as nothing at all — a record that exists on disk
# and not in the data is worse than no record, because it looks written.
#
# A plan with no `## Status` heading is therefore a REFUSAL, not a best-effort
# append. Exit 1 and let the caller report the record as unwritten; the plan is
# malformed and guessing where the field belongs would hide that.
append_started_line() { # $1=file $2=date $3=who $4=branch
  local f="$1" line
  line="- **Started:** $2, $3, \`$4\`"

  # ALREADY RECORDED IS NOT AN ERROR — it is a second dispatch of the same
  # slice, and this returns 0 having written nothing.
  #
  # THE CLAIM USED TO BE THIS GUARD. A dispatched branch was claimed by a ref
  # push, so `--next` never offered it twice and a re-run booked nothing. The
  # hand-over pushes no claim, so the branch stays `open` and every re-run
  # reaches this line: measured 2026-09-04, two runs left two identical
  # `Started:` records in one plan.
  #
  # The DATE is deliberately not matched. A slice handed over again tomorrow is
  # the same start, and a per-day record would drift from the refs it describes
  # exactly as a per-run one does.
  if grep -qF -- "\`$4\`" "$f" 2>/dev/null \
    && grep -q -- "^[ \t]*[-*][ \t]*\*\*Started:\*\*.*\`$4\`" "$f" 2>/dev/null; then
    return 0
  fi
  awk -v line="$line" '
    { lines[++n] = $0 }
    END {
      # The first `## Status` heading, then where the record belongs under it.
      for (i = 1; i <= n; i++) {
        if (lines[i] ~ /^##[ \t]*[Ss]tatus[ \t]*$/) { start = i; break }
      }
      if (!start) exit 1

      # The template ships an EMPTY `- **Started:**` placeholder, and the record
      # belongs there. Appending after the last list item instead put it below
      # `- **Delivered:**` — the parser still read it, so nothing failed loudly,
      # but the block listed a start after a delivery and both plans dispatched
      # on 2026-08-16 had to be tidied by hand.
      #
      # Filling the placeholder is preferred; appending after the last list item
      # remains the fallback for plans that never had one (pre-Plot-2 files).
      insert = start
      for (i = start + 1; i <= n; i++) {
        if (lines[i] ~ /^##[ \t]/) break
        if (lines[i] ~ /^[ \t]*[-*][ \t]*\*\*Started:\*\*[ \t]*$/) { slot = i; break }
        if (lines[i] ~ /^[ \t]*[-*][ \t]/) insert = i
      }

      for (i = 1; i <= n; i++) {
        if (i == slot) { print line; continue }   # replaces the empty placeholder
        print lines[i]
        if (!slot && i == insert) print line
      }
    }
  ' "$f" > "$f.plot-tmp" || { rm -f "$f.plot-tmp"; return 1; }
  mv "$f.plot-tmp" "$f"
}


# ---------------------------------------------------------------------------
# What is already in flight
# ---------------------------------------------------------------------------
#
# Before fanning out, say which branches already hold which files. Waves are a
# WITHIN-PLAN ordering; a correctly eligible branch can still name a file an
# agent has open on a different plan's branch, and nothing in the wave model
# represents that. Assembling the answer by hand took five commands and had to
# be done twice on 2026-08-16 — this turns it into a line of output.
#
# IT REPORTS AND REFUSES NOTHING. Every branch is dispatched exactly as before;
# the operator reads the report and decides. Two designs that would have judged
# instead were tried on paper and killed by measurement:
#
#   - `git merge-tree` compares two EXISTING commits, and dispatch CREATES the
#     candidate branch. At check time it is identical to the default branch, so
#     the comparison reports clean for every candidate, forever. A check that
#     always passes is worse than none: it turns a known gap into a false
#     assurance. (merge-tree still earns its place where both commits exist —
#     re-dispatch and plot-merge-queue.)
#   - A `Touches:` field per branch, intersected with the measured side. The
#     scope guards in real briefs are `packages/board/**`,
#     `packages/board/src/app/**` and `plot-fleet-scan.sh` — the first CONTAINS
#     the second, so two branches that ran in parallel without touching each
#     other would read as colliding. Three of four briefs use `**` globs, so the
#     false positive is the normal case. It would also rest on an unverified
#     self-declaration, and a comparison is only as good as its weaker half.
#
# So only the MEASURED side is read, and nothing on the candidate side is
# consulted at all — not the plan text, not a declaration, nothing.
#
# LOCAL REFS AND WORKTREES, NOT THE REMOTE. This is where refs-are-truth bends,
# for a measured reason: the collision that blocked a dispatch on 2026-08-16
# lived in an UNPUSHED commit — committed, clean worktree, remote ref holding
# only the claim, invisible to any remote-based check. Uncommitted work is
# invisible to refs entirely. Both are readable here and only here, and that is
# sound rather than a violation because dispatch is inherently machine-specific:
# it creates worktrees on THIS machine. A check that ignored what this machine
# knows would be blind precisely where it acts.

# Files a branch holds in commits of its own, against ITS OWN MERGE-BASE.
#
# Not against origin/<main>. A branch rebased onto a newer main is not "behind"
# it, and diffing against the tip would attribute every commit the branch picked
# up from main to the branch itself — on a busy day that is the whole repo, and
# the report becomes noise on its first use.
committed_files() { # $1=branch → paths, one per line
  local br="$1" base
  base=$(git merge-base "$br" "origin/$MAIN" </dev/null 2>/dev/null) || return 0
  [ -n "$base" ] || return 0
  git diff --name-only "$base" "$br" </dev/null 2>/dev/null
}

# Files a branch holds only in its worktree — no ref carries these, so they are
# invisible to every ref-based check including this script's own.
uncommitted_files() { # $1=worktree → paths, one per line
  local wt="$1"
  [ -d "$wt" ] || return 0
  git -C "$wt" status --porcelain </dev/null 2>/dev/null | awk '
    {
      # Porcelain v1: XY then a space then the path. A rename prints
      # "old -> new"; the new path is the one on disk.
      line = substr($0, 4)
      i = index(line, " -> ")
      if (i > 0) line = substr(line, i + 4)
      gsub(/^"|"$/, "", line)
      if (line != "") print line
    }'
}

# The generated board bundle is excluded from every report. Every board branch
# rebuilds it, so including it would make every board pair look like a
# collision — which is precisely the noise `.gitattributes -merge` exists to
# remove. Its conflicts are settled by rebuilding, never by reading.
ARTIFACT_PATH="skills/plot/scripts/board/board-server.mjs"

# The worktree for a branch, by the same name-flattening rule dispatch uses.
#
# This COMPOSES a path and is used only where composition is right: the
# in-flight file report below, which asks "if this branch WERE dispatched, where
# would its worktree be", for a branch this run has not itself created. It is the
# creation rule read forward, not a "which worktree holds this branch" query —
# those ask git (held_worktree). The prefix follows the root, empty under a
# dedicated `Worktree root:`.
worktree_for() { # $1=branch
  printf '%s/%s%s' "$wt_root" "$wt_prefix" "$(printf '%s' "$1" | tr '/' '-')"
}

# ---------------------------------------------------------------------------
# THE HELD-BRANCH GATE
# ---------------------------------------------------------------------------
#
# Is somebody already holding this branch — a worktree on this disk with work
# in it that has not landed?
#
# THE MEASUREMENT. On 2026-08-20 `--dry-run` reported `claimed=0` across a fleet
# with four live agents and offered `feature/the-row-carries-its-verdict` and
# `feature/reconcile-calls-the-index-advisory` — both implemented, tested and
# green in worktrees beside this repo — as dispatchable. Acting on that output
# puts a second agent on finished work.
#
# WHY THE SCAN CANNOT SEE IT. `plot-fleet-scan.sh` derives every state from
# `origin/<branch>`, and both branches had NO REMOTE REF: one local commit
# each, never pushed. No remote ref means no claim, and no claim means
# `eligible`. The scan is right about what it reads; it is reading the wrong
# side of the machine.
#
# WHY A RULE CANNOT FIX IT. "Always dispatch through plot-dispatch.sh so the
# claim ref exists" is answerable without doing it, and it was violated four
# times in one evening by an operator who had read it that evening. See
# CLAUDE.md § Gates Over Rules.
#
# WHY THIS SCRIPT CAN. It already enumerates worktrees and local refs for the
# in-flight collision report, for the reason documented above that report:
# dispatch is inherently machine-specific — it creates worktrees on THIS
# machine, so a check blind to this machine is blind precisely where it acts.
# The evidence was already being collected; it was simply never asked this
# question.
#
# WHAT COUNTS AS HELD needs both halves, because either alone is wrong:
#
#   * A WORKTREE MUST EXIST — found by ASKING GIT which one holds the branch,
#     never by rebuilding the path from the branch name. Without one there is no
#     desk and nobody at it, and a local branch on its own is not a hold: plenty
#     exist for other reasons.
#
#   * IT MUST HOLD WORK THAT HAS NOT LANDED — in a commit or in the working
#     tree, and the working tree is checked first because no commit carries it.
#     Several leftover worktrees on merged branches sit on this disk (6 of 36
#     when this was written); their work landed and the directory was never
#     removed. Refusing those would make the gate fire on exactly the branches
#     that are safe, which is the fastest way to teach an operator to route
#     around it.
#
# THE TWO SHAPES ARE NOT ONE QUESTION, and treating them as one is how the first
# version of this gate shipped a hole. `--is-ancestor` against `origin/<main>`
# answers for the merged leftover AND — identically — for a worktree cut minutes
# ago: its branch points at whatever main was then, so it is an ancestor
# trivially. Both read `ahead=0, behind=N`, and no walk of the history separates
# them. Only the FILES do, which is why `uncommitted_files` is consulted before
# the ancestry test rather than instead of it.
#
# NOT MERGE-BASE, ANCESTRY. A branch rebased onto a newer main is not behind
# it, and the merged question is only ever "is this tip already in main".
#
# LOCAL REF, not `origin/<branch>`. Reading the remote here would reproduce the
# scan's blind spot inside the fix.
#
# `--allow-local` DOES NOT REACH HERE, and must never be wired to. That flag is
# the named escape for a repo whose `origin/<main>` cannot be resolved, and it
# says something about reading a PHASE — nothing whatever about whether a human
# is mid-edit in a worktree. It is absent from this function by design, not by
# oversight; a test pins that the refusal survives it.
held_worktree() { # $1=branch → prints the worktree path when held, else nothing
  local br="$1" wt
  # ASK GIT WHICH WORKTREE HOLDS THE BRANCH. Do not reconstruct the path from
  # the branch name.
  #
  # MEASURED, after a first version did exactly that via `worktree_for`. Every
  # hand-made worktree on this machine is named `plot-wt-<last-segments>` with
  # the branch TYPE dropped — `plot-wt-a-branch-row-carries-its-link` for
  # `bug/a-branch-row-carries-its-link`, where dispatch's own rule would say
  # `plot-wt-bug-a-branch-row-carries-its-link`. A path-guessing gate therefore
  # missed a worktree with six modified files in it.
  #
  # And it missed it in the WORST POSSIBLE POPULATION: worktrees dispatch did
  # not create are precisely the ones carrying no claim ref, which is the entire
  # reason this gate exists. A check that only recognises its own naming
  # convention can only catch the branches that were already claimed.
  #
  # `git worktree list --porcelain` emits `worktree <path>` then `branch
  # refs/heads/<name>` per entry, so the branch line is matched and the path
  # remembered from the preceding line. A detached worktree has no branch line
  # and never matches, which is right: it holds no branch to hold.
  wt=$(git worktree list --porcelain </dev/null 2>/dev/null | awk -v want="refs/heads/$br" '
    /^worktree /  { path = substr($0, 10) }
    /^branch /    { if (substr($0, 8) == want) { print path; exit } }')
  [ -n "$wt" ] || return 1
  # A registered worktree whose directory is gone (removed by hand, not via
  # `git worktree remove`) holds nobody. `status` cannot be read there anyway.
  [ -d "$wt" ] || return 1

  # UNCOMMITTED WORK IS UNLANDED WORK, and it is asked FIRST because the commit
  # history cannot see it at all.
  #
  # MEASURED ON THIS REPO, after the tip check below was already written and
  # green. `plot-wt-a-branch-row-carries-its-link` held six modified files for a
  # live agent and carried NO COMMIT YET: its branch sat at the main tip of the
  # moment the worktree was cut, so `--is-ancestor` answered "already landed"
  # and the gate offered the branch. Three sibling worktrees were in the same
  # shape. That is the plan's own failure — a second agent onto occupied work —
  # re-entering through the one shape a tip-based check cannot see.
  #
  # A freshly cut worktree is `ahead=0, behind=N`: indistinguishable by history
  # from the merged leftover the gate must NOT refuse. The file state is what
  # separates them, and `uncommitted_files` was already collecting it for the
  # in-flight report a few lines up.
  [ -z "$(uncommitted_files "$wt")" ] || { printf '%s' "$wt"; return 0; }

  # DID ITS WORK LAND? THE HOST ANSWERS, NOT ANCESTRY.
  #
  # This asked `git merge-base --is-ancestor "$br" "origin/$MAIN"` until
  # 2026-09-04. Measured that day on this estate: ten merged branches still
  # carried a remote ref and ancestry disagreed with the host on TEN OF TEN.
  # Squash-merge is not occasionally wrong here — the squashed commit is not the
  # branch's commit, so the branch stays ahead of main forever and ancestry
  # answers "not landed" about every squash-merged branch there is.
  #
  # The failure direction is throughput, not safety: ancestry called a landed
  # leftover HELD, so dispatch refused a branch that was free. That is the
  # cheap half of the plan's measurement and it is still a refusal an operator
  # has to route around.
  #
  # `pr_merged` is the ONE answer, sourced rather than re-derived — the same
  # gate `plot-reap.sh` and `plot-release-refs.sh` read, for the reason that
  # file states: two implementations of one question drift, and one of them
  # drifts permissive.
  #
  # ANCESTRY REMAINS AS A SECOND CHANCE, and only toward "landed". A
  # fast-forward or rebase merge leaves the tip genuinely in main while the host
  # may hold no PR at all — a branch pushed straight to main, which this repo's
  # own fixtures do. It can only ever release a worktree the host already
  # declined to release, so it adds no way to refuse and no way to hide work.
  #
  # AN UNREACHABLE HOST ANSWERS "NOT MERGED", which keeps the worktree held.
  # That is `pr_merged`'s documented direction and the right one here too:
  # silence is never permission to hand somebody's desk to a second agent.
  # plot-ancestry: prefilter — second only to `pr_merged` above, and it can
  # only RELEASE a worktree the host already declined to release. It adds no
  # refusal, so a squash merge it misreads changes nothing.
  pr_merged "$br" && return 1
  git merge-base --is-ancestor "$br" "origin/$MAIN" </dev/null 2>/dev/null && return 1
  printf '%s' "$wt"
}

# The refusal, printed identically by --dry-run and the real run.
#
# IDENTICAL BY CONSTRUCTION, via one function called from both loops rather
# than two messages that agree today. A dry run that offers what a real run
# would refuse is worse than no dry run: it is the same wrong answer with a
# reassurance attached.
#
# It NEVER CLAIMS on the operator's behalf. Writing a claim ref for a worktree
# this script did not create puts a record in git nobody asked for, and a stale
# ref is worse than an absent one — the reaper cannot tell it from a real claim.
# So the gate reports and stops, and the operator decides.
report_held() { # $1=branch $2=worktree
  echo "skipped $1 (held — worktree exists with unlanded work)"
  echo "  worktree: $2"
  echo "  nobody claimed it, so nothing here can tell a live agent from an"
  echo "  abandoned desk. Check it, then remove the worktree or let it finish."
}

# Every local branch that holds files, with what it holds.
#
# LOCAL branches, because worktrees share one ref database: `git rev-parse`
# answers from the main repo for a branch checked out elsewhere, so a sibling
# agent's unpushed commits are readable from here without visiting its worktree.
#
# Emits "branch<TAB>file,file,…" per branch that holds at least one file.
# A branch holding nothing emits nothing — a bare claim marker is an empty
# commit, and reporting "holds " with no files would be worse than silence.
work_in_flight() { # $1=branch to exclude (the candidate)
  local exclude="${1:-}" br files
  # bash 3.2 on macOS: no `declare -A`, so this accumulates into a plain string
  # rather than a map. Sorted output keeps the report stable between runs.
  git for-each-ref --format='%(refname:short)' refs/heads/ </dev/null 2>/dev/null \
  | while read -r br; do
      [ -n "$br" ] || continue
      [ "$br" = "$exclude" ] && continue
      [ "$br" = "$MAIN" ] && continue
      files=$( { committed_files "$br"; uncommitted_files "$(worktree_for "$br")"; } \
        | grep -v -x -F "$ARTIFACT_PATH" \
        | sort -u \
        | tr '\n' ',' | sed 's/,$//' )
      [ -n "$files" ] || continue
      printf '%s\t%s\n' "$br" "$files"
    done
}

# Print the in-flight report for one candidate, indented under its line.
#
# Silent when nothing is held. A report that always prints something teaches
# the reader to skip it, and then it is worth nothing on the day it matters.
#
# BOUNDED, because measured on this repo it was not. The first run against real
# state printed 13 branches under a single candidate, one of them naming 18
# paths — the same "ignored by the third time" failure the design warns about,
# arriving as volume rather than as false positives. Both caps are plain
# truncation with the remainder counted, never a judgment about which branch or
# file matters: nothing here can know that, and pretending to would be the
# candidate-side prediction this design refuses.
#
# The full list stays one command away, and the line says which.
IN_FLIGHT_MAX_FILES=6
IN_FLIGHT_MAX_BRANCHES=8

# What a real run would attach, named per worktree — behind `--monitors`.
#
# SILENT UNLESS ASKED, which is what keeps the default `--dry-run` output
# byte-identical to a run from before the monitors existed. That diff is this
# slice's protection against the one failure that matters here: a mistake in
# `start_worker` starts no workers at all, and the dry run exercises every
# refusal against real worktrees and real pids without starting anything.
#
# IT NAMES THE SCRIPT PATH, not just the monitor. The question a reader has at
# a dry run is *which code would run against my worktree* — a bare "2 monitors"
# would send them into this script to find out, and a path they can `cat` is
# the same courtesy the manifest refusal above pays by naming its directory.
#
# IT REPORTS ABSENCE TOO. A monitor script that is missing or non-executable
# means an unmonitored worker, and the empty env var that produces is invisible
# at launch by design (a detached `sh -c` nobody reads must not spew `command
# not found`). The dry run is the one place that silence can be made audible
# before it matters.
report_monitors() { # $1=worktree
  [ "$show_monitors" = 1 ] || return 0
  local wt="$1" m
  for m in worker agent; do
    local script="$script_dir/plot-$m-monitor.sh"
    if [ -x "$script" ]; then
      echo "  would attach: $script → $wt"
    else
      echo "  would attach NOTHING for the $m monitor — $script is missing or not executable"
    fi
  done
}

report_in_flight() { # $1=candidate branch
  local br files shown extra n=0 total
  total=$(work_in_flight "$1" | wc -l | tr -d ' ')
  [ "${total:-0}" -gt 0 ] || return 0

  work_in_flight "$1" | while IFS=$'\t' read -r br files; do
    n=$((n + 1))
    if [ "$n" -gt "$IN_FLIGHT_MAX_BRANCHES" ]; then
      # Said once, on the last line, rather than per branch.
      [ "$n" = "$((IN_FLIGHT_MAX_BRANCHES + 1))" ] && \
        echo "  in flight: …and $((total - IN_FLIGHT_MAX_BRANCHES)) more branches" \
             "— plot-fleet for the full picture"
      continue
    fi
    # Commas to ", " for reading; the machine-countable summary is the footer,
    # so this line is allowed to be prose.
    shown=$(printf '%s' "$files" | tr ',' '\n' | head -"$IN_FLIGHT_MAX_FILES" \
      | tr '\n' ',' | sed -e 's/,$//' -e 's/,/, /g')
    # `printf '%s'` writes no trailing newline, so `wc -l` counts SEPARATORS
    # and undercounts the last field by one. Terminating the stream with
    # printf '\n' is what makes the remainder exact — it reported "+2 more"
    # for nine files with six shown until a test pinned the arithmetic.
    extra=$(( $(printf '%s\n' "$files" | tr ',' '\n' | wc -l) - IN_FLIGHT_MAX_FILES ))
    [ "$extra" -gt 0 ] && shown="$shown (+$extra more)"
    echo "  in flight: $br holds $shown"
  done
}

# THE PREREQUISITE PREFLIGHT, before either fan-out path. It names every branch
# this plan will not start and why, and fills `waits_held` so neither loop can
# write for one. Run here, once, rather than inside the loops: the scan filters a
# waiting branch out before a loop ever hears of it, so a refusal that only fires
# on an offered branch would never fire at all.
run_waits_preflight

# A dry run changes nothing, so nothing can go stale — read the whole eligible
# set once. (`--next` would loop forever here: without a claim it keeps
# returning the same branch.)
if [ "$dry_run" = 1 ]; then
  while read -r br; do
    [ -n "$br" ] || continue
    # The gate, BEFORE the "would dispatch" line — this loop's whole output is
    # a prediction, and predicting a dispatch the real run refuses is the
    # failure the gate exists to stop.
    if held=$(held_worktree "$br"); then
      report_held "$br" "$held"
      n_skipped=$((n_skipped + 1))
      continue
    fi
    # ALREADY REFUSED BY THE PREFLIGHT, which named it and counted it. The
    # scan does not normally offer a waiting branch at all; this arm catches
    # the one that reached here because the scan could not ask the host.
    is_waits_held "$br" && continue
    echo "would dispatch $br → $(worktree_for "$br")"
    report_monitors "$(worktree_for "$br")"
    report_in_flight "$br"
    n_dispatched=$((n_dispatched + 1))
    # The scan's eligible set, plus whatever `--allow-waiting` freed. The scan
    # reports a waiting branch as `waiting`, so it is absent from the first and
    # only the preflight can supply it — see `waits_freed`. `sort -u` because a
    # branch the scan DID offer (its host call failed where the preflight's
    # succeeded) must be dispatched once, not twice.
  done < <({ "$script_dir/plot-fleet-scan.sh" $offline --list-eligible "$slug" 2>/dev/null
             printf '%s\n' ${waits_freed[@]+"${waits_freed[@]}"}; } | grep -v '^$' | sort -u)
  # A dry run starts nothing BY CONSTRUCTION, so its `started=0` carries no
  # information about the config — reporting "no workers started" here would be
  # true and useless, and would train the reader to skip the line on the real
  # run where it matters. Only the machine field travels.
  # `skipped` is REAL here, not a constant. A dry run refuses held branches
  # exactly as the real run does, so its count is a fact about this fleet — and
  # it was hardcoded to 0 until the gate gave it something to count.
  # `brief_asked=0` is a CONSTANT here and not a prediction. A dry run changes
  # nothing, and asking the `Brief command` to write a brief spawns an agent
  # that commits — the loudest write in this script. The field travels so the
  # footer's shape does not depend on the mode a machine reader happened to
  # call in.
  echo "summary: dispatched=$n_dispatched reused=0 skipped=$n_skipped started=0 brief=missing worker=$(worker_state_field) brief_asked=0"
  exit 0
fi

# THE LIST IS READ ONCE, AND THAT FOLLOWS FROM THE CLAIM GOING.
#
# This was a PULL: `--next` was asked again after every claim, because claiming
# a branch changed what the next ask would offer and a list computed up front
# would have gone stale mid-fan-out. Dispatch claims nothing now — it hands a
# slice to the registry and returns — so nothing this loop does changes the
# scan's answer, and re-asking would return the same branch until a gate marked
# it exhausted and the loop broke on it. Measured on the first run after the
# claim was removed: `feature/one` handed over, `feature/two` never reached.
#
# ONE SCAN RATHER THAN N. The scan is 18.3 s here, so the pull cost one of those
# per branch to re-derive an answer that could not have moved.
#
# `--allow-waiting`'s CANDIDATES COME LAST, after every branch the scan was
# willing to name. `--list-eligible` reports a waiting branch as `waiting` and
# never offers it, so the flag's candidates can only come from the preflight; a
# held branch is one the operator chose to start early and must not displace one
# that was ready. `sort -u` because a branch the scan DID offer — its host call
# failed where the preflight's succeeded — must be handed over once, not twice.
mapfile -t fan_out < <({ "$script_dir/plot-fleet-scan.sh" $offline --list-eligible "$slug" 2>/dev/null
                         [ "$allow_waiting" = 1 ] && printf '%s\n' ${waits_freed[@]+"${waits_freed[@]}"}
                         :; } | grep -v '^$' | sort -u)

for branch in ${fan_out[@]+"${fan_out[@]}"}; do
  [ "$max" -gt 0 ] && [ "$n_dispatched" -ge "$max" ] && break
  # `exhausted` SURVIVES THE PULL IT WAS WRITTEN FOR. It no longer has to stop
  # the loop re-offering a branch — a list cannot — but the gates below still
  # mark what they refused, and `sort -u` cannot merge a preflight candidate
  # with a scan-offered one where the two spellings differ.
  is_exhausted "$branch" && continue

  # THE PATH DISPATCH NO LONGER CREATES, still composed for the two readers that
  # need it: the dry run, which names where a desk WOULD go, and the monitor
  # report. The agent decides its own desk now, so this is a prediction rather
  # than a destination — and it stays flattened whole, because `feature/api` and
  # `bug/api` are different work and must not name one directory.
  suffix=$(printf '%s' "$branch" | tr '/' '-')
  wt="$wt_root/$wt_prefix$suffix"

  if [ "$dry_run" = 1 ]; then
    echo "would hand over $branch → the registry"
    report_monitors "$wt"
    report_in_flight "$branch"
    n_dispatched=$((n_dispatched + 1))
    continue
  fi

  # THE HELD-BRANCH GATE, and it survives the fan-out losing its writes.
  #
  # It refuses a branch whose own desk holds work that has not landed, and that
  # is a MEASUREMENT of somebody sitting at it — not a prediction about a file.
  # Dispatch creates no desk any more, so this no longer protects an adoption
  # path; it protects the hand-over itself. Handing a slice to the registry
  # while an agent is mid-edit on that branch is how two agents end up on one,
  # and the desk is the only place that work is visible: it is unpushed by
  # definition, so no ref and no PR reports it.
  #
  # `exhausted` is what makes the refusal terminal: --next has no memory and
  # would keep offering this same branch until the loop's own break fired.
  if held=$(held_worktree "$branch"); then
    report_held "$branch" "$held"
    n_skipped=$((n_skipped + 1))
    exhausted+=("$branch")
    continue
  fi

  # ALREADY REFUSED BY THE PREFLIGHT, and still asked here. A slice handed over
  # while its prerequisite is unmerged is an agent started on work that cannot
  # build, and `feature/the-domain-forgets-the-vendor-list` is the measured
  # case — claimed, and holding nothing but its claim commit.
  #
  # `exhausted` is what makes the refusal terminal — `--next` has no memory and
  # would keep offering this branch until the loop's own break fired. It should
  # not be offering it at all (the scan reads `waiting`), so this arm is the
  # belt to the preflight's brace: a branch offered by a scan that could not
  # reach the host still stops here, and it is NOT counted again — the preflight
  # already reported it.
  if is_waits_held "$branch"; then
    exhausted+=("$branch")
    continue
  fi

  # BEFORE anything is handed over. The candidate is not yet work in flight —
  # dispatch creates no desk and pushes no claim — so this describes what stood
  # before this run rather than what this run made.
  in_flight=$(report_in_flight "$branch")

  # THE BRIEF GATE, AT THE HAND-OVER RATHER THAN AT THE LAUNCH.
  #
  # ITS RULE IS UNCHANGED — a slice with no brief is not handed over — AND ONLY
  # ITS POSITION MOVED. It used to sit between a prepared desk and a started
  # worker, so a missing brief left a worktree and a claim nobody was sat at:
  # correct at the time, because preparing was the only thing dispatch could do
  # first. Dispatch now prepares nothing, so a refused slice leaves nothing at
  # all and simply stays in the queue.
  #
  # THE REFUSAL STILL NAMES THE REF IT LOOKED AT, not a bare path. A brief
  # sitting unpushed in the operator's checkout is the likeliest reason to see
  # this message, and `no brief at .plot/briefs/x.md` would send them to look at
  # a file that is right there — the ref says where the AGENT will look.
  #
  # `--no-brief` KEEPS ITS MEANING: it hands over without one and SAYS SO, so
  # the override stays on the record rather than being silent.
  if brief_present "$branch"; then
    # A brief that is present is never refused for age — see
    # `brief_staleness_note`. The note is printed before the hand-over so it
    # sits with the branch it describes, and the hand-over happens either way.
    brief_staleness_note "$branch"
  elif [ "$no_brief" = 1 ]; then
    echo "    no brief at $(brief_ref "$branch") — handing it over anyway (--no-brief)"
  else
    echo "    not handed over — no brief at $(brief_ref "$branch")"
    echo "      write one: /plot-implement $slug   (then push it, or pass --no-brief to hand it over without one)"
    # AND NOW SOMETHING IS DONE ABOUT IT. The refusal above stands unchanged;
    # this line says what happened NEXT. Either arm names itself, so the log
    # always records which one ran.
    request_brief "$branch" "$slug" && n_brief_asked=$((n_brief_asked + 1))
    n_skipped=$((n_skipped + 1))
    # `exhausted` is what makes the refusal terminal — `--next` has no memory
    # and would keep offering this branch until the loop's own break fired.
    exhausted+=("$branch")
    continue
  fi

  # THE HAND-OVER, AND IT IS THE WHOLE OF WHAT DISPATCH DOES WITH A SLICE.
  #
  # `git worktree add` USED TO BE HERE, with a claim push behind it and a worker
  # start behind that. All three are gone, and each for its own reason:
  #
  #   THE DESK. `DESIGN-agent.md:65` — *"agent ──owns──► a worktree (its desk,
  #   while it lives)"*. One desk per agent, not one per slice. The agent decides
  #   create-or-reset when it takes the brief, because it is the only party that
  #   can see its own tree; a desk cut here would be cut before anybody knows
  #   which agent will sit at it. Measured 2026-09-02: 2 manifests against 11
  #   worktrees, 5 of them on branches that had already merged.
  #
  #   THE CLAIM. A pushed claim makes the branch read `claimed` rather than
  #   `open`, and the queue is DERIVED — an eligible slice with a brief and no
  #   claim IS queued. Claiming here would take the slice straight back out of
  #   the queue it was being put into.
  #
  #   THE WORKER. `DESIGN-agent.md:157` — *"nothing starts a worker"*. The
  #   registry spawns an agent, and spawning it IS starting its process. This
  #   script hands work to the fleet; it does not staff it.
  #
  # SO THE HAND-OVER IS A REPORT AND NOT A WRITE. The queue derives from the
  # plan, the briefs and the refs, all of which are already on the host, so
  # there is nothing for this line to store — which is what keeps the daemon
  # stateless across restarts.
  #
  # IT REFUSES NOTHING FOR WANT OF A FREE AGENT, and never asks. An earlier
  # draft of the plan proposed refusing on `0 free` and it is wrong: it makes
  # dispatch synchronous with fleet capacity, the coupling `DESIGN-machine.md`
  # §10 spent two revisions rejecting, and `DESIGN-agent.md:173` states it from
  # the other side — *"a dispatch never asks the machine for capacity"*. **The
  # queue absorbs the timing.** A queue longer than the pool is the normal case.
  echo "handed over $branch → the registry"
  [ -n "$in_flight" ] && printf '%s\n' "$in_flight"
  n_dispatched=$((n_dispatched + 1))
  # AFTER the hand-over rather than after a claim. A `Started:` record now
  # states that the slice was handed to the fleet, which is what this run did;
  # who takes it is the registry's to decide and its own to record.
  claimed_now+=("$branch")

done

# Book AFTER the fan-out, in one commit, so a booking that fails cannot leave
# the plan claiming starts the run did not achieve. Its failure is reported and
# then ignored: the summary below reports what was dispatched either way.
book_started ${claimed_now[@]+"${claimed_now[@]}"} || true

# Check if we exceeded the cap and raise it if so — see "THE CAP GATES
# AUTO-DISPATCH AND WARNS A PERSON" above. Done AFTER workers are started so
# the count reflects the true state, and BEFORE the summary so the warning
# appears before the footer.
check_and_update_cap "$n_started"

print_summary "$n_dispatched" "$n_reused" "$n_skipped" "$n_started"
