---
'plot': minor
---

A `plot/review` success passes the merge, the release approval, the review run and the PR index only when the Review app's bot wrote it. `pr-review` reports every `plot/review` status with its `writer`, and `plot-review-writer.mjs` resolves the `<slug>[bot]` login from `Review app` on `origin/<default>`. A success a person or another app wrote refuses `review-foreign-writer`, an unresolvable writer refuses `review-writer-unread`, and an unjudged index row holds `review-writer-unchecked`. With no `Review app` key the reading is unchecked and the status state passes through; Bitbucket statuses carry no writer.

<!--
plan: docs/plans/2026-11-03-pr-review-accepts-a-plot-review.md
bumps:
  skills:
    plot: minor
-->
