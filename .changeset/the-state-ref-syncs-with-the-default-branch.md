---
'@plot-pm/board': minor
---

A repository that declares `State branch` now syncs both ways. fleetd merges `origin/<default>` into the state ref when no writer holds the push lock, and a conflict names its file in the lag line and is not retried until a tip moves. A plan that reaches Delivered opens one sync PR from the state branch to the default branch, or refreshes the open one; `/plot-deliver` does the same when no fleetd heartbeat is live. The merge arm and the review refuse a sync PR whose diff touches a path outside the plan, index, sprint and release directories. After a squash-merge the lag line reads `0 ahead` by tree equality.

<!--
plan: docs/plans/2026-11-07-state-branch.md
bumps:
  skills:
    plot-deliver: minor
    plot: minor
-->
