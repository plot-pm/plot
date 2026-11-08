---
'plot': patch
---

`plot-review.mjs` and `plot-ask.mjs merge` complete on GitHub while the GraphQL secondary rate limit is active, because the `pr-review`, `pr-state`, `pr-merge` and `commit-status` ops of `plot-host.sh` read and merge through REST.

<!--
plan: docs/plans/2026-11-08-review-and-merge-stop-on-the.md
bumps:
  skills:
    plot: patch
-->
