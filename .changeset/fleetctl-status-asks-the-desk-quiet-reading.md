---
'plot': patch
---

`plot-fleetctl.sh --status` reads each running desk's quiet time from `plot-ask.mjs desk-quiet`, the newest of the desk's four live signals, so it agrees with the board instead of reading `.plot-worker.log` alone (#3745).

<!--
plan: docs/plans/2026-11-27-a-desk-reads-quiet-from-its-live-signals.md
bumps:
  skills:
    plot: patch
-->
