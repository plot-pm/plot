#!/usr/bin/env bash
# Plot helper: fan out one worktree + one worker per eligible branch.
# Usage: plot-dispatch.sh [--dry-run] [--no-start] [--offline] [--max N] <slug>
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
#   - Claim by ref push. A push that would overwrite an existing branch is
#     REJECTED, and that rejection is the concurrency control — two dispatchers
#     racing for the same branch cannot both win. Git is the lock.
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
offline=""
max=0
slug=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)  dry_run=1 ;;
    --no-start) no_start=1 ;;
    --offline|--no-fetch) offline="--offline" ;;
    --max)      max="${2:?--max needs a value}"; shift ;;
    -h|--help)  sed -n '2,9p' "$0"; exit 0 ;;
    *)          slug="$1" ;;
  esac
  shift
done

git rev-parse --git-dir >/dev/null 2>&1 || { echo "not a git repository" >&2; exit 1; }
[ -n "$slug" ] || { echo "plot-dispatch: need a plan slug" >&2; exit 1; }

MAIN=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
[ -n "$MAIN" ] || MAIN="main"
[ -n "$offline" ] || git fetch -q origin "$MAIN" 2>/dev/null

# Worktrees live beside the repo, not inside it: a worktree nested in the repo
# would show up in its own status and in every glob.
repo_root=$(git rev-parse --show-toplevel)
wt_root=$(cd "$repo_root/.." && pwd)

n_dispatched=0 n_reused=0 n_skipped=0 n_started=0

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
    echo "    (no 'Worker command' in Plot Config — worktree ready, start it yourself)"
    return 1
  fi
  local log="$wt/.plot-worker.log"
  ( cd "$wt" && PLOT_BRANCH="$branch" PLOT_WORKTREE="$wt" \
      nohup sh -c "$cmd" >"$log" 2>&1 </dev/null & echo $! >"$wt/.plot-worker.pid" )
  echo "    started worker (pid $(cat "$wt/.plot-worker.pid" 2>/dev/null || echo '?')), log: $log"
  return 0
}

# A dry run changes nothing, so nothing can go stale — read the whole eligible
# set once. (`--next` would loop forever here: without a claim it keeps
# returning the same branch.)
if [ "$dry_run" = 1 ]; then
  while read -r br; do
    [ -n "$br" ] || continue
    echo "would dispatch $br → $wt_root/plot-wt-${br##*/}"
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

  suffix=${branch##*/}
  wt="$wt_root/plot-wt-$suffix"

  if [ "$dry_run" = 1 ]; then
    echo "would dispatch $branch → $wt"
    n_dispatched=$((n_dispatched + 1))
    dry_seen+=("$branch")
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
        continue
      }
    }
    # THE CLAIM. Rejection means another session won the race; leave its
    # worktree alone and move on to the next branch.
    if git -C "$wt" push -q -u origin "$branch" 2>/dev/null; then
      echo "dispatched $branch → $wt"
      n_dispatched=$((n_dispatched + 1))
    else
      echo "skipped $branch (claimed by another session)"
      git worktree remove --force "$wt" 2>/dev/null || true
      n_skipped=$((n_skipped + 1))
      continue
    fi
  fi

  if [ "$no_start" = 0 ]; then
    start_worker "$branch" "$wt" && n_started=$((n_started + 1))
  fi
done

echo "summary: dispatched=$n_dispatched reused=$n_reused skipped=$n_skipped started=$n_started"
