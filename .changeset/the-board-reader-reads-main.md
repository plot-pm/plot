---
'plot': patch
---

The board's PR reader now writes `.plot/state/default-branch.json` while no fleetd heartbeat reads live, so Approve release and `plot-ask.mjs merge` no longer refuse `default-branch-stale` while the fleet is stopped and a board is open. It runs fleetd's own refresh after each PR pass, only while it holds the reader lock, and leaves the file to fleetd while fleetd runs.

<!--
bumps:
  skills:
    plot: patch
-->
