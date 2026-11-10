---
'plot': minor
---

`plot-fleetctl.sh --restart --agents` reloads the supervisor, then stops each free loop and names every agent it keeps with the reason; a recycled pid is refused and never signalled, and `PLOT_UNATTENDED=1` refuses the command.

<!--
plan: docs/plans/2026-11-09-plot-fleetctl-sh-restart-reloads-the.md
bumps:
  skills:
    plot-fleet: minor
-->
