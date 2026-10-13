---
'plot': minor
---

A plan with `Tracer: yes` reads status `proven`, not `deliverable`, once every non-deferred slice has merged, and its card stays in the phase holding `plan:design` until it is released. `PlanReadings` and `phaseOfPlan` take a `tracer` reading, both `PlanStatusSchema` copies list `proven`, both sprint counters count `proven` as work in progress, and the card of a proven plan still offers Deliver.

<!--
plan: docs/plans/2026-10-12-design-work-proves-the-path.md
bumps:
  skills:
    plot: minor
-->
