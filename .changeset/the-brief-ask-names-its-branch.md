---
'@plot-pm/board': patch
---

A `--brief-only` implement run records the branch it briefs, and the brief reading attributes a running or failed writer to that branch only. The controller picks the first startable slice before it spawns, passes it as `PLOT_BRIEF_BRANCH`, and marks a per-branch state file; a run that names no branch keeps the per-plan reading.

<!--
plan: docs/plans/2026-10-09-a-slice-whose-brief-is-being.md
bumps:
  skills:
    plot-implement: patch
-->
