---
"plot": patch
---

`plot-host.sh pr-list --branch <br>` now filters the three non-rich GitHub arms with `gh pr list --head`, so `_plot_open_lookup` in `plot-pr-merged.sh` finds a branch's open PR in a repository with more than 100 open PRs instead of reading `unaskable`. The lookup writes its stderr to a `mktemp` file, and the file header describes the calls it makes.

<!--
plan: docs/plans/2026-10-24-bitbucket-and-github-listings-read-one.md
bumps:
  skills:
    plot: patch
-->
