---
'plot': patch
'@plot-pm/board': patch
---

`plot-approve` asks the host for the PR of the merge that added the plan, at any age, rather than searching the newest 100 merged PRs. A merge whose PR the host cannot name refuses `pr-merge-unnamed` and names the merge commit, and a same-branch plan the default branch holds takes the same route.

<!--
plan: docs/plans/2026-11-21-plot-approve-finds-a-plan-pr-at-any-age.md
bumps:
  skills:
    plot-approve: patch
-->
