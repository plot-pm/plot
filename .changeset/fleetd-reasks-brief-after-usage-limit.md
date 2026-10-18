---
'@plot-pm/board': patch
---

fleetd now asks the Brief command again for a slice whose first ask ended at the account's usage limit, on the first pulse at or after the reset time, instead of skipping the branch as `no brief on origin/main` until a restart (#1716). A pulse before the reset spawns nothing, and a second usage-limit ending replaces the recorded reset.

<!--
plan: docs/plans/2026-10-17-fleetd-tick-stop-and-escalation-defects.md
-->
