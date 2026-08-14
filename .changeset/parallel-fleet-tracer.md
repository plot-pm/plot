---
"plot": minor
---

Branch waves and the fleet pulse — the first step toward running several agents on one plan.

Plans can now group their implementation branches into **waves** using `### ` subheadings under `## Branches`. Branches in a wave may run concurrently; a wave becomes eligible once every non-deferred branch in every prior wave is merged. The existing `### Tracer` / `### Implementation` convention is exactly this, now given meaning: the tracer proves the seam before the rest fan out. A plan with no subheadings is one wave, so every existing plan behaves as before.

The new `/plot-fleet` command reports that state — which waves are complete, eligible, or blocked, and which branches are claimed. It is read-only and stateless: every fact is re-derived from git refs on each run, so there is no fleet database to drift, and a dead worker or killed pulse costs nothing.

`plot-plan-meta.sh` gains a `waves[]` field (with per-branch `deferred` and `claimed` state) alongside the unchanged flat `branches[]`, and now ignores a second `## Branches` heading appearing in prose — a plan that documents the plan format no longer poisons its own branch list.

<!--
bumps:
  skills:
    plot-fleet: minor
    plot: patch
-->
