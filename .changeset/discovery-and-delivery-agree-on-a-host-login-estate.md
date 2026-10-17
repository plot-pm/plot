---
'plot': patch
---

Discovery's "Only my work" filter now answers from the same rule as Delivery's (#1793): `TicketLaneRow` carries every assignee and the ticket source, and `lanesForReader` and `ticketsForReader` both read a ticket through the domain's `ownedTicket`, so a ticket whose second assignee is the reader stays visible on both tabs. The unused `resolvedOwner` arm of `OwnedRow` is removed; `owner` stays on the row for display. `App.tsx` now passes `StoriesTab` a `reader` memoized once per server identity rather than a fresh object every render, so its own `useMemo` actually memoises. The empty-lane messages "Only my work hides every ticket/story in this lane" now have browser coverage, three stale review-history comments and one awkward sentence are reworded, and a `WAITING ON YOU` comment in `AgentList.tsx` that stated false behaviour is removed.

<!--
plan: docs/plans/2026-10-16-row-placement-and-wording-1677-1791.md
bumps:
  skills:
    plot: patch
-->
