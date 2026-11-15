---
'@plot-pm/board': patch
---

fleetd compares every full read with the readings it held before it and writes one line, `plot-fleetd: safety net: <key> [<desk>] changed with no trigger`, for each reading that changed while no watch named it. The heartbeat reports `lastSafetyNetAt` (at start, every 10 minutes and after a wake) and a `missedChanges` count. The process census adds row S8, a safety-net pass, measured and held within 10 % + 2.

<!--
plan: docs/plans/2026-11-10-triggers-replace-the-tick.md
-->
