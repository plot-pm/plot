---
'plot': patch
---

The GitHub arm of `plot-host.sh` reads `pr-list`, `pr-merged`, `pr-merge-commit`, `pr-merged-heads`, `issue-list`, `issue-view` and `default-branch` through `gh api` REST, so a spent GraphQL budget no longer blocks them; `pr-list --rich` keeps its GraphQL call and falls back to REST rows with unknown checks.

<!--
bumps:
  skills:
    plot: patch
-->
