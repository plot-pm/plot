---
"plot": minor
---

Claim-by-ref: two sessions can no longer take the same implementation branch.

`/plot-implement` now asks `plot-fleet-scan.sh --next` which branch to take instead of walking the plan's branch list in file order, and **claims it by pushing an empty ref before starting any work**. A ref push that would overwrite an existing branch is rejected, so a race has exactly one winner — git is the lock, and no lock manager exists or is needed. The loser asks again and takes the next free branch.

Because `--next` only ever offers branches from an eligible wave, a session can never be handed work that builds on a seam an earlier wave has not yet proven.

This replaces the old "create the first, list the rest — parallel sessions create theirs on pickup" instruction, which named parallelism without providing any way to coordinate it.

Giving a branch up is annotate-and-leave: a worker that finds the work unnecessary or wrongly cut records `deferred:` / `split-from:` / `moved:` in the plan and leaves the ref alone. Cleanup belongs to `/plot-reconcile`, which needs that annotation to tell deliberate abandonment from a dead worker — both leave an identical empty branch.

<!--
bumps:
  skills:
    plot-implement: minor
    plot-fleet: patch
-->
