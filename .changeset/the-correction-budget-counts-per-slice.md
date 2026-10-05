---
'plot': patch
---

`update_manifest_on_hop` in `plot-worker-loop.sh` resets `correctionAttempts` to zero when a hop lands on a branch different from the previous one, an empty previous branch included (the rejected-claim path blanks it), so an agent that spent its correction budget on one slice starts its next slice with a full one. A hop that hands the agent the branch it already holds keeps the count. `attempts`, `relaunches` and `wavesCount` are untouched by the reset.

<!--
plan: docs/plans/2026-10-05-a-spent-correction-budget-gets-a-fresh-agent.md
-->
