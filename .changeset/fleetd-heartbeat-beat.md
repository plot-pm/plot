---
'@plot-pm/board': patch
---

fleetd writes `.plot/state/fleetd.json` every 10 seconds on an in-process timer, with or without a git host and whether or not anything changed. `fleetdLiveness` reads it as `live`, `stale` or `absent`, and `observerFresh` reports a loop that stopped passing while the timer still beats. No reader uses the file yet.

<!--
plan: docs/plans/2026-11-09-fleetd-heartbeat-not-data-age.md
bumps:
  skills:
    plot: patch
-->
