# Panel — delivery-rows-act-from-one-place

Round 1, 2026-11-20. Lenses: estate, testability, user. Reconciliation: **unanimous `amend`** (estate, testability, user). No juror rejects.

## What all three found

1. **The Work items slice cites the wrong grid.** Today's grid is `WORK_ITEM_COLUMNS`/`workItemCells` with a column per group (`WORK_GROUP_COLUMN`, `delivery-work-columns.ts:14-55`), not `ROW_COLUMNS`; `gatesCell` (`delivery-row-form.ts:286`) and `workByCell` (`:373`) already exist. The plan does not say where today's Gates / Progress / Waits-on values go, nor what replaces their tests in `delivery-work-columns.test.ts`. Amend: rewrite the slice against the real grid.
2. **The bulk delete disappears silently.** `CleanUpBulkDelete` (`CleanUpMenu.tsx:110`, `AgentList.tsx:1744`) ships today; the spec forbids bulk actions and the plan does not say it removes it. Amend: state the removal and its test change.
3. **The ⋯ menu has no tested home and an incomplete inventory.** `menuState` (`menus.tsx:250-322`) returns only `{present, enabled}`; disabled reasons are written in eight `.tsx` menus (e.g. `SliceActions`, `menus.tsx:1106-1110`); `RowMenuView`/`rowMenuOf` (`delivery-view.ts:100-122`) exists and is not cited; `PlanActions`, `StartWorkButton`, `BranchMenu`, `IssueRowActions` (`menus.tsx:1689`, which already holds Create plan / Create story / Open) are not placed. Amend: one view property `{action, label, enabled, reason, confirm}` per row kind with unit tests, built on `rowMenuOf`, and an inventory mapping every existing menu and button to its new place.

## Where they differ in weight

- **Release approval as a You row** (user lens): `placeDelivery` sends every release item to `releases` and no section (`delivery-placement.ts:435-437`), so the mockup's "Approve release" You row cannot appear. The other lenses did not raise it. Needs a decision: a placement change, or the approval stays in the header's Release group only.
- **Controls and anchors moved by the Fleet slice** (user lens): `WorkingCounts`, `FleetAlert` and the `#fleet-controls` anchor (target of "turn on ›") are not placed. Amend, and wait on plan 2 as well as plan 4.
- **Controller list** (estate): approve, deliver, implement, dispatch and continue are missing; "design starts" has no board route (only `/api/needs-design`).
- **You verbs** (testability, estate): the verb, consequence and tone of each of the 12 `YouReason`s are not specified, and `REASON_DO` stays as is; "similar" rows are still an open question.

## Undecided by the spec

Which Mine mode "Mine on" means (`off` / `mine` / `strict`); whether `release` scope with Mine off narrows to active sprints (today `selection: []`); where a Work items row shows "no sprint". A row with no action keeps an empty ⋯ cell so other menus stay at the same x (user lens) — a builder detail worth stating.

## What the jurors looked at

All three opened code; none ran the board. The shared blind spot: the plan inventories what it builds and not what exists; all three lenses found existing controls the plan does not account for. The amendment should start from an inventory of today's row controls.
