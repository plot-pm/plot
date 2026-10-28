---
'plot': patch
---

The `plot-fleetd` tick line prints one requests-an-hour figure per loop (`tick=`, `scan=`, `pr-reader=`, `issue-reader=`) in place of the single `mine=` figure, which counted only the tick's own host calls. One fleetd spent 4,500 requests an hour while its tick line read `mine=60/hr`. Each loop keeps its own in-process counter, and the scan adds the host calls that `plot-fleet-scan.sh` reports on a tagged `spend:` stderr line. (#2815)

<!--
bumps:
  skills:
    plot-fleet: patch
-->
