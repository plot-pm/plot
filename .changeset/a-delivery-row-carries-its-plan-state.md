---
'@plot-pm/board': patch
---

A Delivery row carries its plan's lifecycle state in `AgentRow.planState`, read by the domain's `planStateOf`, and the Delivery tab places the row by that state instead of by its column name. An approved tracer plan's slices now list under Work items, and an `idea/` row or a delivered plan places correctly under a custom `Workflow phases` map.

<!--
plan: docs/plans/2026-11-21-board-readings-take-the-domain-answer.md
bumps:
  skills:
    plot: patch
-->
