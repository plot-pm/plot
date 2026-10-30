---
'plot': patch
---

`plot-ask.mjs merge` admits one PR while the default branch is red: the PR the repair record names as `repairPr` or `revertPr`, while the record's episode is open, its head branch is `bug/main-repair-<12 hex of lastGreenSha>` or `bug/revert-<pr>`, and the red commit's runs, asked again before the merge, still read red. New refusals name each failed condition: `repair-episode-closed`, `repair-branch-mismatch` and `repair-red-unconfirmed`. Every other PR still refuses `default-branch-red`. The new `plot-ask.mjs repair-pr <pr>` records a person's fix PR on the open episode's record, and fleetd no longer replaces an open record of the same episode.

<!--
plan: docs/plans/2026-10-30-ci-runs-what-the-change-touches.md
bumps:
  skills:
    plot: patch
-->
