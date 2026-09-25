---
'plot': patch
---

`plot-fleetctl.sh --status` prints `last tick: <N>s ago` under `supervisor: running`, so a person sees the age of `registryd.log` beside the pid. On 2026-09-23 the running arm reported `running` over a 25-hour-old log. The line is evidence only: the state word, the `summary:` line and the exit code are unchanged, and no log prints no line.

<!--
plan: docs/plans/2026-09-24-a-supervisor-that-stopped-ticking-is-not-running.md
bumps:
  skills:
    plot-fleet: patch
-->
