---
'plot': patch
---

`plot-approve` refuses `slice-on-plan-branch` where a slice names the plan PR's head branch, because that PR's merge reads as the slice landing. The refusal fires before any merge or write, `Impl: same branch` is exempt, and an in-session plan the default branch holds asks the host once for the PR of its adding merge.

<!--
plan: docs/plans/2026-11-21-plot-approve-finds-a-plan-pr-at-any-age.md
bumps:
  skills:
    plot-approve: patch
-->
