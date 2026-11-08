---
'plot': patch
---

The process-census gate holds a `'strict'` row to no growth only while the merge base reads 0. A strict row whose merge-base count is above 0 takes a noise tolerance of 10 % + 2, and its line reads `tolerance strict→noise 10 % + 2 (base > 0)`. A row with an explicit `{ ratio, plus }` keeps it.

<!--
plan: docs/plans/2026-11-08-process-census-gate.md
-->
