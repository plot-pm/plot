---
'plot': patch
'@plot-pm/board': patch
---

A branch with no commit of its own that sits behind the default branch no longer reads as merged when the host was asked: it reads `merged` only for a merged pull request or an offline scan, `wip` for an open one, `open` when a complete pull-request list holds none, and `unknown` otherwise. The fleet scan sends the list's completeness to the branch-state bundle as an eleventh field.

<!--
plan: docs/plans/2026-09-30-a-slice-nobody-worked-on-reads-not-started.md
bumps:
  skills:
    plot: patch
-->
