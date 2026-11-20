# Panel round 3 — every-delivery-section-folds

Round 3, 2026-11-20, on amendment b9795bcfa. Reconciliation: **unanimous `amend`** (estate, testability, user). No juror rejects. The operator approves on no reject (2026-11-20); the points below are the builder's.

Round 2: all findings resolved except three missing tests (estate).

## Builder notes, most important first

1. **Unread must not read clear** (estate 1, user 2). `placeDelivery` puts unreadable items and agents in `unplaced` with reason `unread` (`delivery-placement.ts:417,456,473`; `view.notPlaced`, `delivery-view.ts:629`). You, Work items and Fleet use the unread kind ("N not read") from `notPlaced` by subject, matching plan 4's header.
2. **The Tickets hidden count reads the wrong field** (all three). `ticketsSection`'s `hidden` is `fleet.waiting.hidden` (`AgentList.tsx:1797`), the server's "not assigned to you" count that *show all* reveals. Count Mine-hidden tickets as `ticketsForReader`'s input minus its output (`AgentList.tsx:864-866`) and keep `hidden` separate; unit cell: Mine off with `waiting.hidden = 3`.
3. **The hidden counts need a home** (testability 1, 3): a `sectionHiddenCounts` view function in `delivery-view.ts` with one unit test per section; `anchorOwner` needs a third parameter, the placement of `wholeReadings`, to answer `hidden: 'filter'`.
4. **"Hidden by the scope" never fires** (user 3): `wholeReadings` is built from scope-filtered rows (`AgentList.tsx:830-832,1172`); drop that reason or read an unscoped placement. `hiddenBySelection` (`chip-row.ts:105`) counts tab-wide, not per section.
5. **Tests**: add `mine-filter.browser.test.ts:114`, `row-withholds.browser.test.ts:275,654` to the re-read list.
6. **Smaller**: the You "3 hidden by Mine" example cannot occur today (`delivery-readings.ts:445-446` keeps every You item); rename `EXTRA_SECTION_KEYS` so plan 7's group keys fit.
