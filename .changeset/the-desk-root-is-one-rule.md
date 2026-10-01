---
'plot': patch
'@plot-pm/board': patch
---

Dispatch worktrees and the board's action records go to `<repo>/.worktrees` when no `Worktree root` is configured, instead of the checkout's parent. One domain rule, `deskRoot`, answers the location for the board and for every script, through the new `plot-desk-root.mjs` bundle and the sourced `plot-desk-root.sh` helper. The root is always the main checkout, also when a script runs inside a desk. New desks carry no `plot-wt-` prefix; existing `plot-wt-*` desks stay where they are, and the reaper still recognises them. Whoever creates the directory adds `/.worktrees/` to the common git directory's `info/exclude`, so it does not show in `git status`.

<!--
plan: docs/plans/2026-10-01-plot-keeps-its-files-inside-the-repository.md
bumps:
  skills:
    plot: patch
    plot-init: patch
-->
