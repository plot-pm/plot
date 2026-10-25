---
"plot": patch
---

`readQueue` now also names a dead claim — a claimed branch with no live `running`/`waiting` agent, no commit beyond the default branch besides its own claim marker, and a newest claim commit older than `ORPHANED_CLAIM_AGE_MS` (60 s) — from the same per-branch read `orphanedClaims` already makes, with no new git call. `deadClaim`/`deadClaims` (`packages/domain/src/rules/dead-claim.ts`) wrap `claimAnswer`'s existing `stale-claim` answer and apply the same age bound as `orphanedClaims`, so a claim inside a dispatch's launch window is never named. fleetd's tick prints each such branch once, on its existing `claim with no agent — plot-dispatch.sh --release <branch>` line; the release itself still runs through `releaseClaim`/`gatherReadingsAndRelease`, called by a person from the printed command.

<!--
plan: docs/plans/2026-10-24-implement-leaves-the-main-checkout-on.md
bumps:
  skills:
    plot-fleet: patch
-->
