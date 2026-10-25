---
'@plot-pm/domain': patch
---

Fixed *Waiting on you* counting a ticket whose plans are all finished as a ticket not assigned to the reader. `allFinished` in `ticket-phase.ts` replaces `allReleased` and answers whether every plan naming a ticket is `released` or in a state `ticketPhase` cannot place (`rejected`, `superseded`), so a ticket with plans `[superseded, released]` no longer shows as waiting. `waitingTickets` leaves such a ticket out of `tickets`, `shown` and `hidden`, and `hidden` now counts only the open rows not assigned to the reader. A ticket named only by a rejected or superseded plan no longer sorts with the unplanned tickets.

<!--
plan: docs/plans/2026-10-24-delivery-chips-and-waiting-on-you.md
-->
