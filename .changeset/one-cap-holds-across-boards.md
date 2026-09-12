---
'@plot-pm/board': patch
---

The parallel-agent cap holds across every board on one repository. Two boards each read the shared agent registry, so the live half of the budget already agreed — but the in-flight set covering the window between dispatching and being visible lived in one process's memory, so each board saw an empty fleet and both spent the whole cap, reaching 2N between them. The marks now live in `.plot/state/auto-in-flight.json`, which every board reads and renews. They expire, so a board that dies mid-dispatch returns its budget; an unreadable record starts nothing, because a board that cannot see what the others hold must not conclude it is alone.

<!--
plan: docs/plans/2026-09-11-one-cap-holds-across-boards.md
-->
