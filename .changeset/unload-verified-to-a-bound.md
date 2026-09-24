---
'plot': patch
---

`/plot-fleet --stop` verifies the supervisor's unload to the `--wait` bound rather than asking once, and a run that reports a failure no longer exits 0. Measured 2026-09-24: a single check after `launchctl bootout` answered *loaded*, the run printed `supervisor did NOT unload` and exited 0, and `launchctl print` moments later exited 113 — the job was gone. Because the run was recorded as failed the start marker stayed, and the next `--status` read that as a crash. An unconfirmed unload now keeps the marker, names the supervisor pid at the bound, and exits 1 alongside the agent summary rather than instead of it.

<!--
plan: docs/plans/2026-09-24-a-stop-that-reports-failure-does-not-exit-zero.md
bumps:
  skills:
    plot: patch
    plot-fleet: patch
-->
