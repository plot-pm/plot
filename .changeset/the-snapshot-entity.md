---
'@plot-pm/board': patch
---

The domain package gains `RepoSnapshot`, one reading per source fleetd and the board read (refs, desks, desk files, workers, plans, the agent registry, PR and issue rows, the default-branch reading and the config), each `read`, `unread` or `failed`. `recordReading` records a reading by content and moves the snapshot's generation only when the content changes; `staleReadings` maps a change to the readings it makes stale. Nothing calls them yet.

<!--
plan: docs/plans/2026-11-09-the-snapshot-entity.md
-->
