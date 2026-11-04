---
'plot': patch
'@plot-pm/board': patch
---

`/plot-approve` and `plot-needs-design` read the plan at the head of the PR they merge or write to, and pin the merge to that head. An open PR with a different copy of the plan file refuses `pr-copies-differ`, and a checkout copy that differs from the PR's head refuses `checkout-copy-differs`.

<!--
plan: docs/plans/2026-11-03-plot-approve-reads-the-plan-from.md
bumps:
  skills:
    plot: patch
    plot-approve: patch
-->
