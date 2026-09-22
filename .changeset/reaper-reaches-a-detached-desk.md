---
'plot': patch
---

The reaper and the reconcile sweep both see a detached worktree. The awk feeding their worktree loops emitted a record only where a `branch ` line was read, and `git worktree list --porcelain` prints `detached` instead — measured, 4 rows for 19 worktrees, so thirteen desks cut by `plot-dispatch.sh --start` were neither reaped, kept, nor counted. A detached desk carrying no commits beyond its base now reads as having nothing to land, rather than being refused forever for a PR it could never have.

<!--
plan: docs/plans/2026-09-22-a-free-desk-is-nobodys.md
bumps:
  skills:
    plot: patch
-->
