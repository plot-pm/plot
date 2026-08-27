#!/usr/bin/env bash
# Plot helper: fan out one worktree + one worker per eligible branch.
# Usage: plot-dispatch.sh [--dry-run] [--no-start] [--no-brief] [--offline]
#                         [--max N] [--allow-local] <slug>
#        plot-dispatch.sh --migrate [--yes] [--max N]
#   --status    list fleet worktrees with worker pid, liveness, and last log
#               line; then exit. Works regardless of plan phase.
#   --stop <br> stop the worker on <br> (branch required — never "all").
#   --migrate   move legacy worktrees into the configured `Worktree root:`. An
#               idle worktree (no live worker, no unlanded work) is moved; a
#               busy one is skipped with the reason. Requires a `Worktree root:`
#               config — without one there is no destination. --dry-run by
#               default; --yes to actually move.
#   --dry-run   print what would happen; create nothing, push nothing
#   --yes       with --migrate, actually move the worktrees (default is dry-run)
#   --no-start  create worktrees and claim refs, but start no workers
#   --no-brief  start a worker even when its branch has no brief. The named
#               escape for the brief gate: a missing brief PREPARES (worktree +
#               claim) but does not START, because the worker's first
#               instruction is to read `.plot/briefs/<branch>.md` and it has
#               nothing to read. --no-brief overrides that and says so.
#   --offline   skip `git fetch`
#   --max N     dispatch at most N branches this run (default: all eligible)
#   --allow-local  read the plan's phase from the working tree when
#               origin/<main> cannot be resolved (no remote, fresh clone).
#               The explicit escape for a remote-less repo — never a default,
#               because a working-tree read is what this gate exists to avoid.
#   <slug>      the plan to fan out
# Output: one line per branch, each optionally followed by an indented
#         `in flight:` line naming a branch that already holds files, then the
#         summary block — an optional prose consequence line, then a
#         machine-countable footer.
#         A branch whose worktree exists with UNMERGED work is refused rather
#         than dispatched — counted `skipped`, with the worktree path named,
#         in `--dry-run` identically to a real run. See "THE HELD-BRANCH GATE".
#             3 worktrees prepared, 0 workers started, no `Worker command` configured
#             summary: dispatched=2 reused=0 skipped=1 started=2 brief=missing worker=unconfigured
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
no_start=0
no_brief=0
mode=dispatch
stop_branch=""
offline=""
allow_local=0
max=0
slug=""
migrate_yes=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)  dry_run=1 ;;
    --status)   mode=status ;;
    --migrate)  mode=migrate ;;
    --yes)      migrate_yes=1 ;;
    # Only a value containing "/" is taken as the branch: otherwise a bare
    # `--stop <slug>` would silently treat the plan slug as a branch name and
    # stop the wrong thing (or nothing) without saying so.
    --stop)     mode=stop; case "${2:-}" in */*) stop_branch="$2"; shift ;; esac ;;
    --no-start) no_start=1 ;;
    --no-brief) no_brief=1 ;;
    --offline|--no-fetch) offline="--offline" ;;
    --allow-local) allow_local=1 ;;
    --max)      max="${2:?--max needs a value}"
                case "$max" in
                  ''|*[!0-9]*) echo "plot-dispatch: --max needs a number, got '$max'" >&2; exit 1 ;;
                esac
                shift ;;
    -h|--help)  sed -n '2,28p' "$0"; exit 0 ;;
    *)          slug="$1" ;;
  esac
  shift
done

git rev-parse --git-dir >/dev/null 2>&1 || { echo "not a git repository" >&2; exit 1; }
[ -n "$slug" ] || [ "$mode" != dispatch ] || { echo "plot-dispatch: need a plan slug" >&2; exit 1; }

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

    # TWO INDEPENDENT CONDITIONS, because the brief names two: a worktree moves
    # only with NO LIVE WORKER **AND** NO UNLANDED WORK. They are separate
    # measurements, exactly as they are in plot-reap.sh, and folding them into
    # one verdict is a hole: plot_worker_state answers "is a WORKER running or
    # waiting here", and it is keyed on the worker RECORDS (`.plot-worker.pid`,
    # `.plot-worker.exit`). A hand-made worktree that never ran a Plot worker has
    # no records and reads `none` no matter how dirty its tree is — and the
    # hand-made worktrees are precisely the estate this mode exists to tidy. So
    # liveness and unlanded-work are asked as two questions below.

    # REFUSAL 1 & 2 — a LIVE WORKER, from the ONE shared answer. The brief is
    # explicit: plot_worker_state is the single answer to "is a worker running
    # in this worktree", sourced by both dispatch and the fleet scan. It carries
    # what a bare `ps` cannot — pid-reuse detection via the manifest's
    # `startedAt`, and the `waiting` state a PLOT-BLOCKED* marker produces.
    # Re-implementing either here is the drift the codebase fought to remove.
    wstate_row=$(plot_worker_state "$wt")
    state=$(printf '%s' "$wstate_row" | cut -f1)
    case "$state" in
      running)
        pid=$(printf '%s' "$wstate_row" | cut -f2)
        printf '%-8s %-52s %s\n' "keep" "$(basename "$wt")" "worker alive (pid $pid)"
        n_skipped=$((n_skipped + 1))
        continue ;;
      waiting)
        # The shared classifier reports `waiting` when a blocked marker exists:
        # a worker stopped to ask a person something. Moving it breaks the
        # checkout the answer is owed to.
        printf '%-8s %-52s %s\n' "keep" "$(basename "$wt")" "blocked marker — needs a person"
        n_skipped=$((n_skipped + 1))
        continue ;;
    esac

    # REFUSAL 3 — UNCOMMITTED WORK, measured independently of any worker record.
    # `plot_worker_dirty` applies the shared filter (editor leftovers and Plot's
    # own bookkeeping do not count), so this fires on real work only.
    dirty=$(plot_worker_dirty "$wt" | head -1 | cut -c1-40)
    if [ -n "$dirty" ]; then
      printf '%-8s %-52s %s\n' "keep" "$(basename "$wt")" "uncommitted: $dirty"
      n_skipped=$((n_skipped + 1))
      continue
    fi

    # REFUSAL 4 — UNPUSHED COMMITS. Work that exists only on this machine.
    # Only the branch's OWN upstream answers "pushed?"; an absent upstream leaves
    # the question unanswerable, and an unanswered question is not a refusal —
    # the same principle plot_worker_task_state reached the hard way (counting
    # against origin/main marked every clean branch stalled in a remote-less
    # repo). So no upstream falls through to "movable", not to "keep".
    if [ -n "$br" ]; then
      ahead=$(git -C "$wt" rev-list --count '@{upstream}..HEAD' 2>/dev/null || echo "")
      case "$ahead" in
        ''|0|*[!0-9]*) ;;  # no upstream, or nothing ahead: not a refusal
        *) printf '%-8s %-52s %s\n' "keep" "$(basename "$wt")" "unpushed commits ($ahead ahead)"
           n_skipped=$((n_skipped + 1))
           continue ;;
      esac
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

# Where the worktrees live and what their names carry — see resolve_wt_root.
# The default is beside the repo with the `plot-wt-` prefix; a `Worktree root:`
# key relocates them (and drops the prefix, which was only earning its keep
# among unrelated sibling directories). A nested root is made invisible to
# `git status` and the marker grep by a `.gitignore` line, not by living
# outside the repo.
repo_root=$(git rev-parse --show-toplevel)
resolve_wt_root "$repo_root"

n_dispatched=0 n_reused=0 n_skipped=0 n_started=0

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

# The summary block: an optional prose line, then the machine-countable footer.
#
# The prose line is printed only when there is a consequence to state — a
# summary that always explains itself teaches the reader to skip it, and then
# it is worth nothing on the day it matters. `worktrees prepared` counts
# dispatched + reused, because a re-adopted worktree is equally a desk nobody
# was sat at.
print_summary() { # $1=dispatched $2=reused $3=skipped $4=started
  local prepared=$(( $1 + $2 )) worker
  worker=$(worker_state_field)
  if [ "$prepared" -gt 0 ] && [ "$4" = 0 ]; then
    case "$worker" in
      unconfigured)
        echo "$prepared worktree$([ "$prepared" = 1 ] || echo s) prepared, 0 workers started, no \`Worker command\` configured" ;;
      declined)
        # Asked and answered: this repo starts its workers by hand. Stating the
        # count without calling it a gap — hand-starting is a legitimate
        # workflow, and repeating "not configured" at someone who decided that
        # on purpose is the nag the plan rules out.
        echo "$prepared worktree$([ "$prepared" = 1 ] || echo s) prepared, 0 workers started — this repo starts them by hand" ;;
      suppressed)
        echo "$prepared worktree$([ "$prepared" = 1 ] || echo s) prepared, 0 workers started (--no-start)" ;;
    esac
  fi
  echo "summary: dispatched=$1 reused=$2 skipped=$3 started=$4 brief=missing worker=$worker"
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
    existing=$(sed -n 's/.*"autoDispatch"[[:space:]]*:[[:space:]]*\(true\|false\).*/\1/p' "$FLEET_CONTROLS_FILE" | head -1)
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
    local br
    for br in "$@"; do
      append_started_line "$tmpwt/$rel" "$date" "$who" "$br" || {
        echo "plot-dispatch: $rel has no '## Status' section — nowhere to record" >&2
        rc=1
        break
      }
    done
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
    printf '  "branch": "%s",\n' "$(json_escape "$3")"
    printf '  "worktree": "%s",\n' "$(json_escape "$4")"
    printf '  "command": "%s",\n' "$(json_escape "$5")"
    printf '  "pid": "",\n'
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
# The path is the branch after its last `/`, under the repo root — the same
# convention `/plot-implement` writes and `briefPathOf` reads on the board side.
brief_path() { printf '%s/.plot/briefs/%s.md' "$repo_root" "${1##*/}"; }
brief_present() { # $1 = branch → 0 if a usable brief exists, 1 otherwise
  local b; b=$(brief_path "$1")
  [ -r "$b" ] && [ -s "$b" ]
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
  local session manifest_dir
  session=$(plot_session_id)
  manifest_dir="$repo_root/.plot/agents"
  mkdir -p "$manifest_dir" 2>/dev/null || true
  # `printf` per field with no interpretation: a command containing quotes,
  # newlines or backslashes must survive into valid JSON, and this is the one
  # place a Worker command's full text is recorded.
  write_agent_manifest "$manifest_dir/$session.json" \
    "$session" "$branch" "$wt" "$cmd" || true
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
  local stamp_now
  stamp_now=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  ( cd "$wt" && PLOT_BRANCH="$branch" PLOT_WORKTREE="$wt" \
      PLOT_SLUG="$slug" \
      PLOT_SESSION_ID="$session" \
      PLOT_MANIFEST_FILE="$manifest_dir/$session.json" \
      PLOT_STAMP_STARTED="$stamp_now" \
      PLOT_EXIT_FILE="$wt/.plot-worker.exit" PLOT_PID_FILE="$wt/.plot-worker.pid" \
      nohup sh -c '( '"$cmd"' ) & agent=$!; printf "%s" "$agent" > "$PLOT_PID_FILE"; if [ -f "$PLOT_MANIFEST_FILE" ]; then awk -v pid="$agent" -v started="$PLOT_STAMP_STARTED" '"'"'
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
          if (relaunch) {
            print "  \"previousPid\": \"" displaced "\","
            print "  \"relaunches\": " count ","
          }
          next
        }
        relaunch && $0 ~ /^  "previousPid": "[^"]*",$/ { next }
        relaunch && $0 ~ /^  "relaunches": [0-9]+,$/ { next }
        relaunch && $0 ~ /^  "startedAt": "[^"]*"$/ { print "  \"startedAt\": \"" started "\""; next }
        { print }
      '"'"' "$PLOT_MANIFEST_FILE" "$PLOT_MANIFEST_FILE" > "$PLOT_MANIFEST_FILE.plot-pid-tmp" 2>/dev/null && mv "$PLOT_MANIFEST_FILE.plot-pid-tmp" "$PLOT_MANIFEST_FILE" 2>/dev/null || rm -f "$PLOT_MANIFEST_FILE.plot-pid-tmp"; fi; wait "$agent"; rc=$?; printf "%s" "$rc" > "$PLOT_EXIT_FILE"' \
      >"$log" 2>&1 </dev/null & echo $! >"$wt/.plot-worker.wrapper.pid" )
  echo "    started worker (log: $log)"
  return 0
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

  # Its tip landed already — a leftover desk, not a held one.
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
    echo "would dispatch $br → $(worktree_for "$br")"
    report_in_flight "$br"
    n_dispatched=$((n_dispatched + 1))
  done < <("$script_dir/plot-fleet-scan.sh" $offline --list-eligible "$slug" 2>/dev/null)
  # A dry run starts nothing BY CONSTRUCTION, so its `started=0` carries no
  # information about the config — reporting "no workers started" here would be
  # true and useless, and would train the reader to skip the line on the real
  # run where it matters. Only the machine field travels.
  # `skipped` is REAL here, not a constant. A dry run refuses held branches
  # exactly as the real run does, so its count is a fact about this fleet — and
  # it was hardcoded to 0 until the gate gave it something to count.
  echo "summary: dispatched=$n_dispatched reused=0 skipped=$n_skipped started=0 brief=missing worker=$(worker_state_field)"
  exit 0
fi

# Ask the fleet scan for eligible-and-unclaimed branches, one at a time.
# Re-asking after each claim is deliberate (pull, not push): the answer changes
# as we claim, and a list computed up front would go stale mid-fan-out.
while :; do
  [ "$max" -gt 0 ] && [ "$n_dispatched" -ge "$max" ] && break

  branch=$("$script_dir/plot-fleet-scan.sh" $offline --next "$slug" 2>/dev/null) || break
  [ -n "$branch" ] || break
  # --next has no memory; if it offers something we already failed on, the
  # eligible set is exhausted for this run.
  is_exhausted "$branch" && break

  # Flatten the whole branch name, not just its last segment: feature/api and
  # bug/api are different work and must not share a worktree (a shared path
  # also makes --stop act on whichever claimed it first).
  suffix=$(printf '%s' "$branch" | tr '/' '-')
  wt="$wt_root/$wt_prefix$suffix"

  if [ "$dry_run" = 1 ]; then
    echo "would dispatch $branch → $wt"
    report_in_flight "$branch"
    n_dispatched=$((n_dispatched + 1))
    continue
  fi

  # THE HELD-BRANCH GATE, ahead of every write this loop makes.
  #
  # Ahead of the adoption path below in particular: `reusing existing worktree`
  # is right for a desk THIS script laid out and a worker has since finished
  # with, and wrong for one an operator opened by hand and is still using — and
  # by tip alone those two are the same directory. Unlanded work is what
  # separates them, so the gate asks first and adoption only sees what is left.
  #
  # `exhausted` is what makes the refusal terminal: --next has no memory and
  # would keep offering this same branch until the loop's own break fired.
  if held=$(held_worktree "$branch"); then
    report_held "$branch" "$held"
    n_skipped=$((n_skipped + 1))
    exhausted+=("$branch")
    continue
  fi

  # BEFORE the worktree exists. Once dispatch has created this candidate's
  # worktree and claim, the candidate is itself work in flight, and a report
  # taken afterwards would describe the fan-out rather than what preceded it.
  in_flight=$(report_in_flight "$branch")

  # Adopt an existing worktree rather than duplicating it.
  if git worktree list --porcelain | grep -qx "worktree $wt"; then
    echo "reusing existing worktree for $branch → $wt"
    [ -n "$in_flight" ] && printf '%s\n' "$in_flight"
    n_reused=$((n_reused + 1))
  else
    git worktree add -q -b "$branch" "$wt" "origin/$MAIN" 2>/dev/null || {
      # Branch exists locally already: attach the worktree to it instead.
      git worktree add -q "$wt" "$branch" 2>/dev/null || {
        echo "skipped $branch (cannot create worktree)"
        n_skipped=$((n_skipped + 1))
        exhausted+=("$branch")
        continue
      }
    }
    # THE CLAIM. Rejection means another session won the race; leave its
    # worktree alone and move on to the next branch.
    #
    # The claim carries an EMPTY COMMIT, and that is load-bearing. Pushing a
    # branch that merely points at origin/<main> is a no-op: the remote already
    # has that commit, so the push succeeds with "Everything up-to-date" and
    # BOTH dispatchers believe they own the branch. Mutual exclusion requires
    # the refs to diverge — two independent claim commits are not fast-forwards
    # of each other, so the second push is rejected as non-fast-forward.
    #
    # Never add --force or --force-with-lease here: forcing is precisely what
    # would let a second dispatcher take a branch someone is working on.
    git -C "$wt" -c "user.name=${PLOT_CLAIM_WHO:-$(git config user.name || echo plot)}" \
        commit -q --allow-empty -m "plot: claim $branch" 2>/dev/null
    if git -C "$wt" push -q -u origin "$branch" 2>/dev/null; then
      echo "dispatched $branch → $wt"
      # Reported AFTER the claim, never before: a branch another dispatcher won
      # is not this run's to describe. The facts themselves were read before the
      # worktree existed, so the claim cannot have polluted them.
      [ -n "$in_flight" ] && printf '%s\n' "$in_flight"
      n_dispatched=$((n_dispatched + 1))
      # AFTER the claim push, never before. A Started: record for a branch
      # another dispatcher won would be a lie in the file, and the claim is the
      # only thing that decides who holds a branch.
      claimed_now+=("$branch")
    else
      echo "skipped $branch (claimed by another session)"
      git worktree remove --force "$wt" 2>/dev/null || true
      n_skipped=$((n_skipped + 1))
      exhausted+=("$branch")
      continue
    fi
  fi

  if [ "$no_start" = 0 ]; then
    # THE BRIEF GATE, between preparing and starting. Prepared work above stands;
    # only the launch is conditional. A missing brief refuses, naming the file
    # and the two ways forward — write it, or pass --no-brief. --no-brief starts
    # anyway and SAYS SO, so the override is on the record rather than silent.
    if brief_present "$branch"; then
      start_worker "$branch" "$wt" && n_started=$((n_started + 1))
    elif [ "$no_brief" = 1 ]; then
      echo "    no brief at $(brief_path "$branch") — starting anyway (--no-brief)"
      start_worker "$branch" "$wt" && n_started=$((n_started + 1))
    else
      echo "    prepared, not started — no brief at $(brief_path "$branch")"
      echo "      write one: /plot-implement $slug   (or pass --no-brief to start without it)"
    fi
  fi
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
