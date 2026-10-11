---
'plot': patch
---

`/plot-fleet --status` reads the tick age from whichever of `fleetd.log` and `registryd.log` has the newer mtime, so a supervisor started before the rename no longer reads as stale once `fleetd.log` exists. The restart hints name `fleetd.err` and the journal, and `skills/plot/units/README.md` gains a cleanup line for the old `registryd.*` logs.

<!--
plan: docs/plans/2026-10-10-the-fleet-closes-its-review-findings.md
bumps:
  skills:
    plot-fleet: patch
-->
