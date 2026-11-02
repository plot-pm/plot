---
'@plot-pm/board': patch
---

The board parses a plan through `plot-plan-meta.sh` once per blob: `/api/board` and the ticket lanes start the parser only for plans whose content, parser script or `Tracker` value changed, and `ticketLaneData` runs once per request.

<!--
plan: docs/plans/2026-11-01-the-board-starts-processes-on-the.md
-->
