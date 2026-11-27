---
'plot': patch
---

The review pass writes one line to `.plot/state/slice-review.log` for each PR and head whose `plot/review` reads `pending` past the review bound while the pass starts no review: `plot-review: PR #<n> pending since <time>; held: <reason>`, where the reason is the arm's answer. `reviewPendingStale` is the one test of a stale pending, and the review arm and the pass both call it.

<!--
plan: docs/plans/2026-11-27-a-stale-pending-review-is-asked-again.md
bumps:
  skills:
    plot: patch
-->
