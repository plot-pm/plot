# Panel round 3 — tickets-show-what-the-sprint-delivers-and-found

Round 3, 2026-11-20, on amendment b9795bcfa. Reconciliation: **unanimous `amend`** (estate, testability, user). No juror rejects. The operator approves on no reject (2026-11-20); the points below are the builder's.

Round 2: estate 4 of 4, testability 4 of 4, user 7 of 7 resolved.

## Builder notes, most important first

1. **The server cannot read `refutedIssues`** (estate 1; the juror calls it blocking while holding `amend`). Cards (`/api/board`) and the fleet payload (`/api/fleet`) are separate requests (`index.ts:525,548`); `refutedIssues` comes from `reads.delivered`, which only `board.ts` builds (`board.ts:2384,2607,3038-3048`). Add `isRefutedIssueTitle(title)` over fleetd's title `Refuted claim of ${slug}: ` (`verification.ts:155`, opened by `verify.ts:618`), keep rows by it in `planTicketRows` like `isReviewIssueTitle`, and use `refutedIssues` on the card only for the association. Do this in slice 1.
2. **Counts and splits need one owner** (testability 1, 2): `scopeTickets`/`ticketsSection` owns all three adjusted counts, including the hidden sentence (`waiting-view.ts:92` → `waiting-tickets.ts:256`); `splitTicketRows` (`waiting-view.ts:122-139`) takes the finding keys, with a unit test — no filter in `AgentList.tsx`.
3. **Dead Open on host** (user 1): `TicketHref` returns `undefined` with no address (`PlanTicketKeys.tsx:5,12`); pass the address per key into `scopeTickets` and disable the item with a reason when none resolves.
4. **Missing refuted keys** (estate 2): on an answered read, leave out a key the closed rows hold; show a key `planTicketRows` lacks as key + plan, no state word; unit cases.
5. **Hints and both-kinds tickets** (user 2, 3): name each new group's empty hint as a `scopeTickets` output; a ticket both delivered and found uses `plan-named` for Create plan in Found too.
6. **Smaller**: a second browser `it(` that opens both groups and sees one row each; `findOpenReviewIssue` takes the domain `Issue[]`; when `ticketPlansOf` answers `null` (`fleet.ts:1798`), ship `ticketPlans: {}` with `issueAnswer: failed`.
