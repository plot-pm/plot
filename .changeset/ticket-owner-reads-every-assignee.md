---
'plot': patch
'@plot-pm/board': patch
---

A ticket with several assignees now names a resolved one even where it is not the first, and the Discovery and Planning ownership filters no longer share one ambiguous field name for two different reasons.

`ownerOf` in `packages/domain/src/rules/ticket-lanes.ts` used to read `assignees[0]` outright — fixing #1790, a ticket assigned to an unresolved tracker login first and the reader's own declared spelling second showed the unresolved login and was silently hidden from "Only my work" as somebody else's. `ownerOf` now checks every assignee for a directory-declared spelling before falling back to the first assignee as written. `lanesForReader` in `packages/domain/src/rules/lanes-for-reader.ts` returned the same `FilteredLane`/`hiddenByTopic` shape `lanesForTopic` uses for its own, unrelated reason, so `StoriesTab.tsx` kept a second `ownedStoryByLane` lookup just to tell the two passes' `hiddenByTopic` apart; `lanesForReader` now returns its own `OwnerFilteredLane`/`hiddenByOwner` shape instead, and the board reads that field directly. `ownedFromStory`'s unused export in `packages/board/src/app/lib/agent-rows/mine-filter.ts` is also removed, leaving the one private copy in `lanes-for-reader.ts` that is actually called.

<!--
plan: docs/plans/2026-10-16-row-placement-and-wording-1677-1791.md
bumps:
  skills:
    plot-board: patch
-->
