---
'plot': minor
'@plot-pm/board': minor
---

A repository that declares a `State branch` in its Plot Config now takes every lifecycle write at that ref instead of the default branch: each write is cut from `origin/<state>` (from the default branch when the state ref does not exist yet), merges `origin/<default>` in, and pushes a fast-forward under the push lock. The state gate accepts a squash of the state ref's tip, and `plot-reap` never deletes the declared state branch.

<!--
plan: docs/plans/2026-11-07-state-branch.md
bumps:
  skills:
    plot: minor
    plot-idea: minor
    plot-release: minor
    plot-reject: minor
    plot-sprint: minor
    plot-dispatch: minor
-->
