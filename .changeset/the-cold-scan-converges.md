---
'plot': patch
'@plot-pm/fleet': patch
---

`scanOnce` now keeps the `terminal:`/`listing:` lines a killed scan already streamed before `FLEET_SCAN_BUDGET_MS` ends it, instead of discarding them with the thrown error — fixing #1756. A scan killed mid-stream on a large Bitbucket repository now leaves its caller's `state.terminal`/`state.listing` warm, so the next scan starts with real, host-charged answers rather than cold on both caches. `parsed === null` still throws and `state.pulse` is still left untouched on that path, unchanged.

<!--
plan: docs/plans/2026-10-16-fleetd-scan-cost-and-read-cadence.md
bumps:
  skills:
    plot: patch
-->
