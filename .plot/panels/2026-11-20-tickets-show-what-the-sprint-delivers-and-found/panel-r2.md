# Panel round 2 — tickets-show-what-the-sprint-delivers-and-found

Round 2, 2026-11-20, on amendment b5e7299c3. Lenses: estate, testability, user. Reconciliation: **unanimous `amend`**. No juror rejects.

## Round 1 resolution

Estate 6 of 6, testability 7 of 7, user 7 of 9 resolved. The source (`planTicketRows` over `entry.issueSets`), the double listing and the Mine rule definition are in.

## What remains (all three converge on the first)

1. **`TicketPlan` never reaches the client** (estate 1, testability 1, user 2). `ticketPhase` reads `TicketPlan` records that only `ticketPlansOver` builds on the server (`fleet.ts:1811-1836`); no card carries a merged count (`schema.ts:291-300`). Amend: slice 1 adds `ticketPlans: Record<key, TicketPlan[]>` from the map at `fleet.ts:2444`, an input of `scopeTickets`, with a server test.
2. **No predicate for review findings** (estate 2, testability smaller): `reviewIssueTitle`/`findOpenReviewIssue` take one PR, `TITLE_PREFIX` is private. Amend: export `isReviewIssueTitle(title)` with a unit test.
3. **The unassigned count still counts findings** (testability 2): `fleet.waiting.unassigned` is computed server-side (`waiting-tickets.ts:176-179`). Amend: name where counts exclude finding keys, with a unit case.
4. **Key-only rows' ⋯** (user 1, 3): no IssueRow and no URL, so `IssueRowActions` hides Open (`menus.tsx:1689-1692,1760`). Amend: name the items per row kind with domain-owned enabled/reason; an owning function for "a plan names the ticket"; decide Create story; an empty group under Mine shows its hidden count.
5. **Smaller**: `my-sprint` is "the sprints `deliveryScope` returns" (`delivery-scope.ts:61-65`), not every owned sprint; fold keys join through plan 2's mechanism (`KNOWN_KEYS` derives from `DELIVERY_LAYOUT`, `collapse.ts:6`) and `agent-list.test.ts:1384` pins `COLLAPSED_BY_DEFAULT`; type is `DeliveryMine`; `ticketIsMine` omits `TicketSource`.

## What the jurors looked at

Code opened for every reference; no board or test run.
