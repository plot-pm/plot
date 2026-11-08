---
'@plot-pm/board': patch
---

The board starts its `plot-pr-reader.mjs` only while a page holds an event stream on `/api/events`. A plain request with no stream attached gets one scan and no PR read, starts no reader and writes no reader-lock heartbeat. When the last stream closes, the board removes its heartbeat, and the reader exits on its next 60 s beat before that beat's host read. A live `fleetd` heartbeat still makes the reader exit, now also before the host read.

<!--
plan: docs/plans/2026-11-08-no-tab-no-pulse.md
-->
