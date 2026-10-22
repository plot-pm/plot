---
'plot': patch
'@plot-pm/board': patch
---

A `main-checkout` gate refuses an unattended agent's (`PLOT_UNATTENDED=1`) git command that would mutate `HEAD`, the index, or a ref in the main checkout rather than a linked desk worktree. It judges the directory a literal `cd` or `-C` names, skips git's global options before the subcommand, and allows read-only forms such as `git branch --show-current` and `git stash list`. A spawn whose agent commits in the main checkout by design — the Brief command, and the implement, deliver, reslice and story runs — sets `PLOT_MAIN_CHECKOUT_WRITER=1`, and the gate allows it. An attended session is not gated. The board also warns when its own checkout has uncommitted changes, via a new domain rule, `checkoutHealthStatus`, rendered through the existing status panel; a checkout git cannot read shows no warning. `.gitignore` now lists the brief logs Plot writes into the main checkout.

<!--
plan: docs/plans/2026-10-21-fleet-work-leaves-the-main-checkout.md
bumps:
  skills:
    plot: patch
-->
