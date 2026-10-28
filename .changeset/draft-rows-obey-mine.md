---
'@plot-pm/board': patch
---

A Draft plan's WAITING ON YOU row now carries its assignee, author and approver, and the «Mine» filter hides it the same way it hides every other owned row. Previously the row rendered straight from `draftPlanRows` with no ownership check, so a Draft plan belonging to someone else stayed visible with the filter on. A row whose owner cannot be determined still stays, as the filter's existing contract requires.

<!--
plan: docs/plans/2026-10-28-empty-jira-inbox-read-as-a.md
bumps:
  skills:
    plot: patch
-->
