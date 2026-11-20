# Panel — tickets-show-what-the-sprint-delivers-and-found

Round 1, 2026-11-20. Lenses: estate, testability, user. Reconciliation: **unanimous `amend`** (estate, testability, user). No juror rejects; approval stays possible after the amendments below and a round that no longer asks for them.

## What all three found

1. **The plan reads from the wrong row set.** The client's `Fleet.issues` leaves out every ticket a plan names and stops at 50 rows (`fleet.ts:2170-2173`, `:257`); `Fleet.waiting.tickets` holds only the reader's own tickets and hides unassigned ones (`waiting-tickets.ts:116-198`). So an open delivered ticket never shows its title, and "not carried" is read as "closed" although both sets are capped. The server holds open and closed rows unfiltered in `entry.issueSets` (`fleet.ts:932-939`). Amend: name a payload field built server-side from `entry.issueSets` for the scope's tickets, with a server test.
2. **A finding shows twice.** Review and refuted-claim tickets are named by no `Issue:` line, so they already list in the "no plan" group (`ticketPlansOver`, `fleet.ts:1811-1836`; `waiting-view.ts:122-139`), with *Plan it ›*. Amend: the association rule decides that a finding leaves the "no plan" group, with a unit test.
3. **fleetd's findings are unassigned** (`auto-ticket.ts:112-116`), and the section reads `fleet.waiting` first, which hides unassigned rows (`AgentList.tsx:855-867`). With Mine on, "Found" stays empty unless "its plan is mine" is implemented. Amend: name the Mine rule as a function of the ticket, its plan and the reader, with unit tests.

## Where they differ in weight

- **Closed tickets.** The estate lens shows the plan's (and the spec's) premise "no payload holds closed tickets" is false: `ticketLaneData` serves closed rows from the last 14 days (`fleet.ts:1963-1986`) and `GET /api/issues/closed` serves up to 1000 (`index.ts:568`). The user and testability lenses treated key-only rows as a display gap; the estate lens shows it is a source choice. The amendment should use the existing closed rows instead of rendering key-only.
- **State text.** Testability says no function owns "Approved · 2 of 3 slices merged" (risk of `.tsx` composition); estate says `ticketPhase` (`ticket-phase.ts:32-66`) already produces it. Same finding from two sides: reuse `ticketPhase`.
- **Could-not-read.** Only the user lens raised that a failed tracker read hides the whole section (`TicketsSection.tsx:77-83`) although Delivered and verification findings need no tracker, and that `⚑ N found` must not read 0 for an absent reading (`tickets-section.ts:47-49`). Amend: per-group unread state.

## Smaller points

Refuted-claim ids are read only for Delivered plans (`board.ts:2528`, `:3047`); the count-gate sentence says "moving" where the plan adds a browser test raising `EXPECTED_TESTS = 719`; no default fold keys; no ⋯ actions named for the new rows; the slice should wait on plan 5.

## What the jurors looked at

All three opened the cited code; none ran the board or the tests. The shared blind spot: every lens took the spec's premises as given until the estate lens checked one ("no payload holds closed tickets") and found it false. The spec needs the same correction as the plan.
