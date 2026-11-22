---
'@plot-pm/board': minor
---

fleetd asks again once for a brief whose run ended without a brief, and then stops: the branch reads `spent`, fleetd writes `.plot/state/brief-spent/<branch>.json` and logs the run's log path, and the board shows "brief run ended N times without a brief" on the row. Write brief on the board clears the hold. The brief ask now passes `--at <sha of origin/<default branch>>`, and `/plot-implement` reads the plan at that commit rather than from the main checkout's working tree.

<!--
plan: docs/plans/2026-11-21-a-refused-start-is-retried-and-named.md
bumps:
  skills:
    plot-implement: minor
-->
