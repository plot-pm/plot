# Panel round 2 — delivery-rows-act-from-one-place

Round 2, 2026-11-20, on amendment b5e7299c3. Lenses: estate, testability, user. Reconciliation: **unanimous `amend`**. No juror rejects.

## Round 1 resolution

User 7 of 7, estate 7 of 7 resolved; testability resolved except detail points. The inventory, `rowMenuOf`, and the Work items grid against `WORK_ITEM_COLUMNS` are in.

## What remains

1. **The ⋯ item sets are not fixed** (user 1, 2). `looseActions` returns booleans without reasons (`delivery-placement.ts:272-300`) and `CleanUpMenu` shows an item only where its controller accepts the row (`CleanUpMenu.tsx:36-43`), so the spec's own "Delete branch — claimed, release it first" would vanish. Today Release claim confirms (`delivery-view.ts:137-142`) and Approve, Deliver, Create plan and Create story arm first. Amend: a fixed item set per row kind; `looseActions` returns `{enabled, reason}`; every action that confirms today keeps `confirm`, asserted per row kind.
2. **The healthy fleet agent loses its menu** (user 3, estate 3): `BranchMenu` items (log, Open, Continue, Restart, `AgentList.tsx:1446-1475`) have no place; split the inventory row at `:1463`.
3. **Grouping and verbs** (testability 1, 3; estate smaller): the spec groups only Unblock; the plan groups any same-verb rows without a consequence for non-loose groups, and does not reconcile with `nestItems`/`oneRowPerDraftPlan`. The new `REASON_DO` drops `action`, which the Do link reads (`delivery-row-form.ts:526`). Plan 4 keeps `todoList`, so `todo-list.test.ts` changes. Amend: group Unblock only (spec), keep `action`, list the test.
4. **Dependencies and duplicates** (estate 1, 2): the You slice uses plan 2's `#tickets` jump and amber unread state — add `waits: feature/delivery-section-empty-kinds`; `rowSprintMembership` duplicates `rowInSprintSelection`/`inAnyActiveSprint`/`rowIsSprintExempt` (`sprint-selection.ts:83,93,117`) — build on them, and fix the file named.
5. **Smaller**: `statusPills` takes three input shapes under one signature — split or name the move of `LINE_STATE` (`ReleasePlanParts.tsx:179`) and test the Fleet pill; `IssueRowActions` is called both "unchanged" and "disabled with `planItReason`".

## Sprint-wide note

This plan is the proposed owner of the Mine rule "assigned to me or my plan" (operator decision 4), which plans 2, 3, 5 and 7 state and no slice builds: add a first slice that changes `ownedFromRow`, `agentsForReader`, `ticketsForReader` (`mine-filter.ts`) and `mineAllows`, with no waits, and have the others wait on it.

## What the jurors looked at

Code opened for every reference; no board or test run.
