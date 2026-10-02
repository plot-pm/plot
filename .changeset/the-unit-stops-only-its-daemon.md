---
'plot': patch
---

On Linux, a stop, restart or crash of the `plot-registryd` systemd unit no longer ends the agents the supervisor started. The unit signals only the daemon's own process; `/plot-fleet --stop` still stops each agent first, through `plot-dispatch.sh --stop`.

<!--
plan: docs/plans/2026-10-01-a-supervisor-restart-leaves-its-agents-running.md
bumps:
  skills:
    plot: patch
-->
