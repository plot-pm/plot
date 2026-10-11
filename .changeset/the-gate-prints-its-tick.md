---
'plot': patch
---

`plot-fleetd.mjs --once` prints its tick line, hold detail and notices on stdout and stderr. The entry point chooses its writers by mode through `writersFor`: `--once` writes to the terminal, and the looping daemon keeps its rotating `fleetd.log` and `fleetd.err` pair, so a `--once` run no longer appends to the daemon's log and shows the operator nothing.

<!--
plan: docs/plans/2026-10-10-the-fleet-closes-its-review-findings.md
bumps:
  skills:
    plot-fleet: patch
-->
