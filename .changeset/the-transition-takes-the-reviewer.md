---
'plot': patch
'@plot-pm/board': patch
---

The approve transition accepts a named, declared reviewer, so a `Review: in-session` plan no longer needs an `--unowned` receipt: 109 in-session approvals on this checkout were written under one, measured 2026-10-01 in `.plot/state/unowned-state-writes.tsv`. An empty reviewer still refuses `review-human` and names `--who`; a handle the `People` config key never declared refuses the new `reviewer-undeclared`. `ballot` is unchanged. The transition request gains a twelfth `people` column.

<!--
plan: docs/plans/2026-10-01-an-in-session-approval-has-a-controller.md
bumps:
  skills:
    plot: patch
-->
