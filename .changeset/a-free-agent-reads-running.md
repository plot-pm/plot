---
'plot': patch
---

A free agent's desk reads `running`, and `plot-dispatch.sh` asks one reading of the live loops. In `plot_worker_state`, a live loop whose `.plot-worker.freewait` names its pid reads `running` when the manifest's `startedAt` proves the pid is the launched loop, so `plot-dispatch.sh --status` and `plot-fleetctl.sh --status` count a free agent as running and no longer report it as `finished`. The new bundle `board/plot-desk-loop.mjs` answers `deskLoopAlive` and `deskWaitsFree` over `.plot-worker.pid`, the manifest `pid` and the manifest `wrapperPid`. `--restart` refuses a desk whose loop is alive under any of these pids, whatever its state word, and names a free wait when one holds. `--start` counts every live loop. `--stop` stops a live loop that reads `stalled` or `finished`. `plot_pid_is_current` parses the UTC `startedAt` stamp as UTC on macOS and allows 3 s of start-time skew.

<!--
plan: docs/plans/2026-10-10-the-fleet-closes-its-review-findings.md
bumps:
  skills:
    plot: patch
    plot-dispatch: patch
    plot-fleet: patch
-->
