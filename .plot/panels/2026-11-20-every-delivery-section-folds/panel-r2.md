# Panel round 2 — every-delivery-section-folds

Round 2, 2026-11-20, on amendment b5e7299c3. Lenses: estate, testability, user. Reconciliation: **unanimous `amend`**. No juror rejects.

## Round 1 resolution

Testability 6 of 6 resolved; user 9 of 9; estate 8 of 10 (test list and jump-list completeness partly). The round-1 structural problems — Retry, whole-row toggle, fold decision in the component, empty undefined per section — are resolved.

## What remains (all three lenses converge on the first)

1. **This plan defines a Mine rule it does not own** (estate 1, testability 1, user 1). Slice 2's cells assert the new "assigned to me or my plan" rule, which plans 5 and 7 own, and no slice anywhere builds it; today `deliveryMapping` keeps unknown-owner rows even under strict (`delivery-readings.ts:438-472`) and `mineAllows` filters only tickets (`delivery-placement.ts:302-304`). A wait on plan 7 would form a cycle. Amend: `sectionEmptyKind` decides no ownership; the hidden count is rows in `wholeReadings` minus rows shown (or `mineHiddenCount` over the same filter the rows use, `mine-mode.ts:95`). The Mine rule itself moves to one slice of its own that every plan using it waits on (see the sprint-wide note below).
2. **Jump list incomplete** (estate 2, testability 2): `expandSection`/`BlockedByMark` (`AgentList.tsx:520-524`, `marks.tsx:325-355`), App's `agent-row-<branch>` reveal (`App.tsx:1273-1283`), the link-line `scrollTo` (`AgentList.tsx:1253`), FleetCard `onJump`, direct `scrollToAnchor` calls (`DeliveryRows.tsx:47`); `anchorOwner` must cover `agent-row-*`, slice rows and `unplaced-details`. One browser test proves a count link into a folded section opens it.
3. **Frame and scope rules** (user 2, 3): the frame shows only where `sectionEmptyKind` is non-null (a measured Machine returns null); Fleet and Machine take no scope, their `my-sprint` cells equal `release`.
4. **Defaults and tests** (estate 3, testability 3): `readCollapsed` (`collapse.ts:63-74`) never applies a new default to a saved set, so `not-placed` starts open for existing readers — state the migration; keep `id="unplaced-details"`; list `agents-tab:1744/1874/1912`, `deliver-control:132`, `slice-status-speaks-verdict:57`, `plan-row-shows-plan-status-only:286`, `agent-list.test:1384`, `tickets-section.browser.test.ts:218` (`[data-tickets-absent]`).

## Sprint-wide note

The Mine rule "assigned to me or my plan" (operator decision 4) is stated in plans 2, 3, 5 and 7 and built by none. Round 3 needs one owning slice (proposal: first slice of plan 5, no waits), changing `ownedFromRow`, `agentsForReader` and `ticketsForReader` (`mine-filter.ts`) and `mineAllows`, with the plans that count or show Mine waiting on it.

## What the jurors looked at

Code opened for every reference; no board or test run.
