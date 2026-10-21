---
'plot': patch
---

The Sprint/Release comparison's `missingFromSprint` list now counts a Should Have or Could Have item as naming a Release key, not Must Haves alone — a Release issue a Should or Could item names no longer reports as drift. `missingFromRelease` and `notCompared` are unchanged: only a Must Have is required to ship in the Release.

<!--
plan: docs/plans/2026-10-21-sprint-to-release-drift-lists-should.md
-->
