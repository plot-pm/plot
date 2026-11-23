---
'plot': patch
---

A push to `main` whose changes since the newest green `CI` push head are only plan, sprint, index, release and brief files now runs the jobs a plan-only pull request runs, not every job. `plot-local-checks.mjs --push-base <green.json> <first-parent.txt>` answers that base through `pushSelectionBase`, and `--ci` answers `planDataOnly`. A failed API call, no green run, a base off the 50 first-parent commits, or any other changed path still runs every job, and the `gates` push ranges start at the same base.

<!--
plan: docs/plans/2026-11-21-main-ci-runs-only-for-the-newest-head.md
bumps:
  skills:
    plot: patch
-->
