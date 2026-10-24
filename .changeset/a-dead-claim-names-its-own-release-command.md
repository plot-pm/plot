---
"plot": patch
---

`readQueue` now also names a dead claim — a claimed branch with no live `running`/`waiting` agent and no commit beyond the default branch besides its own claim marker — from the same per-branch read `orphanedClaims` already makes, with no new git call. `deadClaim`/`deadClaims` (`packages/domain/src/rules/dead-claim.ts`) wrap `claimAnswer`'s existing `stale-claim` vocabulary rather than re-deriving it. fleetd's tick line gains a `dead-claims=` count and a `plot-dispatch.sh --release <branch>` line per branch, skipping a branch `orphaned-claims` already named this tick; the actual release still runs through `releaseClaim`/`gatherReadingsAndRelease`, called by a person from the printed command, never a parallel deletion path.

<!--
plan: docs/plans/2026-10-24-implement-leaves-the-main-checkout-on.md
bumps:
  skills:
    plot-fleet: patch
-->
