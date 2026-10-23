---
'@plot-pm/board': patch
---

An issue named only by released plans no longer appears under Assigned to you — `waitingTickets` now excludes a row once every plan naming it is released, counting it toward the hidden total instead, while a row named by at least one unfinished plan still renders labelled by that plan.

<!--
plan: docs/plans/2026-10-23-released-plans-leave-their-github-issues.md
bumps:
  skills:
    plot: patch
-->
