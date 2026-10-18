---
'plot': patch
---

`plot-fleetd --once` now sets `process.exitCode` instead of calling `process.exit()`, so a write still draining on a macOS pipe is not cut off before it completes. `fleet-clock.ts`'s `warn()` calls on the scan, PR-reader and bridge-write paths now end in a newline, so `fleetd.err` reads one entry per line. A bind retry that resolves after the daemon has read `stop()` true now stops the channel it opened instead of writing it into a slot nothing will ever stop again, and a retry that binds successfully now logs `plot-fleetd: channel bound`. `indexMonitorOver` and `deskRelayOver` gain direct tests of their own "has gone over" behaviour, and a verbatim-duplicate test assertion in `log-rotation.test.mjs` is removed. Closes the `registryd-main.ts`/`fleet-clock.ts` bullets of #1539 and #1526, tracked live under #1846.

<!--
plan: docs/plans/2026-10-17-fleetd-tick-stop-and-escalation-defects.md
bumps:
  skills:
    plot-fleet: patch
-->
