---
'@plot-pm/board': patch
---

fleetd asks the machine for its headroom only for an agent whose verdict would relaunch it, and asks `fleetCapForRepo` only when the queue holds a slice that waits for an agent, so an idle tick runs no `git rev-parse --git-dir` sample.

<!--
plan: docs/plans/2026-11-10-triggers-replace-the-tick.md
-->
