---
'plot': minor
---

`/plot-init` and `/plot-board-setup` now ask the host whether the default branch restricts pushes or requires a merge check, and propose `State branch: plot/state` when it does; an unanswered ask reads `unverified` and proposes nothing, and the delete restriction on the state branch is offered, never applied.

<!--
plan: docs/plans/2026-11-07-state-branch.md
bumps:
  skills:
    plot-init: minor
    plot-board-setup: minor
-->
