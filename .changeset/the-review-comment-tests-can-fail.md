---
'@plot-pm/board': patch
---

The one-comment-per-PR review test now shares one comment list across its three heads, so it fails when the per-PR marker is removed. The always-`none` `reviewIssue` rule and its guard in `finishReview` are removed, and three stale texts are corrected.

<!--
plan: docs/plans/2026-11-03-open-plot-review-findings-from-the.md
-->
