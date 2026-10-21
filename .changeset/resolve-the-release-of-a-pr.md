---
'plot': patch
---

Section 6 of `/plot-reconcile` now resolves the release of a plan whose last PR merged into a non-default branch later deleted, by following the branch's own merged PR onward until the trail reaches the default branch, cycles, or runs out — each ending in its own named finding.

<!--
plan: docs/plans/2026-10-21-resolve-the-release-of-a-pr.md
bumps:
  skills:
    plot: patch
-->
