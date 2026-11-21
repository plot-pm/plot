---
'@plot-pm/board': patch
---

The reconcile scan's release section reports a sibling PR whose merge commit this clone cannot read as `PR #<n> names merge commit <sha>, not in this clone → cannot resolve` with the fetch advice, instead of `the first tag that does: none` (#3160).

<!--
plan: docs/plans/2026-11-21-reports-name-their-cause-and-ci-selects-their-tests.md
bumps:
  skills:
    plot: patch
-->
