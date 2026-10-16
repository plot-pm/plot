# Waiting on you: ticket rows show type and owner under one 'Assigned to you' sub-header

> Ticket rows in Waiting on you carry the ticket's type and owner, decided in the domain, and sit under one "Assigned to you" sub-header with a count instead of repeating `TICKET` on every row.

## Status

- **State:** Approved
- **Type:** feature
- **Issue:** #1837
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1842 merged
- **Started:** 2026-10-16, Jan Wloka, `feature/ticket-rows-show-type-and-owner`

## Changelog

- Waiting on you shows each ticket's type and owner, and groups the tickets under one "Assigned to you" sub-header with their count.

<!-- Board impact: changes the Waiting on you ticket rows (packages/board/src/app/lib/agent-rows/rows.ts IssueRowView, waiting-view.ts, AgentList.tsx) and the IssueRow wire shape (packages/board/src/contract/schema.ts). No change to the plan format, template, helper scripts or docs/plans layout. Rebuild the board artifact if the contract changes. -->

## Motivation

Issue #1837 (maintainer, 2026-10-16), seen on the board for plot-pm/plot with four tickets (#1757, #1713, #1688, #1556): the ticket rows in Waiting on you look alike and repeat their kind.

- Every row carries the word `TICKET`, which says nothing the section does not already say.
- A row does not show the ticket's type (bug, feature, and so on) or its owner. The Discovery tab's ticket card already shows both (#1766, #1782).

Out of scope, per the issue: the plan-slug column and the `open` status word stay as they are.

## Design

### Approach

**Reuse the Discovery card's rules.** `ticketCardView` (`packages/domain/src/rules/ticket-card.ts:116`) already returns `type` and `owner` for a `TicketLaneRow`, and `ownerOf` (`ticket-lanes.ts:80`) resolves the first assignee through the `People` directory. The Waiting on you row must call these, not repeat them: a second implementation in the row would be a decision made in a component (*Every rendered state is a domain property*, `CLAUDE.md`).

**The gap.** `IssueRow` (`schema.ts:3451`) carries `assignees` and no `type`, and the board resolves no owner for it. The domain's `waitingTickets` (`packages/domain/src/rules/waiting-tickets.ts`) builds the section's rows server-side; it extends those rows with `type` and a resolved `owner`, using the same two functions the Discovery lanes use.

**The sub-header.** `waitingView` (`waiting-view.ts:39`) already writes every text of the ticket block. It gains a sub-header text, `Assigned to you · N`, where N is the count of rendered tickets. `AgentList.tsx` renders the tickets under that one sub-header and drops the per-row `TICKET` kind label. The hidden-count line ("N open tickets are not assigned to you · show every ticket", `waitingView.hidden` and `control`) moves under the sub-header in a smaller type style.

**Unit tests, not browser tests, carry the decision.** The domain test asserts type and owner for a resolved handle, an unresolved raw spelling and an unassigned ticket. The `waitingView` test asserts the sub-header text and count with the control on and off. One browser test shows the sub-header and a row's type and owner.

### Open Questions

- [ ] With the *show every ticket* control on, the list holds tickets that are not assigned to the reader. Does the sub-header still read "Assigned to you", or does it change wording (for example "Open tickets")?
- [ ] Where the reader is unmatched (`waiting.notice` set), `waiting.tickets` falls back to every open ticket. The same question applies: the sub-header must not claim assignment the board did not establish.
- [ ] Where a ticket has no type or no owner, does the row omit the badge, or print a placeholder? The Discovery card's choice decides.

## Slices

### Ticket rows

- `feature/ticket-rows-show-type-and-owner` — Add `type` and resolved `owner` to the Waiting on you ticket rows through `ticketCardView`/`ownerOf`, add the `Assigned to you · N` sub-header text to `waitingView`, render the tickets under it with the hidden-count line in a smaller style, drop the per-row `TICKET` label, and cover it with domain and `waitingView` unit tests plus one browser test. <!-- builds: waitingView sub-header, the Assigned to you count text -->

## Notes

- Created from issue #1837 by `/plot-idea`, unattended. The issue is the only link; nothing was written to the tracker.
