#!/usr/bin/env bash
# Plot helper: worker loop — implements then asks for the next wave.
# Usage: plot-worker-loop.sh
# Environment: PLOT_BRANCH, PLOT_WORKTREE, PLOT_SLUG (from dispatcher)
#
# This is the looping shell the Worker command calls. After each branch
# completes, it asks `--next` for another claimable branch OF THE SAME PLAN,
# claims it, creates its worktree, and loops. Exit 1 from `--next` is
# "nothing to start" and breaks the loop cleanly.
#
# THE PROMPT is read from `.plot/worker-prompt.sh` in the repo root. That file
# contains the literal `claude -p "..."` invocation the loop runs each
# iteration. Keeping it in a file rather than a Plot Config key avoids the
# parser stripping `$(...)` constructs, and lets the prompt be as long as
# needed without making CLAUDE.md unreadable.
#
# THE CLAIM is the same ref push dispatch uses: an empty commit titled
# `plot: claim <branch>`, which diverges from any other claim attempt so only
# one push succeeds. A failed push means another worker won the race; the loop
# removes that worktree and tries `--next` again.
#
# A worker that hops takes NO NEW SLOT: the cap counts sessions, and a hopping
# worker is one session continuing, not a second one spawning. This is why the
# cap can be enforced without stalling the fleet — at the cap, work continues
# through the workers already running.
set -uo pipefail

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || repo_root="."

# Read the prompt from the dedicated file. A file rather than a config key
# because plot-config.sh strips `(...)` as prose, and the prompt legitimately
# contains shell constructs like ${PLOT_BRANCH##*/}.
prompt_file="$repo_root/.plot/worker-prompt.sh"
if [ ! -f "$prompt_file" ]; then
  echo "plot-worker-loop: no prompt file at $prompt_file" >&2
  echo "  Create it with the inner claude -p invocation, e.g.:" >&2
  echo "    claude -p \"You are implementing the branch \$PLOT_BRANCH...\" --permission-mode bypassPermissions" >&2
  exit 1
fi

# Determine the main branch for worktree creation.
main_branch=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')
[ -z "$main_branch" ] && main_branch=main

while true; do
  # Run the worker prompt in the current worktree.
  # The prompt file is sourced so $PLOT_BRANCH etc. expand at runtime.
  # shellcheck source=/dev/null
  . "$prompt_file"

  # Ask for the next claimable branch of the same plan.
  next_branch=$("$script_dir/plot-fleet-scan.sh" --next "$PLOT_SLUG" 2>/dev/null) || break

  # Create worktree for the next branch.
  wt_root=$(dirname "$PLOT_WORKTREE")
  suffix=$(printf '%s' "$next_branch" | tr '/' '-')
  new_wt="$wt_root/plot-wt-$suffix"

  git worktree add -b "$next_branch" "$new_wt" "origin/$main_branch" 2>/dev/null || \
    git worktree add "$new_wt" "$next_branch" 2>/dev/null || break

  # Claim the branch with an empty commit.
  git -C "$new_wt" commit --allow-empty -m "plot: claim $next_branch" 2>/dev/null

  # Push the claim — if it fails, another worker won the race.
  if ! git -C "$new_wt" push -u origin "$next_branch" 2>/dev/null; then
    git worktree remove --force "$new_wt" 2>/dev/null || true
    continue
  fi

  # Move to the new worktree and update environment for the next iteration.
  cd "$new_wt" || break
  export PLOT_BRANCH="$next_branch"
  export PLOT_WORKTREE="$new_wt"
done
