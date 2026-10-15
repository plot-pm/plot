---
'plot': patch
'@plot-pm/board': patch
---

`plot-host.sh pr-merge` refuses an unpinned merge on GitHub (exit 1, naming `--match-head`) instead of merging first and failing later; the approve controller refuses to call it when a plan-PR names no head SHA, rather than merging unpinned.

<!--
plan: docs/plans/2026-10-15-a-lifecycle-micro-pr-merged-past.md
bumps:
  skills:
    plot: patch
-->
