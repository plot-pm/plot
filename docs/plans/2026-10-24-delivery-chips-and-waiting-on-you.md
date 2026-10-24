# Delivery chips and Waiting on you count rows the reader cannot see

> The domain decides every delivery chip's state, label and hidden count and every Waiting on you count, so each number equals the rows the reader can see.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2476
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2490 merged
- **Started:** 2026-10-24, Jan Wloka, `bug/delivery-chips-decided-in-the-domain`

## Changelog

- The sprint chips, the Mine chip and the Waiting on you counts report the number of rows the current view hides or shows.

<!-- Board impact: changes packages/domain rules and packages/board components and tests. No change to the plan format, the template, the helper scripts or the docs/plans layout. -->

## Motivation

Issue #2476 collects 36 follow-up findings from plot-review on ten merged PRs (#2047, #2086, #2098, #2103, #2138, #2379, #2414, #2455, #2467, #2470), checked against `origin/main` at `84b1638e4` on 2026-10-24. 15 are MEDIUM. They fall into four defects:

- **A count differs from the rows it describes.** The This sprint chip counts hidden rows against every Active sprint while the filter uses the current selection (`AgentList.tsx:726`, `DeliveryFilters.tsx:135`). The per-sprint chips hardcode 0. `waiting-tickets.ts:165-174` counts planned and released rows that the inbox never renders, so "Showing N of M" reports N < M with every reachable ticket on screen, and the board calls the reader's own released tickets "not assigned to you".
- **A rule contradicts its own TSDoc.** `rowInSprintSelection` passes every row on an empty selection, including rows in no Active sprint (`sprint-selection.ts:107`). `PlanStatusCountsSchema` says an unknown status is not counted while `planStatusCounts` adds it to `total` (`plan-status-counts.ts:8`). `fleet.ts:1575` shows a ticket whose plan has no recognised phase as unplanned while the inbox drops it as planned.
- **A decision sits in the component.** The per-sprint chips' state and label are decided in the board (`chip-row.ts:86`), and `filteredEstateTotals` and `sprintLineCounts` only pass input through, so the caller still decides visibility (`filtered-estate-totals.ts:17`). The Mine chip is enabled with a `gitEmail` that the ownership rule never matches (`chip-row.ts:72`).
- **Tests that cannot fail.** Three browser tests assert on fixtures where old and new behaviour agree (`delivery-filters.browser.test.ts:104`, `unplanned-issues.browser.test.ts:175`, a leftover `data-sprint-hidden` assertion in `sprint-switch.browser.test.ts:199`). `unplanned-issues.test.ts:465` runs the real `plot-config.sh` without pinning `PLOT_REPO_ROOT`. `chip-row.test.ts` has no unknown-owner row, and the lost board-level test for an unknown URL sprint slug is not restored.

The remaining LOW findings are stale or false comments and changesets (listed in the issue) and two duplicated declarations (`NO_SPRINT`, `FilterOption`).

## Design

### Approach

Per *Every rendered state is a domain property* in `CLAUDE.md`, each fix moves the decision into `packages/domain` and leaves the component rendering the answer. Each fix starts with a fixture on which the old and the new behaviour disagree.

1. `chipRow` returns, for every chip, its state, label, disabled reason and hidden count, computed from the current selection. The board renders it. This covers the per-sprint chips, This sprint, and the Mine chip (disabled when the ownership rule cannot match the reader's identity).
2. `rowInSprintSelection` hides rows in no Active sprint on an empty selection, as its TSDoc states.
3. `waitingTickets` counts only rows the view can render, and excludes planned and released rows from the shown and hidden counts. The unknown-phase case in `fleet.ts:1575` and the inbox use one answer.
4. `filteredEstateTotals`, `sprintLineCounts` and `planStatusCounts` either decide what they claim to decide or lose the claim.
5. Test, comment and changeset corrections, with `NO_SPRINT` and `FilterOption` declared once, in the domain.

The issue's LOW findings on `DeliveryFilters.tsx:163` (the dropped exempt count and late-timebox signal) and `ticket-phase.ts:18` (`order` never used for sorting) each need a decision before a change: restore the signal, or remove the dead code and say so.

### Open Questions

- [ ] Does the Mine chip fall back to the display name when no email matches, or does it disable? The issue's Expected says "disables itself when it cannot".
- [ ] Is the exempt count and late-timebox signal of #2086 restored, or is its removal recorded as intended?
- [ ] Does `waitingTickets` sort by `TicketPhase.order`, or does `order` leave the type?

## Slices

### Chips

- `bug/delivery-chips-decided-in-the-domain` — chipRow decides state, label and hidden count for every chip; the empty-selection and Mine-identity rules follow the TSDoc → #2521

### Waiting on you

- `bug/waiting-on-you-counts-visible-rows` — waitingTickets and the unknown-phase ticket count only what the view renders

### Tests and text

- `bug/chip-and-inbox-tests-can-fail` — fixtures where old and new behaviour disagree, pinned PLOT_REPO_ROOT, corrected comments and changesets, one declaration of NO_SPRINT and FilterOption

## Notes

- Overlapping earlier plans, listed because the title check found shared words: `2026-10-19-one-chip-row-and-a-sprint`, `2026-10-23-only-my-work-waiting-on-you`, `2026-10-15-waiting-on-you-lists-a-draft`, `2026-10-01-waiting-on-you-counts-tickets-as-tickets`. This plan repairs defects those plans shipped.
- Slice names and the three-way split are a proposal for the reader to confirm or reslice.
- Definition of Done: docs/definition-of-done.md
