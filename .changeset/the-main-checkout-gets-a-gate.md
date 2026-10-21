---
'plot': patch
'@plot-pm/board': patch
---

A `main-checkout` gate refuses an unattended agent's (`PLOT_UNATTENDED=1`) git command that would mutate `HEAD`, the index, or a ref in the main checkout rather than a linked desk worktree. It judges the directory a `-C` option names, skips git's global options before the subcommand, and allows read-only forms such as `git branch --show-current` and `git stash list`. An attended session is not gated. The board also warns when its own checkout is dirty or behind `origin/main`, via a new domain rule, `checkoutHealthStatus`, rendered through the existing status panel; a checkout git cannot read shows no warning.

<!--
plan: docs/plans/2026-10-21-fleet-work-leaves-the-main-checkout.md
bumps:
  skills:
    plot: patch
-->
