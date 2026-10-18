---
'plot': patch
---

`plot-issue-status.sh` and `plot-plan-state.sh` end with one `summary: tracker=<outcome>` line, which the domain function `trackerWriteSummary` (`packages/domain/src/rules/issue-status.ts`) reduces from the per-issue outcomes: the worst outcome present wins, in the order written, no-target, unaskable, failed, and `none` means no write was owed.

<!--
plan: docs/plans/2026-10-17-a-planned-issue-shows-its-plan.md
bumps:
  skills:
    plot: patch
-->
