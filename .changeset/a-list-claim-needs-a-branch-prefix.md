---
'@plot-pm/board': patch
---

`plot-deliver --release` no longer refuses a plan because a file-list line under a slice names no `→ #N`: a list line is a branch claim only when its token starts with a `Branch prefixes` entry, or when the line names a PR in another repository.

<!--
plan: docs/plans/2026-11-07-branchclaims-reads-file-list-lines-in.md
bumps:
  skills:
    plot: patch
-->
