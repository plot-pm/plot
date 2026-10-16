---
'plot': patch
'@plot-pm/fleet': patch
---

`scanOnce` now keeps the `terminal:`/`listing:` lines a scan killed at `FLEET_SCAN_BUDGET_MS` already streamed, instead of discarding them with the thrown error, fixing #1756. A killed scan merges its streamed terminal rows into `state.terminal` by branch name, and replaces `state.listing` only where the streamed listing ends with `.list-arrived`, which `plot-fleet-scan.sh` now prints after every listing row. A listing cut short by a kill is not adopted and is not carried, so a missing branch never reads as `NONE`. A completed scan replaces both caches as before.

<!--
plan: docs/plans/2026-10-16-fleetd-scan-cost-and-read-cadence.md
bumps:
  skills:
    plot: patch
-->
