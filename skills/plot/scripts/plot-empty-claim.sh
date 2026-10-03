#!/usr/bin/env bash
# Plot helper: the ONE answer to "is this commit an empty claim marker?"
#
# SOURCED, NOT RUN. `. "$script_dir/plot-empty-claim.sh"` defines
# `plot_is_empty_claim_commit` and nothing else on load — the same shape as
# `plot-pr-merged.sh`, for the same reason: two callers ask the SAME question
# and must never disagree about the answer.
#
# THE DEFINITION IS NOT NEW. `plot-reap.sh`'s `sweep_is_empty_claim` and
# `plot-reconcile-scan.sh`'s `real_commits_beyond_main` already agreed: a
# commit is an empty claim marker when its subject starts with `plot: claim `
# AND its tree equals its parent's tree. Both conditions are required — a
# human commit titled "plot: claim handling refactor" carrying real files
# would otherwise read as an empty claim. This file extracts the per-commit
# predicate so a third caller (`plot-worker-loop.sh`'s `yield_the_held_checkout`)
# does not grow a third copy.
#
# A COMMIT WITH NO PARENT (the repo's root) is never a claim marker: there is
# no parent tree to compare against, so the predicate returns false rather than
# guessing.
#
# `$2` NAMES THE REPOSITORY, defaulting to the one `git` already resolves from
# the caller's cwd. `-C` rather than a `cd`, because a caller walking commits
# in another worktree (`yield_the_held_checkout`'s holder) must not move its
# own cwd to do it.
plot_is_empty_claim_commit() { # $1=commit sha $2=repo (optional) → 0 when it is an empty claim marker
  local c="$1" repo="${2:-.}" subj
  subj=$(git -C "$repo" log -1 --format=%s "$c" -- 2>/dev/null)
  case "$subj" in
    "plot: claim "*)
      [ "$(git -C "$repo" rev-parse "$c^{tree}" -- 2>/dev/null)" \
        = "$(git -C "$repo" rev-parse "$c^^{tree}" -- 2>/dev/null)" ]
      ;;
    *) return 1 ;;
  esac
}
