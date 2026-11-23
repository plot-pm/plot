---
'@plot-pm/board': patch
---

The board's worker log answers "the fleet scan has not reached this branch yet" for a branch that an unfinished scan has not reached, instead of "no worktree". The dispatch and implement routes refuse `pulse-partial` for a plan that an unfinished scan has not reached, and the implement route starts no run.

<!--
plan: docs/plans/2026-11-21-fleet-state-is-read-whole-and-from-one-home.md
bumps:
  skills:
    plot: patch
-->
