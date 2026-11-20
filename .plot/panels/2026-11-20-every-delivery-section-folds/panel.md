# Panel — every-delivery-section-folds

Round 1, 2026-11-20. Lenses: estate, testability, user. Reconciliation: **unanimous `amend`** (estate, testability, user). No juror rejects.

## What all three found

1. **Retry has nothing to call.** No Retry control exists in `packages/board/src/app`, no `/api` route re-reads the tracker, and `App.tsx:573` `load()` refetches the board without making the tracker answer again. Amend: name what Retry calls, show it disabled with its reason, or drop it.
2. **The whole-row toggle swallows header controls.** The section headers hold buttons that do not stop propagation: You counts and phase-strip links, summary links, the Fleet switches and stepper (`AgentList.tsx:1575-1629`); only `ReleaseHeaderCounts` stops it (`ReleasePlanParts.tsx:73-77`). A click on Auto-dispatch would fold Fleet. Amend: every control in a toggling row stops propagation; only the 28 px button carries `aria-expanded`.
3. **"Empty" is undefined per section, and the fold decision stays in the component.** `fold`/`releaseFold` (`AgentList.tsx:1480-1532`) decide foldability inline; Machine's count is always 0; Release delivery counts plans; Machine and the Fleet footer render outside any fold guard (`:1699-1710`). Amend: one tested view property per section for count, empty kind and fold state, and fold guards for every block.

## Where they differ in weight

- **Jumps into folded sections** (user lens; the header panel found the same): `scrollToAnchor` (`DeliveryRows.tsx:20-22`) does nothing for an unmounted anchor; folding six more sections turns the You counts, summary and phase-strip links, TodoList jumps, row anchors and plan 4's "open ›" into dead controls. Amend: a jump opens the target section and group, then scrolls; the anchor-to-section mapping is a unit-tested view property. This is the most important amendment across the sprint: it touches plans 2, 3 and 4.
- **Empty versus hidden** (user lens): a section emptied by Mine, by my-sprint or by Tickets' *show all* would read "clear" while items exist out of view (`AgentList.tsx:1170-1176`, `delivery-scope.ts:24-27`, `tickets-section.ts:65-73`). Amend: the empty sentence names the scope and the hidden count, with a unit test per scope × Mine cell.
- **Not placed** (estate): it already renders only when `showUnplaced` is on (`AgentList.tsx:1766`, toggled by the footer's "details" at `:1858-1869`); a persisted fold on top gives one section two controls. Amend: name the one control.
- **Browser tests** (testability): toggles on empty sections change tests that click every `[data-group-toggle]` or the first one (agents-tab:4780, spec-run-rows:60, row-withholds:357). Amend: list them.

## Smaller points

Fleet and Machine have no assigned empty kind; the plan departs from the mockup's `?`/`○` glyphs and the "Start fleet" link (no controller) without saying so; when the dashed frame shows versus "— none" groups; three line references are off by one.

## What the jurors looked at

All three opened code; none ran the board. The shared blind spot: the plan treats folding as a section feature, and all three lenses found that a fold changes what other controls can reach. The amendment should state the reachability rule first.
