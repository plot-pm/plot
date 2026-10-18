---
'plot': minor
---

The tracker port gains `planStateWrite`: on a GitHub issue it sets one `plan:*` label, keeps one comment linking the plan and closes the issue at release, through the new `plot-host.sh` operations `issue-label`, `issue-comment` and `issue-close`. `issueStatusWrites` gains the `approved` phase and `Tracker approved status`. No lifecycle command calls the write yet.

<!--
plan: docs/plans/2026-10-17-a-planned-issue-shows-its-plan.md
bumps:
  skills:
    plot: minor
-->
