---
'@plot-pm/board': patch
---

A board whose snapshot protocol differs from a live fleetd's no longer reads for itself beside fleetd. It shows fleetd's bridge and the PR rows from the index, starts no process on its refresh and PR beats, and names both protocols and `skills/plot/scripts/plot-fleetctl.sh --restart` in the status panel. A board whose fleetd heartbeat is stale or absent still reads for itself (#3528).

<!--
bumps:
  skills:
    plot: patch
-->
