---
'@plot-pm/board': patch
---

fleetd releases the `bug/main-repair-<sha>` claim of a repair episode that ends with no agent commit: `closePrs` calls the release controller after it writes `state: done`, for an attempt with `outcome: ended` on the last green SHA's repair branch, and a refused release only warns.

<!--
plan: docs/plans/2026-11-08-an-ended-main-repair-episode-leaves.md
bumps:
  skills:
    plot: patch
-->
