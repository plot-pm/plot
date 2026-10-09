---
'plot': minor
---

`plot-fleetd` now runs the scan on its own 5 s clock, writes `.plot/state/last-pulse.json` with all six fields, and folds the PR index every 60 s. The board reads both: while the supervisor is up and the bridge is under 180 s old it spawns no scan, writes no bridge and makes no `pr-list` call; without a fleet it scans and reads PRs in memory and writes neither file. `plot-fleet-scan.sh --stream` records nothing when `PLOT_SCAN_RECORD=0`.

<!--
plan: docs/plans/2026-10-09-the-fleet-runs-without-the-board.md
bumps:
  skills:
    plot: minor
-->
