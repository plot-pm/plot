---
"plot": minor
---

`plot-dispatch.sh --migrate` moves idle legacy worktrees into the configured `Worktree root:`.

A repo that adopts a `Worktree root:` after it already has worktrees in the
legacy default (beside the repo, `plot-wt-*`) can move the existing ones into
the configured root. New dispatches already go there; `--migrate` converges the
ones on disk — including the checkouts `plot-reap.sh` refuses forever, whose
PRs closed unmerged while their work reached main by other routes.

**The refusals are the feature.** `git worktree move` on a checkout an agent is
writing to breaks it mid-run, so `--migrate` moves a worktree only when it has
no live worker and no unlanded work, and names every one it skipped with the
reason — modelled on `plot-reap.sh`. Liveness is asked through the shared
`plot-worker-state.sh` (the one answer, carrying pid-reuse and `PLOT-BLOCKED`
detection); uncommitted and unpushed work are measured independently, since a
hand-made worktree with no worker record is idle to `plot-worker-state.sh`
regardless of a dirty tree. `--dry-run` by default, `--yes` moves. A repo
declaring no `Worktree root:` has nothing to migrate and says so. It touches no
branch and no ref, and `--migrate` is never required — a mixed estate is an
ordinary state.

<!--
bumps:
  skills:
    plot-dispatch: minor
    plot: patch
-->
