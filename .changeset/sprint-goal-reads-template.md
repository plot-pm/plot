---
'plot': patch
'@plot-pm/board': patch
---

A sprint cut from the shipped template now serves the goal the operator typed: the domain's `sprintGoal` reads the `> ` line under the `# Sprint:` title first, then the first prose paragraph of `## Sprint Goal` up to the next heading of any level, skipping HTML comments, lists and `<…>` template slots, so the board never shows `<expanded goal description>` as a goal.

<!--
plan: docs/plans/2026-10-17-one-review-issue-per-pr-a.md
bumps:
  skills:
    plot: patch
-->
