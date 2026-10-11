---
'plot': patch
---

The fleet clock's scan sets `PLOT_SCAN_RECORD=0`, so `plot-fleet-scan.sh --stream` no longer writes a thin bridge that `writeScan` then overwrites with the full one. `writeScan` is the one writer on a fleet tick; `--log-pulse` and the board's own scan keep their behaviour.

<!--
plan: docs/plans/2026-10-10-the-fleet-closes-its-review-findings.md
bumps:
  skills:
    plot-fleet: patch
-->
