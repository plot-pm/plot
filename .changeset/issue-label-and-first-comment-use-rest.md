---
'plot': patch
---

`plot-host.sh issue-label` and the first-comment path of `issue-comment` call `gh api` REST routes instead of `gh issue view`, `gh label create`, `gh issue edit` and `gh issue comment`, so a plan-state write no longer fails while the GraphQL limit is spent and the REST budget is not.

<!--
plan: docs/plans/2026-11-08-issue-writes-have-a-rest-route.md
bumps:
  skills:
    plot: patch
-->
