---
'@plot-pm/board': minor
---

`/api/board` carries `tickets`, grouped into Open/In progress/Done by `ticketLane`, and `storyLanes`, grouped into Draft/Active/Done/Archived by `storyLane`. Both read the cache `/api/fleet` already fills; `/api/fleet`'s own inbox is unchanged. The Discovery tab renders both lane groups, with a `?archived=1` toggle that adds the Archived story lane and the rest of Done. When the plans directory cannot be read, `plansUnreadable` is set and the tab keeps showing the last successfully computed ticket lanes instead of reclassifying every ticket as Open.

<!--
plan: docs/plans/2026-10-12-tickets-and-stories-have-lanes.md
bumps:
  skills: {}
-->
