---
'@plot-pm/board': patch
---

Every Fleet row names the branch, plan and slice it acts on, also for a desk agent whose registry entry carries `branch: ''` and its branch in `checkout`; placement still reads `branch` alone. A row of an agent on a sprint member carries the sprint's name, and a row the sprint rule marks shows a grey "no sprint" pill. A stopped design run's Branch cell names the branch its spec run claims, through the optional `branch` field on `/api/fleet`'s role runs.

<!--
plan: docs/plans/2026-11-22-delivery-sections-count-alike.md
bumps:
  skills:
    plot: patch
-->
