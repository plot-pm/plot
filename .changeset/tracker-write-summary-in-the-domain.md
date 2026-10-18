---
'plot': patch
---

`plot-issue-status.sh` and `plot-plan-state.sh` print a `summary: tracker=<outcome>` line reduced from their per-issue outcomes by the new domain function `trackerWriteSummary` (`packages/domain/src/rules/issue-status.ts`), replacing the shared shell helper `plot-tracker-write.sh`, which is deleted — a failed write now always outranks a written one in the summary, regardless of order.

<!--
plan: docs/plans/2026-10-17-a-planned-issue-shows-its-plan.md
bumps:
  skills:
    plot: patch
-->
