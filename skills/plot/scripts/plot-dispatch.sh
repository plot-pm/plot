#!/usr/bin/env bash
# Plot helper: fan out one worktree + one worker per eligible branch.
# Usage: plot-dispatch.sh [--dry-run] [--no-start] [--offline] [--max N] <slug>
#   --status    list fleet worktrees with worker pid, liveness, and last log
#               line; then exit. Works regardless of plan phase.
#   --stop <br> stop the worker on <br> (branch required — never "all").
#   --dry-run   print what would happen; create nothing, push nothing
#   --no-start  create worktrees and claim refs, but start no workers
#   --offline   skip `git fetch`
#   --max N     dispatch at most N branches this run (default: all eligible)
#   <slug>      the plan to fan out
# Output: one line per branch, terminated by a machine-countable summary:
#             summary: dispatched=2 reused=0 skipped=1 started=2
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

dry_run=0
no_start=0
mode=dispatch
stop_branch=""
offline=""
max=0
slug=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)  dry_run=1 ;;
    --status)   mode=status ;;
    # Only a value containing "/" is taken as the branch: otherwise a bare
    # `--stop <slug>` would silently treat the plan slug as a branch name and
    # stop the wrong thing (or nothing) without saying so.
    --stop)     mode=stop; case "${2:-}" in */*) stop_branch="$2"; shift ;; esac ;;
    --no-start) no_start=1 ;;
    --offline|--no-fetch) offline="--offline" ;;
    --max)      max="${2:?--max needs a value}"
                case "$max" in
                  ''|*[!0-9]*) echo "plot-dispatch: --max needs a number, got '$max'" >&2; exit 1 ;;
                esac
                shift ;;
    -h|--help)  sed -n '2,13p' "$0"; exit 0 ;;
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
wt_root_early=$(cd "$repo_root_early/.." && pwd)

# States: "running <pid>" | "finished <pid>" | "failed <pid> (exit N)"
#       | "ended <pid> (status unknown)" | "no worker"
#
# `kill -0` only separates running from not-running. Whether a stopped worker
# finished its job or crashed is gone unless the exit code was recorded — and
# reporting a completed worker as "dead" reads as a crash, which is how a
# healthy fleet looks broken. The wrapper in start_worker writes the code.
worker_state() { # $1=worktree
  local wt="$1" pid code
  [ -f "$wt/.plot-worker.pid" ] || { echo "no worker"; return; }
  pid=$(cat "$wt/.plot-worker.pid" 2>/dev/null | tr -d ' \n')
  [ -n "$pid" ] || { echo "no worker"; return; }
  # `kill -0 0` signals the whole process GROUP and succeeds, so pid 0 would
  # read as running forever. It is never a real worker pid.
  case "$pid" in 0|*[!0-9]*) echo "no worker"; return ;; esac
  if kill -0 "$pid" 2>/dev/null; then echo "running $pid"; return; fi
  if [ -f "$wt/.plot-worker.exit" ]; then
    code=$(cat "$wt/.plot-worker.exit" 2>/dev/null | tr -d ' \n')
    case "$code" in
      0)  echo "finished $pid" ;;
      "") echo "ended $pid (status unknown)" ;;
      *)  echo "failed $pid (exit $code)" ;;
    esac
    return
  fi
  # No exit file: a worker started before this was recorded, or one killed
  # outright. Unknown is its own answer — guessing "finished" would be the
  # same mistake in the other direction.
  echo "ended $pid (status unknown)"
}

if [ "$mode" = "status" ]; then
  n_live=0 n_done=0 n_failed=0 n_ended=0 n_none=0
  for wt in "$wt_root_early"/plot-wt-*; do
    [ -d "$wt" ] || continue
    br=$(git -C "$wt" branch --show-current 2>/dev/null || echo "?")
    st=$(worker_state "$wt")
    case "$st" in
      running*)  n_live=$((n_live + 1)) ;;
      finished*) n_done=$((n_done + 1)) ;;
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
  [ $((n_live + n_done + n_failed + n_ended + n_none)) -gt 0 ] \
    || echo "  (no fleet worktrees under $wt_root_early)"
  echo "summary: running=$n_live finished=$n_done failed=$n_failed ended=$n_ended no_worker=$n_none"
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
  wt="$wt_root_early/plot-wt-$(printf '%s' "$stop_branch" | tr '/' '-')"
  [ -d "$wt" ] || { echo "plot-dispatch: no worktree for '$stop_branch' at $wt" >&2; exit 1; }
  st=$(worker_state "$wt")
  case "$st" in
    running*)
      pid=${st#running }
      kill "$pid" 2>/dev/null && echo "stopped $stop_branch (pid $pid)" \
        || { echo "plot-dispatch: could not stop pid $pid" >&2; exit 1; }
      # The worktree and its claim are left in place: the branch is still taken,
      # and deleting either would be the kind of write this design avoids.
      echo "  worktree kept at $wt — the claim stands until you release it"
      ;;
    finished*|failed*|ended*) echo "$stop_branch is not running ($st)" ;;
    *)      echo "$stop_branch has no worker" ;;
  esac
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
PLAN_DIR_CFG=$("$script_dir/plot-config.sh" get "Plan directory" "docs/plans/")
ACTIVE_DIR_CFG=$("$script_dir/plot-config.sh" get "Active index" "docs/plans/active/")
plan_file=""
for cand in "$ACTIVE_DIR_CFG$slug.md" "$PLAN_DIR_CFG"*"$slug".md; do
  [ -e "$cand" ] && { plan_file="$cand"; break; }
done

if [ -z "$plan_file" ]; then
  echo "plot-dispatch: no plan found for '$slug' — looked in $ACTIVE_DIR_CFG and $PLAN_DIR_CFG" >&2
  exit 1
fi

gate_meta=$("$script_dir/plot-plan-meta.sh" "$plan_file" 2>/dev/null) || gate_meta=""
gate_phase=$(printf '%s' "$gate_meta" | sed -n 's/.*"phase":"\([^"]*\)".*/\1/p')
gate_impl=$(printf '%s' "$gate_meta" | sed -n 's/.*"impl":"\([^"]*\)".*/\1/p')

case "$gate_phase" in
  approved) ;;
  draft)
    echo "plot-dispatch: plan '$slug' is still Draft — nothing may be dispatched." >&2
    echo "  Review it, then: /plot-approve $slug" >&2
    exit 1 ;;
  delivered|released)
    echo "plot-dispatch: plan '$slug' is already $gate_phase — its work is done." >&2
    exit 1 ;;
  "")
    echo "plot-dispatch: cannot read the phase of '$slug' ($plan_file)." >&2
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

MAIN=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
[ -n "$MAIN" ] || MAIN="main"
[ -n "$offline" ] || git fetch -q origin "$MAIN" 2>/dev/null

# Worktrees live beside the repo, not inside it: a worktree nested in the repo
# would show up in its own status and in every glob.
repo_root=$(git rev-parse --show-toplevel)
wt_root=$(cd "$repo_root/.." && pwd)

n_dispatched=0 n_reused=0 n_skipped=0 n_started=0

# Branches this run cannot dispatch. --next re-asks each iteration (pull
# semantics), and a branch that is never CLAIMED keeps coming back — without
# this the loop spins forever on the first undispatchable branch.
declare -a exhausted=()
is_exhausted() {
  local x
  for x in ${exhausted[@]+"${exhausted[@]}"}; do [ "$x" = "$1" ] && return 0; done
  return 1
}

# Start one DETACHED worker per worktree. Detached is the whole point: the
# fleet must outlive the dispatching session. Logs go beside the worktree so a
# human can read them without knowing anything about how the worker was started.
#
# The worker command is configurable because "how do I run an agent headless"
# is a per-project, per-tool answer that Plot must not hardcode (Principle 5).
start_worker() {
  local branch="$1" wt="$2"
  local cmd
  cmd=$("$script_dir/plot-config.sh" get "Worker command" "")
  if [ -z "$cmd" ]; then
    # Not an error: Plot deliberately hardcodes no agent tooling (Principle 5).
    # Word it as the next step rather than a failure, or a first run reads as
    # "it did nothing".
    echo "    worktree ready — no 'Worker command' configured, so start it yourself:"
    echo "      cd $wt   # branch $branch is claimed and waiting"
    echo "    To start workers automatically, add to your CLAUDE.md Plot Config:"
    echo "      - **Worker command:** <how to run your agent headless>"
    return 1
  fi
  local log="$wt/.plot-worker.log"
  rm -f "$wt/.plot-worker.exit"
  ( cd "$wt" && PLOT_BRANCH="$branch" PLOT_WORKTREE="$wt" PLOT_EXIT_FILE="$wt/.plot-worker.exit" \
      nohup sh -c '( '"$cmd"' ); rc=$?; printf "%s" "$rc" > "$PLOT_EXIT_FILE"' \
      >"$log" 2>&1 </dev/null & echo $! >"$wt/.plot-worker.pid" )
  echo "    started worker (pid $(cat "$wt/.plot-worker.pid" 2>/dev/null || echo '?')), log: $log"
  return 0
}

# A dry run changes nothing, so nothing can go stale — read the whole eligible
# set once. (`--next` would loop forever here: without a claim it keeps
# returning the same branch.)
if [ "$dry_run" = 1 ]; then
  while read -r br; do
    [ -n "$br" ] || continue
    echo "would dispatch $br → $wt_root/plot-wt-$(printf '%s' "$br" | tr '/' '-')"
    n_dispatched=$((n_dispatched + 1))
  done < <("$script_dir/plot-fleet-scan.sh" $offline --list-eligible "$slug" 2>/dev/null)
  echo "summary: dispatched=$n_dispatched reused=0 skipped=0 started=0"
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
  wt="$wt_root/plot-wt-$suffix"

  if [ "$dry_run" = 1 ]; then
    echo "would dispatch $branch → $wt"
    n_dispatched=$((n_dispatched + 1))
    continue
  fi

  # Adopt an existing worktree rather than duplicating it.
  if git worktree list --porcelain | grep -qx "worktree $wt"; then
    echo "reusing existing worktree for $branch → $wt"
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
      n_dispatched=$((n_dispatched + 1))
    else
      echo "skipped $branch (claimed by another session)"
      git worktree remove --force "$wt" 2>/dev/null || true
      n_skipped=$((n_skipped + 1))
      exhausted+=("$branch")
      continue
    fi
  fi

  if [ "$no_start" = 0 ]; then
    start_worker "$branch" "$wt" && n_started=$((n_started + 1))
  fi
done

echo "summary: dispatched=$n_dispatched reused=$n_reused skipped=$n_skipped started=$n_started"
