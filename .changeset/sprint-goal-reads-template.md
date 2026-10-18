---
'plot': patch
'@plot-pm/board': patch
---

A sprint cut from the shipped template now serves a non-empty goal: `parseSprintContent` falls back to the first non-empty line of `## Sprint Goal` when no `**bold**` headline is present, rather than leaving every templated sprint at `goal: ''` until someone hand-bolds a line.

<!--
plan: docs/plans/2026-10-17-one-review-issue-per-pr-a.md
bumps:
  skills:
    plot: patch
-->
