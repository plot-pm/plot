---
'@plot-pm/board': minor
---

`/api/board` carries `tickets`, grouped into Open/In progress/Done by `ticketLane`, and `storyLanes`, grouped into Draft/Active/Done/Archived by `storyLane`. Both read the cache `/api/fleet` already fills; `/api/fleet`'s own inbox is unchanged. The `?archived=1` query parameter adds the Archived story lane and the rest of Done.

<!--
plan: docs/plans/2026-10-12-tickets-and-stories-have-lanes.md
bumps:
  skills: {}
-->
