---
"@plot-pm/fleet": patch
"@plot-pm/domain": patch
---

Bounded the two ways `scaleUp` could hold a scale-up slot forever (#2486). A `--start` launch with no recorded pid yet now counts for only `launchGraceMs` (30 s) past its own `startedAt`, not `Worker bound`'s 8 h — a launch whose agent never starts now frees its slot within the daemon's own tick rather than holding it for a working day. A launch WITH a stamped, live pid now ages out too, through a new `Launched pid bound` `## Plot Config` key (default 28800 s): a reused pid left in an old manifest no longer inflates the running count forever. `launchedUnregisteredCount` moved from the fleet package into `@plot-pm/domain`'s `rules/queue.ts` as a pure function taking `alive` and `now` as readings, and `queue-reading.ts`'s `readQueue` now requires its caller to supply `alive` explicitly rather than defaulting to the real process table.

<!--
plan: docs/plans/2026-10-24-fleet-supervisor-holds-scale-slots-too.md
bumps:
  skills:
    plot: patch
-->
