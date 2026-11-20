---
'plot': patch
---

A re-run of a red default-branch commit keeps the `default-branch-red` hold: tests now pin that a `pending` or `unknown` reading of the red commit leaves the settled red in place for fleetd's queue, its merge arm and `plot-ask.mjs merge`, until that commit reads green.

<!--
bumps:
  skills:
    plot: patch
-->
