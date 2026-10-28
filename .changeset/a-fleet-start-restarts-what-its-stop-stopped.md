---
'plot': patch
---

`plot-fleetctl.sh --start` now restarts exactly the branches its own `--stop` confirmed stopped, through the same `restart` controller `plot-restart-command.mjs` wraps — a branch stopped directly via `plot-dispatch.sh --stop` never appears on that list and stays stopped.

<!--
plan: docs/plans/2026-10-27-no-controller-restarts-a-stopped-slice.md
bumps:
  skills:
    plot-fleet: patch
-->
