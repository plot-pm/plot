---
'plot': patch
---

Approve and deliver pick the sprint file `sprintOfPlan` names instead of the first file a directory scan finds containing the plan's slug, so a plan carried into a second sprint, or an alphabetically-earlier Closed sprint, no longer gets annotated or ticked in the wrong one. The lookup also no longer depends on the plan's `Sprint:` field being set.

<!--
plan: docs/plans/2026-11-01-a-plan-that-joins-a-sprint.md
bumps:
  skills:
    plot-approve: patch
    plot-deliver: patch
-->
