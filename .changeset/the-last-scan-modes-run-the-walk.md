---
'plot': patch
---

`plot-fleet-scan.sh --loose`, `--stream` and plain `--log-pulse` run the domain walk by default. `--stream` prints one `plan` line as each plan resolves and the `reading` line last, after the bridge is written. `--loose` is an input to the branch and assembly stages. `--log-pulse` prints the per-plan wave report, the `Pulse complete.` line and the `summary:` footer. The `PLOT_LOG_PULSE_WALK` opt-in is removed; `PLOT_SCAN_WALK=shell` keeps the shell walk.

<!--
plan: docs/plans/2026-10-31-the-plan-walk-moves-into-the.md
bumps:
  skills:
    plot: patch
-->
