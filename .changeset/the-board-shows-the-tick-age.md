---
'@plot-pm/board': patch
'plot': patch
---

The board warns about a running fleet that has stopped ticking. `plot-fleetctl.sh --status` adds `tick_age=<seconds>` to the running arm's `summary:` line when `registryd.log` exists. The board reads the field from that line only, and `supervisorVerdict` shows an `up` fleet whose last tick is 600 s old or older at `warn` prominence with the label `fleet silent for <age>`. The state stays `up`. A missing field leaves the verdict as it was.

<!--
plan: docs/plans/2026-09-24-a-supervisor-that-stopped-ticking-is-not-running.md
bumps:
  skills:
    plot-fleet: patch
-->
