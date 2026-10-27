---
'@plot-pm/board': patch
---

The reaper no longer reads a reused pid as a live worker. Every writer of a worker pid records that process's own start time (`ps -o lstart`) beside it: the manifest's `pidStartedAt` and `wrapperPidStartedAt` fields, and a `.plot-worker.pid.startedAt` sidecar for the bare pid file. `plot-reap` keeps a desk for a manifest pid only when the pid answers and its live start lies within 3 s of the recorded start, and `plot_pid_is_current` makes the same two-sided comparison. A pid with no recorded start keeps the earlier reading, and a live start that cannot be read reads alive.

<!--
plan: docs/plans/2026-10-27-the-reaper-keeps-leftovers-that-no.md
bumps:
  skills:
    plot: patch
    plot-dispatch: patch
-->
