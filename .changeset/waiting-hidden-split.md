---
'plot': patch
---

`waitingTickets` (`packages/domain/src/rules/waiting-tickets.ts`) splits its `hidden` count into `unassigned` and `assignedToOthers`, summing back to `hidden`, partitioned by whether a hidden row's `assignees` is empty — no `ownership()` call, since every hidden row already failed the picked check regardless of spelling. `hiddenSentence` now names both counts, e.g. "4 open tickets are not assigned to you — 1 unassigned, 3 assigned to someone else". `FleetWaitingSchema` carries the two new fields, defaulted to `0` for an older server; `fleet.ts` and `waiting-view.ts` thread them through. Selection is unchanged — the same rows render in *Waiting on you* as before.

<!--
plan: docs/plans/2026-10-28-mine-hides-rows-with-no-known.md
bumps:
-->
