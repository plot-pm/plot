---
'@plot-pm/board': patch
---

Auto-dispatch keeps asking for briefs while slices wait for one. An ask now holds a slot only until its brief lands on `origin/main`, asks are recorded per branch so a plan's later slice gets its brief asked for, and a free agent no longer counts against the brief budget.

<!--
plan: docs/plans/2026-10-02-a-landed-brief-frees-its-slot.md
-->
