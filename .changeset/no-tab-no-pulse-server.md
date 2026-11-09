---
'@plot-pm/board': patch
---

The board runs its 5 s refresh pulse only while a page holds an event stream on `/api/events`. When the last stream closes, the pulse stops, the board writes no reader-lock heartbeat, and a `plot-pr-reader.mjs` it started exits after `HEARTBEAT_STALE_MS`. A page that attaches again gets one scan and one PR read at once. A plain request such as `/api/board`, `/api/fleet` or `plot-board --status` gets one fresh scan when the last read is older than 5 s, and starts no pulse.

<!--
plan: docs/plans/2026-11-08-no-tab-no-pulse.md
-->
