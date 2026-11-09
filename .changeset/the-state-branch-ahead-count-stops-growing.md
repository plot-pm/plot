---
'@plot-pm/board': patch
---

The state branch's ahead count, shown in the board's lag line and the sync pull request body, now counts the commits since the last commit whose tree equals the tree of a default-branch commit made after the state branch forked, and skips forward-sync merges. The count stays reset after the default branch takes further merges. Before, a squash-merged sync left every earlier commit counted.

<!--
plan: docs/plans/2026-11-09-the-state-branch-ahead-count-grows.md
bumps:
  skills:
    plot: patch
-->
