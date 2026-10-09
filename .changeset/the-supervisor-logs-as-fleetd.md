---
'plot': patch
---

The supervisor writes `.plot/logs/fleetd.log` and `.plot/logs/fleetd.err` instead of `registryd.log` and `registryd.err`. The daemon opens the new names, and the launchd unit template sends stdout and stderr to them. `plot-fleetctl.sh --status` reads the tick age from `fleetd.log`, and from `registryd.log` when `fleetd.log` is absent: a unit filled before this change writes the old name until `/plot-fleet --stop` and `/plot-fleet --start` fill it again. The old files are not moved or removed.

<!--
plan: docs/plans/2026-10-09-the-fleet-runs-without-the-board.md
bumps:
  skills:
    plot: patch
-->
