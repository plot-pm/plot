---
'plot': patch
---

A pull-request listing that is provably whole now says so, and the fleet scan reads that claim instead of re-deriving it from its own row count. Measured on this repository 2026-10-02: 1064 PRs behind a 1000-row limit returned a page at exactly the limit, so completeness was unprovable, `.list-complete` was withheld, and every branch the join could not name cost one `plot-host.sh pr-state` call at 3.8 s — 54-61% of the scan's wall time. The scan's default `PR_LIST_LIMIT` rises to 3000, where the number is a budget the scan detects the exhaustion of rather than an assumption: a repository that outgrows it gets a capped page, the adapter reports it, and the scan degrades to per-branch asking.

<!--
plan: docs/plans/2026-10-01-a-scan-says-where-its-time-goes.md
bumps:
  skills:
    plot: patch
-->
