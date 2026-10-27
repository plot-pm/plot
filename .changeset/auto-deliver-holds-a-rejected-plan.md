---
'plot': patch
---

Fleetd's auto-deliver no longer re-delivers a plan a person just rejected. Measured 2026-10-26: `/plot-reject` moved an Approved plan back after a bad merge, and `runAutoDeliverPass` delivered it again 43 seconds later. The pass now reads the plan's Status block through `PlanStore.readPlan` and holds any `approved` candidate carrying a `Rejected:` line — no in-flight mark, no failure record, no count toward the failure limit — and logs the hold once, naming the plan and the reason (`rejected`, or `unknown` for an unreadable file).

<!--
plan: docs/plans/2026-10-27-auto-deliver-re-delivers-a-rejected.md
bumps:
  skills:
    plot: patch
-->
