---
'plot': patch
---

fleetd and the board check whether a recorded pid is alive with `process.kill(pid, 0)` instead of starting `bash -c "kill -0 <pid>"`. A pid owned by another user now reads as alive rather than gone, so fleetd and the reaper hold back on it.

<!--
plan: docs/plans/2026-11-08-monitors-nap-without-sleep.md
bumps:
  skills:
    plot: patch
-->
