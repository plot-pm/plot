---
'plot': patch
---

The fleet clock's scan sets `PLOT_SCAN_RECORD=0`, so `plot-fleet-scan.sh --stream` no longer writes a thin bridge that `writeScan` then overwrites with the full one. `--log-pulse` no longer writes the bridge while the fleet's writer holds it: a bridge younger than 180 s that carries branch ages, approval dates, idea plans or a branch URL base stays as the fleet wrote it, and `plot-delta.mjs --held` asks `fleetHoldsBridge` in the domain. A missing, thin or older bridge is written as before, so `/plot-pulse` in a repository with no board and no fleet keeps its pulse history. The board's own scan writes nothing.

<!--
plan: docs/plans/2026-10-10-the-fleet-closes-its-review-findings.md
bumps:
  skills:
    plot-fleet: patch
    plot-pulse: patch
-->
