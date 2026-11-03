---
'plot': patch
---

`plot-host.sh pr-state` names the PR's head branch as `head` on GitHub (GraphQL and REST) and on Bitbucket. `plot-ask.mjs merge` now admits a repair or revert PR on a red default branch and refuses a `changeset-release/` PR as `release-pr`. A merge whose host answer names no head branch refuses as `unaskable`.

<!--
bumps:
  skills:
    plot: patch
-->
