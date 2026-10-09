---
'plot': minor
'@plot-pm/board': minor
---

Auto-dispatch and auto-delivery run in `plot-fleetd` on the pulse its own scan just wrote, with in-flight marks under `.plot/state/`. The board makes no automatic write. A delivery started by the fleet survives a daemon restart inside the 90 s mark lifetime without a second start.

<!--
plan: docs/plans/2026-10-09-the-fleet-runs-without-the-board.md
bumps:
  skills:
    plot-fleet: minor
-->
