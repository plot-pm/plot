---
'plot': patch
'@plot-pm/board': patch
---

`plot-review.mjs` takes an exclusive per-`<pr>-<sha>` run lock before deleting a previous run's verdict and diff files, so a second concurrent run refuses `review-running` instead of corrupting the first run's files. A run writes its final status only while the host's newest `plot/review` reading still names this run's id, and never replaces an existing `failure` on the same head. `plot-review.mjs <pr> --status-only` writes the status tail alone from an already-written verdict file, for a run that failed before or during its status write.

<!--
plan: docs/plans/2026-10-29-fleetd-reviews-every-slice-pr-in.md
bumps:
  skills:
    plot: patch
-->
