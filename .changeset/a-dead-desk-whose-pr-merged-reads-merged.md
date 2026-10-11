---
'plot': patch
---

A desk whose worker pid is not alive and whose branch has a MERGED row in the PR index reads `finished` in the agent registry, not `waiting`, so a `PLOT-BLOCKED` marker left on a merged branch no longer shows as "waiting on you" and no longer counts under WORKING. The new domain rule `mergedDeskState` decides it. The registry reads the PR index file once per read, and only when a desk reads `waiting`; it makes no host request. A live worker pid, a missing store, a missing row, and an `OPEN`, `CLOSED` or draft row each keep `waiting`. `plot-worker-state.sh` and the reaper are unchanged.

<!--
bumps:
  skills:
    plot-fleet: patch
-->
