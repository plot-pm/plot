# Board filters: one chip row and a sprint line

> The Delivery tab shows its filters as three controls in three styles and two cards, about 200 px tall. This plan replaces them with one row of toggle chips and a sprint line that reports the sprint only.

## Status

- **State:** Approved
- **Type:** feature
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2085 merged
- **Sprint:** <!-- optional, filled when plan is added to a sprint -->
- **Issue:** #2080
- **Story:** <!-- optional, story slug this plan is part of (docs/stories/<slug>/) -->
- **Review:** pr
- **Impl:** own branches

## Changelog

- The Delivery tab shows its filters as one row of toggle chips: `This sprint`, `Mine (<identity>)` and `Waiting on me`. An active chip is filled and states how many rows it hides. A chip that cannot act is disabled, and its tooltip names the fix.
- The sprint line reports the sprint only: name, target, dates and the states of its own items. The sprint name links to the sprint and replaces the `Active sprint` button.
- The estate totals sit at the right end of the chip row and count what the active filters leave in view.

<!-- Board impact: changes the Delivery tab in packages/board. No change to the plan format, the template, the helper scripts or the docs/plans layout. The board artifact needs a rebuild (pnpm build:board) when the slices land. -->

## Motivation

Issue #2080 records the Delivery tab as rendered on 2026-10-19:

- Three controls use three styles: an outlined `Active sprint` button, a `Sprint only` checkbox inside a large card, and an `Only my work` checkbox inside a second card.
- The sprint card mixes the filter with a status report. The totals `485 plans · 0 open · 1 WIP · 458 done · 26 withdrawn` count the whole estate, not the sprint.
- The `Only my work` hint is wider than the control it explains.
- The two cards take about 200 px of height before the first section.

The identity defect behind the hint is filed separately as #2079 and planned in `only-my-work-says-no-identity`. This plan consumes that fix and does not repeat it.

## Design

### Approach

Target layout, from the issue:

```
Sprint 2.28.0 · Bitbucket, Jira and Jenkins work with the board · 16 → 23 Oct · 9 items: 6 done · 2 WIP · 1 open
[✓ This sprint]  [  Mine (jwloka)]  [  Waiting on me]            485 plans · 1 WIP · 458 done
```

- **One chip row.** Every filter is a toggle chip of one style. An active chip is filled and states what it hides (`12 hidden`).
- **The sprint line reports the sprint only**: its own items and their states. The sprint name links to the sprint.
- **Estate totals sit at the right end of the chip row** and count what the active filters leave in view.
- **A chip that cannot act is disabled**, with a one-line tooltip that names the fix. No inline prose.
- **`Mine` names the identity it matches.**
- At 375 px the chip row wraps and the page does not scroll sideways.

Layering follows `CLAUDE.md` (*Every rendered state is a domain property*). Each chip's state, count, hidden count and disabled reason is a property computed in `packages/domain`, and a unit test asserts it. The `.tsx` renders those properties and decides nothing. One browser test shows the row.

Existing code the slices change:

- `packages/board/src/app/components/SprintFilter.tsx` (the sprint card and button)
- `packages/board/src/app/App.tsx` (the `data-mine-filter` checkbox)
- `packages/board/src/app/lib/agent-rows/mine-filter.ts` (the reader and the stored toggle)
- `packages/domain/src/rules/lanes-for-reader.ts` (the `Only my work` rule)

The chip's tooltip for a missing identity reads the state `only-my-work-says-no-identity` fixes, so that plan lands first.

### Open Questions

- [ ] Does `Waiting on me` filter the Delivery sections, or only the *Waiting on you* block? The issue names the chip and no behaviour. A chip that filters nothing it can name must be disabled.
- [ ] Which counts does `N hidden` use: rows or plans? A slice's row and its plan can differ.
- [ ] Does the sprint line link to the sprint file on the board, or to a sprint view? The board has no sprint page today.
- [ ] Do the Discovery and Planning tabs get the same chip row? Both carry an `Only my work` filter since #1751. The issue covers the Delivery tab only.
- [ ] Where does the estate total's `0 open` and `26 withdrawn` go once the totals follow the filters? The issue's example drops both.

## Slices

### Domain

- `feature/chip-row-states-are-domain-properties` — one rule that returns, per chip, its label, on/off state, hidden count, and disabled reason with the fix it names; a rule for the sprint line's own item states; a rule for the filtered estate totals. Unit tests assert each. <!-- builds: chipRow, a domain rule for the filter chips' state, count and disabled reason -->

### Board

- `feature/the-delivery-tab-renders-one-chip-row` — replaces `SprintFilter.tsx`'s card, the `Active sprint` button and the `Only my work` checkbox with the chip row and the sprint line, rendering the domain properties. One browser test shows the row at desktop width and at 375 px. <!-- waits: feature/chip-row-states-are-domain-properties -->

## Notes

- 2026-10-19: created from issue #2080 by `/plot-idea`, stopped at Draft. Related: #2079, `docs/plans/2026-10-19-only-my-work-says-no-identity.md`. Earlier plan on the same control: `docs/plans/2026-08-24-the-sprint-filter-says-what-it-filters.md` (Released).
- Deliverable search for `chip row`, `Only my work`, `Sprint only` and `Active sprint` found no existing chip-row rule. It found `lanes-for-reader.ts`, which this plan builds on.
