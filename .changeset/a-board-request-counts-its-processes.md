---
'@plot-pm/board': patch
---

`GET /api/board` builds its payload in the `boardAnswer` controller, `interrogateAvailability` reads its config key asynchronously, and `board-request-starts.test.ts` lists the 41 processes a warm request starts and fails when the list grows.

<!--
plan: docs/plans/2026-11-01-the-board-starts-processes-on-the.md
-->
