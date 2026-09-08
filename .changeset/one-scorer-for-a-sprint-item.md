---
'plot': patch
'@plot-pm/board': patch
---

One rule decides what a sprint item counts as. `scoreItem` reached no production caller — its one caller, `openPromises`, is itself reached only by a re-export — while `plot-sprint-release.sh`'s 12-line `item_state` was what `/plot-release` actually ran. The two had already drifted: the shell reads `delivered` three-valued and takes an item naming no plan at its checkbox, while `scoreItem`'s boolean could not express that case and scored such an item `disputed`. Measured 2026-09-08: 4 of 134 items on this estate, all four checked, so all four disagreed. `PlanDelivery = boolean | 'no-plan-named'` gives the domain the third reading, and the shell now asks `board/plot-sprint-score.mjs` for the answer rather than computing it — one hop per tier, on the seam `docs/shell-and-domain.md` names for a script that runs once per operator command. The comparison in `corpus/sprint-score.corpus.test.ts` no longer skips any item, and its declared divergence is empty.

<!--
plan: docs/plans/2026-09-07-a-sprint-item-has-one-scorer.md
bumps:
  skills:
    plot: patch
-->
