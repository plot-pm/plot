---
'@plot-pm/domain': patch
---

Fixed a ticket named only by a plan `ticketPhase` cannot place (`rejected`, `superseded`) sorting and counting as unplanned in *Waiting on you*, the same as a ticket no plan names at all. `allUnplaceable`, a new sibling of `allReleased` in `ticket-phase.ts`, answers "every plan naming this ticket is in a state this rule does not render," and `waiting-tickets.ts` now asks that — and whether any plan names the row at all — instead of reading `ticketPhase(plans) === null` as "unplanned." Such a ticket now excludes from `tickets` and counts in `hidden`, the same as an all-released one.

<!--
plan: docs/plans/2026-10-24-delivery-chips-and-waiting-on-you.md
-->
