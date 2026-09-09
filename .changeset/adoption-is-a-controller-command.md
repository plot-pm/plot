---
'plot': minor
'@plot-pm/board': minor
---

`/plot-init` writes `## Plot Config` through `composeAdoption` rather than from a markdown block in its own step 3, so an already-adopted repository is refused by name and an unattended run with no Definition of Done prints `PLOT-UNASKED` instead of a guess.

<!--
plan: docs/plans/2026-09-08-the-master-agent-uses-the-controllers.md
bumps:
  skills:
    plot-init: minor
    plot: patch
-->
