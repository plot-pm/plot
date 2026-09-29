---
'plot': patch
---

`/plot-fleet --start` resolves the agent harness (`${PLOT_HARNESS:-claude}`) with `command -v` and puts its directory first on the supervisor unit's `PATH`, through the new `__HARNESS_DIR__` placeholder in both the launchd plist and the systemd unit. A supervisor-started worker now runs the same harness binary as the operator's shell: on macOS it no longer falls back to an older `/opt/homebrew/bin/claude`, and on Linux it no longer exits 127. Every other binary in that directory also comes first. `--start` refuses, and writes no unit, when the harness does not resolve to a file. **An installed unit keeps its old `PATH` until it is reinstalled: run `/plot-fleet --stop`, then `/plot-fleet --start`.** A change to the worker prompt template would not reach existing adopters, because `plot-install-prompt.sh` never overwrites an existing `.plot/worker-prompt.sh`; this fix therefore changes the unit and not the template.

<!--
plan: docs/plans/2026-09-29-a-unit-can-find-the-harness.md
bumps:
  skills:
    plot-fleet: patch
-->
