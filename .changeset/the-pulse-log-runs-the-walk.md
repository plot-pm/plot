---
'plot': patch
---

`plot-fleet-scan.sh --log-pulse` runs the domain walk under `PLOT_LOG_PULSE_WALK=domain`: `plot-scan-walk.mjs` appends one pulse line to each plan's `## Notes` through the resolved symlink, writes `last-pulse.json` unless the fleet holds it, and prints the delta.

<!--
plan: docs/plans/2026-10-31-the-plan-walk-moves-into-the.md
bumps:
  skills:
    plot: patch
-->
