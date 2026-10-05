---
'plot': patch
---

`update_manifest_on_hop` in `plot-worker-loop.sh` resets `correctionAttempts` to zero when a hop lands on a branch different from the one the agent is leaving, so an agent that spent its correction budget on one slice starts its next slice with a full one. A hop onto the same branch — a correction's own retry — keeps the count, so a still-failing slice cannot reopen its budget. `attempts`, `relaunches` and `wavesCount` are untouched by the reset; the docstring at `plot-worker-loop.sh` is updated to say so.

<!--
plan: docs/plans/2026-10-05-a-spent-correction-budget-gets-a-fresh-agent.md
-->
