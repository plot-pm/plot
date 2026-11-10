---
'@plot-pm/board': patch
---

A story whose plan files are all Delivered or Released now stays in Active unless its own `status:` says done or archived, and its progress counts the plans its plan table names (4 of 18, not 5 of 5); the status-behind hint reads "plans delivered; story still open".

<!--
plan: docs/plans/2026-11-09-a-story-reads-done-when-its.md
bumps:
  skills:
    plot: patch
-->
