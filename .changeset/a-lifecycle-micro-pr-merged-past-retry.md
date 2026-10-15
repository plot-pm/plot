---
'plot': patch
'@plot-pm/board': patch
---

`commitAndPush` retries a rejected push up to five times — re-fetching the default branch, re-cutting the booking branch, and re-applying the caller's write each time — instead of opening a self-reviewed, self-merged micro-PR. The ladder writes no review status.

<!--
plan: docs/plans/2026-10-15-a-lifecycle-micro-pr-merged-past.md
bumps:
  skills:
    plot: patch
-->
