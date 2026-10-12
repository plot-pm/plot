---
'plot': minor
'@plot-pm/board': minor
---

A person can move a Draft plan to Design from the board's Needs design button, from `POST /api/needs-design`, or with `plot-needs-design.mjs <slug>`. The move writes `State: Design`, the dated `Design:` record and an empty `## Spec` section, and refuses under `PLOT_UNATTENDED=1`.

<!--
plan: docs/plans/2026-10-12-the-phases-are-declared.md
bumps:
  skills:
    plot: minor
-->
