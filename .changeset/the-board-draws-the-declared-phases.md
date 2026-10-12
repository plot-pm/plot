---
'@plot-pm/board': minor
'plot': minor
---

The board reads the `Workflow phases` config key and draws one column per declared plan phase, in declared order. Cards, rows, swimlane cells and story plan lists name the declared phase, the wire `phase` fields are strings, and a column carries its own `leadership`, `accent` and `checklist`. Under the default map a Draft plan reads in Design and the plans board has four columns, because Discovery holds stories. A refused map draws the defaults and shows its reason above the columns.

<!--
plan: docs/plans/2026-10-12-the-phases-are-declared.md
-->
