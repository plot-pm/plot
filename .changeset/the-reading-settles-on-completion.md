---
'plot': minor
---

The default-branch reading asks a pending head again when its CI run is expected to end, never later than every 5 minutes, and `Default branch checks` accepts `<workflow>/<job>` (`CI/validate`) to fold one job of a workflow instead of the whole run.

<!--
plan: docs/plans/2026-11-17-main-merges-more-than-one-pr-per-ci-run.md
bumps:
  skills:
    plot: patch
-->
