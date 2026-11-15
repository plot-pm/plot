---
'@plot-pm/board': patch
---

fleetd logs the earliest deadline on its tick line as `next-deadline=<rule>@<time>` and runs a full read when two fleet beats show the wall clock moved more than 10 s against the monotonic clock, as after a sleep or a clock jump.

<!--
plan: docs/plans/2026-11-10-triggers-replace-the-tick.md
-->
