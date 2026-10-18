---
'plot': patch
---

The supervisor tick names who refused a `refused` hold, why and when beside the branch (`bug/x — refused by sess-1: <reason> (<ISO time>)`), fixing #1642. `.plot/state/refused-slices.tsv` gains optional session, reason and time columns after the branch; a one-column line written earlier still reads and prints the branch alone.

<!--
plan: docs/plans/2026-10-17-fleetd-tick-stop-and-escalation-defects.md
bumps:
  skills:
    plot-fleet: patch
-->
