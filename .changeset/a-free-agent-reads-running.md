---
'plot': patch
---

A desk whose loop is alive and whose `.plot-worker.freewait` names that loop's pid reads `running` in `plot_worker_state`, so `plot-dispatch.sh --status` and `plot-fleetctl.sh --status` no longer report a free agent as `finished`. The `--start` running count asks the same reading instead of a bare `ps -p` on the pid file, and `--restart` refuses a free agent's desk with a message that names the free wait.

<!--
plan: docs/plans/2026-10-10-the-fleet-closes-its-review-findings.md
bumps:
  skills:
    plot: patch
    plot-dispatch: patch
-->
