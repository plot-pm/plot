---
'plot': patch
---

Discovery's "Only my work" filter now agrees with Delivery's on a host-login estate (#1793): `TicketLaneRow` carries the ticket source's `sourceKind`, and `lanesForReader` matches a `host-login` owner exactly, the way `ticketsForReader` already does, instead of always falling back to the lenient free-text match a tracker-account spelling needs. `App.tsx` now passes `StoriesTab` a `reader` memoized once per server identity rather than a fresh object every render, so its own `useMemo` actually memoises. The empty-lane messages "Only my work hides every ticket/story in this lane" now have browser coverage, and three stale review-history comments and one awkward sentence are reworded.

<!--
plan: docs/plans/2026-10-16-row-placement-and-wording-1677-1791.md
bumps:
  skills:
    plot: patch
-->
