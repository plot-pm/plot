---
'plot': patch
---

Fixes `accountTicketOwnership` (`packages/domain/src/rules/ownership.ts`) to check every assignee instead of returning at the first declared `<prefix><account>` spelling, which named a non-reader assignee `theirs` and never reached a reader listed second. The fold now mirrors `planOwnership`'s pattern, through a new shared predicate `accountNamesReader`, which `waitingTickets` (`packages/domain/src/rules/waiting-tickets.ts`) now calls in place of its own duplicate `accountMatches`. `ownerOf` (`packages/domain/src/rules/ticket-lanes.ts`) takes an optional reader and names the reader's own handle where any assignee resolves to them; `waitingTickets` passes its reader, and `lanesForReader` (`packages/domain/src/rules/lanes-for-reader.ts`) relabels each kept ticket row's owner the same way, since `ticketLanes` builds rows with no reader in scope.

<!--
plan: docs/plans/2026-10-28-a-jira-ticket-with-several-assignees.md
bumps:
-->
