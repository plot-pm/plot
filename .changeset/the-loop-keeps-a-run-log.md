---
'plot': patch
---

fleetd and the desk's worker loop each append one line to a new run log under the common git dir's `.plot/state/` for every dispatch, CI correction, fresh-agent start and delivery, so the delivery loop's actions are recorded without a person watching. `plot-fleetd.mjs --once` appends no line.

<!--
plan: docs/plans/2026-10-29-the-delivery-loop-keeps-a-run.md
bumps:
  skills:
    plot: patch
-->
