---
'plot': patch
'@plot-pm/board': patch
---

A `main-checkout` gate refuses a git command that would mutate `HEAD`, the index, or a ref when run in the main checkout rather than a linked desk worktree — unconditionally, since the incident this closes was an interactive session rather than an unattended script. The board also warns when its own checkout is dirty or behind `origin/main`, via a new domain rule, `checkoutHealthStatus`, rendered through the existing status panel.

<!--
plan: docs/plans/2026-10-21-fleet-work-leaves-the-main-checkout.md
bumps:
  skills:
    plot: patch
-->
