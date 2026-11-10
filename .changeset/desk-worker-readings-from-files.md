---
'@plot-pm/board': patch
---

fleetd and the board read each desk's worker state from the desk files and one process-table read per pass instead of one `bash` probe per desk; on the census fixture with 3 desks this removes 17 of 21 `ps` and 18 of 56 sourcings of `plot-worker-state.sh` per pass. The dispatcher stamps the recorded start times under `LC_ALL=C` and records the agent process name in the desk manifest as `agentProcess`.

<!--
plan: docs/plans/2026-11-09-desk-probes-in-domain.md
bumps:
  skills:
    plot: patch
    plot-dispatch: patch
-->
