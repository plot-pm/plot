---
'plot': minor
---

`plot-fleetctl.sh --restart` loads the current fleetd bundle into the running supervisor and signals no agent. It prints the old pid, the new pid and the bundle's commit, refuses wherever `--start` refuses, and refuses when no unit is loaded. `--dry-run` now works with `--start` and `--restart`.

<!--
plan: docs/plans/2026-11-09-plot-fleetctl-sh-restart-reloads-the.md
bumps:
  skills:
    plot-fleet: minor
-->
