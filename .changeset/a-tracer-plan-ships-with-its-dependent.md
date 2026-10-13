---
'plot': minor
---

`planAutoDeliver` names a proven tracer plan only on a pass after a plan that waits on it reads delivered, and never in the same pass as that dependent; a tracer plan with no dependent is never named. The domain exports `dependentsOf` and `hasUndeliveredDependent`. `/plot-deliver` documents delivering a proven tracer plan by hand, and stops when a plan that waits on it is not delivered.

<!--
plan: docs/plans/2026-10-12-design-work-proves-the-path.md
bumps:
  skills:
    plot-deliver: minor
-->
