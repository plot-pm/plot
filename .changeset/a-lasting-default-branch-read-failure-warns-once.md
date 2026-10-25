---
"@plot-pm/fleet": patch
---

`registryd-main.ts`'s default-branch tick now warns once per distinct cause instead of repeating the same line every tick: a lasting read failure previously filled the fleetd log with one identical warning per interval forever. A changed line — a new cause, or the reading recovering to no warning at all — still prints.

<!--
plan: docs/plans/2026-10-24-fleet-supervisor-holds-scale-slots-too.md
bumps:
  skills:
    plot: patch
-->
