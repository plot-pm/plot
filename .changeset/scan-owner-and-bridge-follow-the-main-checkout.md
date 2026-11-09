---
'@plot-pm/board': patch
---

The fleet owns the scan while its heartbeat is live and its scan loop is on time, so a late tick or issue-reader loop no longer starts a second scan in the board. The fleet bridge `.plot/state/last-pulse.json` resolves to the main checkout, as the heartbeat does, so a board in a linked worktree reads the bridge fleetd writes.

<!--
bumps:
  skills:
    plot: patch
-->
