---
'plot': patch
---

A merge updates the plan issue's Plot comment with an "M of N slices merged" count while the plan reads approved. fleetd computes the count from the pulse with the new `sliceProgress` rule and sends it through `plot-plan-state.sh --slice-progress`; a partial pulse sends none.

<!--
plan: docs/plans/2026-10-29-tickets-follow-the-delivery-loop.md
bumps:
  skills:
    plot: patch
-->
