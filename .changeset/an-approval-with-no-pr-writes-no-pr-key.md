---
'@plot-pm/board': patch
---

An approval with no plan PR, in-session or after a refused host read, annotates its sprint item with `pr: none` instead of `pr: #0`, and rewrites a `pr: #0` an earlier run left. A `pr` key that names a real PR is kept. `annotateSprintItem` now edits the line through `withSprintAnnotation`, so one implementation writes the annotation.

<!--
plan: docs/plans/2026-11-21-board-readings-take-the-domain-answer.md
bumps:
  skills:
    plot-approve: patch
-->
