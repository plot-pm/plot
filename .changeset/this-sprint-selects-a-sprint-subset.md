---
"@plot-pm/board": patch
---

The Delivery tab's «This sprint» chip now selects a subset of Active sprints instead of toggling all of them at once (#2137 regression). Each Active sprint beyond the first gets its own toggle chip, selection persists in the URL under an independent `deliverySprint` param, and a row shows its sprint slug when more than one sprint is Active and the selection isn't exactly one.

<!--
plan: docs/plans/2026-10-23-this-sprint-cannot-select-one-sprint.md
bumps:
  skills:
    plot: patch
-->
