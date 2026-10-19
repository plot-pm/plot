---
'plot': patch
---

`plot-host.sh pr-merge` on Bitbucket with no `--match-head` now refuses instead of merging unconditionally, matching the GitHub arm's precondition; a corpus test pairs the domain's `sameCommit` against the shell's prefix match.

<!--
plan: docs/plans/2026-10-19-the-merge-controller-cannot-merge-a.md
bumps:
  skills:
    plot: patch
-->
