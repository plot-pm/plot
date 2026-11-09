---
'@plot-pm/board': patch
---

The board, the PR reader and the dispatch, continue and restart commands read fleetd's heartbeat file to decide whether fleetd is alive, in place of the age of the bridge and the reader-lock entry. An idle repository whose fleetd keeps beating keeps the scan with the fleet, and the commands accept a bridge older than 15 minutes while the live heartbeat names it.

<!--
plan: docs/plans/2026-11-09-fleetd-heartbeat-not-data-age.md
bumps:
  skills:
    plot: patch
-->
