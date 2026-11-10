---
'@plot-pm/board': patch
---

fleetd and the board server read plan files, tree listings and release versions from one `git cat-file` process per repository instead of starting `git ls-tree`, `git cat-file` and `git show` for each read; a read falls back to its own `git` while that process is paused. Both refuse to start on a git older than 2.42 and name the version found, and `plot-board-setup` names the minimum. `listBlobs` returns a non-ASCII path unquoted on both paths.

<!--
plan: docs/plans/2026-11-09-one-cat-file-batch.md
bumps:
  skills:
    plot: patch
    plot-board-setup: patch
-->
