---
'plot': minor
'@plot-pm/board': minor
---

A slice's pull request is opened through a controller rather than by hand. `plot-open-pr.sh` asks `openSlicePr` and calls `plot-host.sh pr-create` with what it decided, so the title is the wave heading the plan names the branch under rather than the last commit subject, the body names the plan and the brief, and a branch carrying nothing outside a `PLOT-BLOCKED` marker is named at open time instead of at delivery.

<!--
plan: docs/plans/2026-09-08-the-master-agent-uses-the-controllers.md
bumps:
  skills:
    plot: minor
    plot-implement: minor
    plot-sprint: patch
-->
