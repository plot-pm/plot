---
'plot': minor
---

fleetd's merge arm merges a green, review-passed slice PR as the Merger App's installation when the `Merger app` key is declared, instead of the signed-in `gh` identity's ruleset bypass; an absent, invalid, or unreadable key holds every row and logs a `merge-hold` record instead of merging. `plot-init` and `plot-board-setup` now point a GitHub adopter at the `Merger app` setup steps.

<!--
plan: docs/plans/2026-11-03-fleetd-merges-no-slice-pr-while.md
bumps:
  skills:
    plot-init: minor
    plot-board-setup: minor
-->
