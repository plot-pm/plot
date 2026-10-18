# Waiting on you: a planned ticket shows its plan phase, not open

> A ticket in *Assigned to you* that a plan names shows the plan's phase in its status column, read from git, instead of the tracker's `open`.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:**
- **Issue:** #2022
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-18, Jan Wloka, plan-PR #2023 merged
- **Started:** 2026-10-18, Jan Wloka, `bug/planned-ticket-phase`

## Changelog

- A ticket in *Assigned to you* that a plan's `Issue:` field names stays in the list and shows the plan's phase in its status column: `planning`, `design`, `in progress 3/6` or `delivered`. A ticket named by two plans shows the less advanced phase. A ticket named by no plan keeps the tracker state, and sorts above the planned tickets.

<!-- Board impact: changes the *Waiting on you* wire shape (`FleetWaiting.tickets` gains a plan phase) and reverses the filter that PR #1992 added in `waitingOf`. No change to the plan format, the template, the helper scripts or `issues.json`. Rebuild the board artifact (pnpm build:board). -->

## Motivation

A ticket row in *Assigned to you* shows the tracker's own state in its status column. On GitHub that state is `open` for every ticket, so a ticket with an approved plan and three merged slices reads the same as a ticket nobody has touched. Measured 2026-10-18: 10 tickets under *Assigned to you*, 9 of them named by a plan (4 Approved with slices in flight, 5 Delivered), and all 10 read `open`.

PR #1992 (plan `a-planned-issue-shows-its-plan`) removes a ticket named by a plan from *Waiting on you*. The ticket then leaves the board's ticket list, and its progress is visible nowhere on it. Decided 2026-10-18 by Jan Wloka: a planned ticket never reads `open`, because then its progress cannot be seen.

## Design

### Approach

The plan phase is a domain property of the ticket, computed from the plans that name it. The row component reads it and decides nothing (`CLAUDE.md`, *Every rendered state is a domain property*).

| Plan named by `Issue:` | Phase shown |
|---|---|
| Draft, or in a Draft plan PR | `planning` |
| Design | `design` |
| Approved | `in progress`, with the slice count when the plan has slices: `in progress 3/6` |
| Delivered, not released | `delivered` |
| none | the tracker state (`open`) |

A ticket named by two plans shows the phase with the lowest order in `phaseOrder` (`packages/domain/src/entities/workflow.ts`). Both phases are read from git (the plan file's `State:` and its slices' merged PRs). No `plan:*` label is read: the labels stay a one-way reflection, as `packages/domain/src/entities/issue.ts:21-29` and `skills/plot/MANIFESTO.md:17` state.

Domain: a rule `ticketPhase` in `packages/domain/src/rules/` takes the plans that name one ticket (state, merged and total slice count) and returns the label and the order key, or `null` when no plan names it. `waitingTickets` (`packages/domain/src/rules/waiting-tickets.ts`) takes the planned set as a map from issue key to plans instead of the `referenced` set, puts unplanned tickets first, then planned tickets, each group newest first. `WaitingTicket.status` carries the phase word for a planned ticket, so the existing status cell renders it without a new field in the component.

Board: `referencedIssues` (`packages/board/src/server/fleet.ts:1483`) returns the issue keys only. It grows a sibling that returns each ticket's plans with state and slice counts, read through `planMeta`, which already carries `issues` and the slices. `waitingOf` (`fleet.ts:1824`) stops dropping planned rows and passes the map to `waitingTickets`. `inboxOf` (`fleet.ts:1774`) keeps filtering by `referenced`: the *Inbox* lists unplanned issues only, and this plan does not change that.

Counting slices: the slice count uses the merged-PR reading the fleet already makes for the plan row, not a second host call. A plan whose reading is missing shows `in progress` without a count, never `0/0`.

### Open Questions

- [ ] Where does the slice count come from for a plan on the default branch with no fleet reading yet: the pulse bridged to `.plot/state/last-pulse.json`, or the plan row's own tally? Name the source before the slice starts.
- [ ] Does `in progress` cover an Approved plan with no slice started, or does that read `approved`? The issue lists four words only; this plan assumes `in progress`.
- [ ] A Released plan: the issue lists no word for it. This plan assumes a ticket named only by Released plans shows `released` until the tracker closes it. Confirm.
- [ ] Jira tickets carry their own workflow state (`To Do`, `In Progress`). Does the plan phase replace the Jira state, as it does the GitHub `open`, or only where the tracker is GitHub?

## Slices

### Ticket phase

- `bug/planned-ticket-phase` — `ticketPhase` rule with unit tests; `waitingTickets` takes the plans per ticket, shows the phase in `status`, sorts unplanned first; `waitingOf` stops filtering planned rows and passes the plans <!-- builds: ticketPhase, the plan phase of a ticket in Waiting on you --> → #2041

## Notes

- Source: https://github.com/plot-pm/plot/issues/2022. The issue is the problem statement; this plan writes nothing to the tracker.
- Related: #1979 (plan labels), #1830 (row placement and wording), #1837 (ticket rows show type and owner), #1992 (the filter this plan reverses in *Waiting on you*).
- `plot-idea` ran unattended: the Type came from the prompt (`bug`), the design question defaulted to no, and the plan stops at Draft.
