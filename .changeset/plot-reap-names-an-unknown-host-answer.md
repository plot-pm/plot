---
'plot': patch
---

`plot-host.sh pr-merged` now answers `unknown` rather than `not-merged` for a failed host call with empty stderr, and for a failure whose message names no PR — a repository-not-found or other 404 no longer reads as "no PR for this branch". A genuine PR-lookup miss still answers `not-merged`.

<!--
plan: docs/plans/2026-10-28-plot-reap-yes-deletes-a-different.md
bumps:
  skills:
    plot: patch
-->
