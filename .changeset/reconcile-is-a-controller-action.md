---
'@plot-pm/board': minor
---

Reconcile becomes a domain workflow taking a scope — one plan, one sprint, or the whole workspace — reached without HTTP through `board/plot-reconcile.mjs`. It composes `reap()` and `rules/sweepable.ts` and adds no condition of its own; it performs nothing, carries an empty write list at every scope, and refuses a scope naming a plan or sprint nothing read rather than answering with an empty list.

<!--
plan: docs/plans/2026-09-09-reconcile-is-a-controller-action.md
bumps:
  skills:
    plot: patch
-->
