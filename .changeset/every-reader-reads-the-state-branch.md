---
'plot': minor
'@plot-pm/board': minor
---

A repository that declares a `State branch` now reads plan records through the state ref in dispatch, the reconcile scan, the pulse estate, the board and fleetd: the state ref's blob wins per path and a path only the default branch holds is read from there. The board shows `Records: N ahead of <default> · sync PR: none|#N`, and a removed key that strands `plot/state` ahead of the default branch appears as a reconcile section and a board row with the fix order.

<!--
plan: docs/plans/2026-11-07-state-branch.md
bumps:
  skills:
    plot-dispatch: minor
    plot-reconcile: minor
    plot-pulse: minor
    plot-board: minor
-->
