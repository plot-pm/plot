---
'plot': patch
---

Section 6 of `/plot-reconcile` now resolves the release of a plan whose last PR's merge commit is not in the clone because the PR merged into a non-default branch deleted later. It follows that branch's merged PRs onward to the default branch and accepts a hop only when its merge commit contains the previous one, or when it is the one PR that can have carried it. A merge commit in the clone still resolves directly. A dead end, cycle, over-deep chain, ambiguous hop or failed host call each ends in its own named finding.

<!--
plan: docs/plans/2026-10-21-resolve-the-release-of-a-pr.md
bumps:
  skills:
    plot: patch
-->
