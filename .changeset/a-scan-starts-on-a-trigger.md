---
'@plot-pm/board': patch
---

fleetd starts a scan only on a non-empty pending set, a degraded watch or a due safety net, reads only the readings the set names, and runs `git fetch --prune` only on a `remote` change or the safety net; the heartbeat beats every 5 s with or without a scan, and `scan` and `tick` read late by the age of the last beat.

<!--
plan: docs/plans/2026-11-10-triggers-replace-the-tick.md
bumps:
  skills:
    plot: patch
-->
