---
'plot': patch
---

A person can hold merges into the default branch while they approve a release. "Hold merges, I am approving now" on the board, or `plot-ask.mjs release-hold <sha>`, records a hold that lasts `Checks wait`; fleetd's merge arm and `plot-ask.mjs merge` then refuse every other PR into the default branch as `release-waiting`. "Lift the hold" or `plot-ask.mjs release-hold-lift <sha>` ends it early. The board shows the hold on the release row and in the status panel, and off `http://localhost:<port>` it disables "Approve release" and "Hold merges" with the passkey reason.

<!--
plan: docs/plans/2026-11-27-a-release-holds-merges-while-it-waits.md
bumps:
  skills:
    plot: patch
-->
