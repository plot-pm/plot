---
'plot': patch
---

fleetd appends a `release-review` run-log line with outcome `skipped: auto-review-off` when the release PR needs a review and `Auto-review` is off, and prints `release preparing: review skipped (Auto-review off)` instead of `release preparing: review`. Release PR #2934 got no review on 2026-11-03 while fleetd logged 35 to 53 `release preparing: review` lines (issue #3065).

<!--
plan: docs/plans/2026-11-03-the-release-pr-needs-a-person.md
bumps:
  skills:
    plot: patch
-->
