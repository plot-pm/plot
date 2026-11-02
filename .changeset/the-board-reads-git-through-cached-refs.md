---
'@plot-pm/board': patch
---

The board reads the Delivered record, plan authors, the behind count and the default branch through the oid-keyed walk cache, so a warm request starts none of those git processes.

<!--
plan: docs/plans/2026-11-01-the-board-starts-processes-on-the.md
bumps:
  skills:
    plot: patch
-->
