---
'@plot-pm/board': patch
---

The board reads its own checkout's branch from `HEAD` in the git directory and starts no `git branch --show-current`, so an idle board whose page polls `GET /api/board` every 30 s while fleetd serves its snapshot starts no process. Census row S7 now holds that at zero.

<!--
plan: docs/plans/2026-11-09-board-api-starts-nothing.md
-->
