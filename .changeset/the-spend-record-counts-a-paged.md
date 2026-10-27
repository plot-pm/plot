---
'plot': patch
---

On GitHub, `plot-host.sh pr-list` records one request per page it reads in the `spent` field of `budget.tsv`, instead of one per process. `spent` counts requests, not GraphQL points. Bitbucket and Jira already record one line per request and do not change.

<!--
plan: docs/plans/2026-10-27-the-spend-record-counts-a-paged.md
bumps:
  skills:
    plot: patch
-->
