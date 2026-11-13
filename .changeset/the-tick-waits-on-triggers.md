---
'@plot-pm/board': patch
---

fleetd now waits between supervision ticks on a registry, desk-files or worker-gone change, a scan that drained a pending set, a clock jump and the next slice-idle deadline, and no longer on `--interval`, which stays the cadence only while a watch is degraded.

<!--
plan: docs/plans/2026-11-10-triggers-replace-the-tick.md
bumps:
  skills:
    plot: patch
-->
