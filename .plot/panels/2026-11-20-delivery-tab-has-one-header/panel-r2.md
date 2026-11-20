# Panel round 2 — delivery-tab-has-one-header

Round 2, 2026-11-20, on amendment b5e7299c3. Lenses: estate, testability, user. Reconciliation: **unanimous `amend`**. No juror rejects.

## Round 1 resolution

Testability 6 of 9 resolved, 3 partly; user 6 resolved, 1 mostly, 1 partly; estate most resolved. Five bar states, `lastRelease`, the split into two slices and the reachability wait are in.

## What remains

1. **Mine-independence at the wrong layer** (estate 1, testability 2). The board narrows rows in `deliveryMapping` by `MineMode` (`all|mine-and-unknown|mine`) before placement (`delivery-readings.ts:143,459-470`, `mine-mode.ts:12`); a domain test over `DeliveryMine` proves nothing. Amend: the header reads `deliveryMapping({...input, mode: 'all'})` as `releaseCardsOf` does (`:541,571`), with a board-level unit test across the `MineMode` values. Fix the heading that says mode `all` for `DeliveryMine`.
2. **Two decisions on the release button** (estate 2, testability 1). `ReleaseApprove` reads the passkey itself (`ReleaseApprove.tsx:16-24`), decides with `releaseCardApprovable` and renders its own reason (`:51`), while `releaseStatusLine` is meant to decide. Amend: lift the passkey reading into the Release group; `ReleaseApprove` takes state and reason from `releaseStatusLine`; drop `now` from its signature.
3. **Unread items count nowhere** (user 1). `placeDelivery` puts unreadable items in `unplaced` (`delivery-placement.ts:348,415-418,455-457,471-474`), so You, Work items and Fleet can read 0 on a failed reading. Amend: an amber "! N not read" clause per group from `unplaced`.
4. **Slice order and tests** (all three): slice 2 waits on slice 1; say where `ReleaseCard`/`SprintCard` sit between the slices; `release-approve.browser.test.ts:82` belongs to slice 1; add `sprint-exempt.browser.test.ts:168,174`, `delivery-link-icons.test.ts:9-10,86,106`, `release-plan-parts.test.ts:8` (imports `SEGMENT_CLASS`), `catalogue/states.ts:892,905`; name the slice that owns the header-agrees-with-plan-3 test and the wait between the plans.
5. **Smaller**: Machine meters need a form for a single budget pool; record the operator decision on several ready release PRs (lowest version takes the slot; the others as tuples in the status line; the slot moves on after approval).

## What the jurors looked at

Code opened for every reference; no board or test run.
