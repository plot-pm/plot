# «Mine» hides rows with no known owner and counts them

> With «Mine» on, the board keeps only rows that `isMine` answers `mine`, counts the `unknown` rows it hid, and lets the reader add them back with one control.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #2811
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- «Mine» shows only the reader's own rows. A «N unknown ▸» control appears beside the chip while «Mine» is on and N is above 0, and a click adds the rows with no known owner back. Unassigned tickets move to a collapsed *Unassigned* section.

Board impact: changes the Delivery and Discovery filters in `packages/board`, and `isMine` or a stricter sibling in `packages/domain`. No change to the plan format, the template or the helper scripts. The board artifact needs a rebuild on merge.

## Motivation

A reader who turns on «Mine» asks for their own work. Today `rowsForReader` and `ticketsForReader` (`packages/board/src/app/lib/agent-rows/mine-filter.ts`) hide only rows that `isMine` answers `theirs`. A row with no determinable owner answers `unknown` and stays, so «Mine» shows work that is not known to be the reader's, and nothing says how many such rows there are.

A high `unknown` count is a configuration signal: `People` lacks spellings for the assignees and authors on the board. Hiding the rows without counting them hides that signal too.

Issue #2811 was split from #2808 by panel round 1 (`.plot/panels/2026-10-28-empty-jira-inbox-read-as-a/panel.md` on branch `idea/empty-jira-inbox-read-as-a`). The bug plan for #2808 keeps the released rule that unknown rows stay visible. This plan holds the behaviour change.

## Design

### Approach

The proposed control, with «Mine» on:

```
[This sprint]  [Mine (Jan Wloka)]  14 others · 23 unknown ▸   [Waiting on me]
```

- «Mine» on keeps only `mine` rows.
- «23 unknown» renders only while «Mine» is on and the count is above 0. A click adds the `unknown` rows back. It is one control, not two toggles.
- Unassigned tickets go to their own collapsed *Unassigned* section instead of *Waiting on you*.
- The count and the visibility of the control are domain properties, asserted in unit tests. One browser test proves the control shows them.

The rest of this section lists what the design must settle before approval. Each item is a measured fact from the panel, not a choice made here.

**The released contract this reverses.** `docs/plans/2026-09-24-the-board-shows-me-only-my-work.md:123` says an unknown row is shown. Tests pin it: `ownership.test.ts:200,269`, `chip-row.test.ts:141`, `mine-filter.test.ts:45,74-100`. The plan states the reversal and amends that plan's line instead of leaving two contradicting plans.

**Every `isMine` caller.** There are five, including Discovery's `lanes-for-reader.ts:67` and the chip's `hiddenCount` (`chip-row.ts:168`). The plan chooses between redefining `isMine` (all five change at once) and a stricter filter for Delivery only (Discovery keeps the released rule).

**Agents.** `agentOwnership` never answers `theirs`. A mine-only filter therefore hides the reader's own desks that have no manifest, and every `elsewhere` agent (`ownership.ts:247-250`). The plan decides whether agent rows are exempt, counted as `unknown`, or fixed at the source.

**Bitbucket with no login.** `plot-host.sh account` exits 4 on Bitbucket. `hostUser` is then empty unless `PLOT_BUDGET_ACCOUNT` is set, every PR row reads `unknown`, and hiding `unknown` empties the board. That is the failure the 2026-09-24 rule prevents. The plan defines what «Mine» does when `readerIsKnown` is false.

**Stored state.** A stored `mine-only=1` hides more after the upgrade, though the reader did nothing. The plan decides between a new storage key, a one-time notice, or accepting the change.

**Signals that exist.** The chip shows `N hidden` for agent rows only (`DeliveryFilters.tsx:87-91`). Discovery's `hiddenByOwner` is an "it hid everything" signal that Delivery can reuse.

**A defect in `accountTicketOwnership`.** It answers `theirs` at the first declared assignee who is someone else, so `[mruepp, me]` gives `theirs`. Its own doc comment (`ownership.ts:176`) says any match is `mine`. A mine-only filter turns this from a visible-anyway quirk into a hidden own ticket, so the fix belongs in this plan's first slice or in a bug plan that lands before it.

### Open Questions

- [ ] Redefine `isMine`, or add a stricter filter for Delivery only?
- [ ] Do agent rows count toward «N unknown», stay exempt, or get an owner from the registry?
- [ ] What does «Mine» do while `readerIsKnown` is false?
- [ ] How does a stored `mine-only=1` behave after the upgrade?
- [ ] Does the *Unassigned* section replace the unknown count for tickets, or do both show?
- [ ] Does the `[mruepp, me]` fix ship as a bug plan first?

## Slices

### Ownership rule

- `feature/mine-keeps-only-mine-rule` — Domain: a strict mode of the ownership answer, an unknown count per row kind, and the `accountTicketOwnership` multi-assignee fix. <!-- builds: unknown count per row kind, strict mine filter -->

### Board control

- `feature/mine-unknown-control` — Delivery and Discovery use the strict answer, render the «N unknown ▸» control, apply the stored-state decision, and show the reader-unknown fallback.

### Unassigned tickets

- `feature/unassigned-tickets-section` — A collapsed *Unassigned* section for tickets with no assignee, out of *Waiting on you*. <!-- builds: Unassigned section -->

## Notes

- Created from issue #2811 by `/plot-idea`. Stops at Draft: whether the reversal is worth making is the reviewer's decision.
- Slice names and the wave order are a first proposal. The answers to the open questions can merge or reorder them.
