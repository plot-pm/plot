---
'plot': patch
---

`plot-review-status.sh` reports every PR a sprint item's `pr:` annotation names, so an item annotated `<!-- pr: #3645, #3649 -->` no longer reads as PR 3645 alone: `pr` keeps the first number for existing consumers, and a new `prs` array carries all of them.

<!--
plan: docs/plans/2026-10-22-plot-review-status-sh-reports-only.md
bumps:
  skills:
    plot: patch
-->
