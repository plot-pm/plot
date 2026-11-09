---
'@plot-pm/board': patch
---

The state branch's ahead count, shown in the board's lag line and the sync pull request body, now counts the commits since the last commit whose tree equals the default branch's tree and skips forward-sync merges; before, a squash-merged sync left every earlier commit counted.

<!--
plan: docs/plans/2026-11-09-the-state-branch-ahead-count-grows.md
bumps:
  skills:
    plot: patch
-->
