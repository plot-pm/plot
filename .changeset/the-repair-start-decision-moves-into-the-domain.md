---
'plot': patch
---

fleetd names why the repair still waits on the first red SHA's re-run: each pass logs `repair awaiting-rerun (<reason>)` with `rerun-grace`, `rerun-unanswered`, `rerun-unconcluded` or `rerun-unmatched`. The repair-start decision is the domain rule `repairStartAction`, and `rerunSettledOf` answers its reason beside the reading.

<!--
plan: docs/plans/2026-11-21-fleet-state-is-read-whole-and-from-one-home.md
bumps:
  skills:
    plot: patch
-->
