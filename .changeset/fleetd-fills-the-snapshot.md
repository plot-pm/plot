---
'@plot-pm/board': patch
---

fleetd holds one in-memory snapshot of its readings and fills it from the reads its scan, PR reader, issue reader, default-branch beat and tick already take; a `--once` run closes every key it does not read as `failed`. Nothing changes for an operator.

<!--
plan: docs/plans/2026-11-09-the-snapshot-entity.md
-->
