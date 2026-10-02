---
'@plot-pm/board': patch
'plot': patch
---

An agent handed a slice whose branch a clean, worker-less checkout holds now removes that checkout and takes the branch. A checkout holding work, a marker, a live worker or another agent's manifest is kept untouched, and the agent writes a `PLOT-BLOCKED` naming the path, the branch and the condition.

<!--
plan: docs/plans/2026-10-01-a-start-step-leaves-no-claim-and-no-desk.md
bumps:
  skills:
    plot: patch
-->
