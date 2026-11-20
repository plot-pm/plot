# Panel round 3 — delivery-rows-act-from-one-place

Round 3, 2026-11-20, on amendment b9795bcfa. Reconciliation: **divided** — `proceed` (estate), `amend` (testability, user). No juror rejects. The operator approves on no reject (2026-11-20).

## The disagreement

The estate lens found every code claim holding and its round-2 findings resolved, and judged the remaining points builder detail. The testability and user lenses found places where a test would have no expected value or a control would land wrong, and want them in the plan text. They agree on the facts; they differ on whether these belong in the plan or with the builder. With approval given, they go to the builder as the first items of the matching slices.

## Builder notes, most important first

1. **Release delivery slice lines have no branch** (user 1). `PlanSliceFact` and `PlanLine` carry no branch (`release-plan-rows.ts:34-50,117-132`), so the PR+branch tuple cannot be built; `StartWorkButton` posts no branch (`StartWorkButton.tsx:342`) although `/api/dispatch` takes one (`dispatch.ts:377`). Add `branch` to both types and post it.
2. **The verb link has two targets** (testability 2): `action` → `{ kind: 'act' }` runs an action (`delivery-link-targets.ts:13,76`) while the plan says it opens the menu. Pick one, e.g. a new `{ kind: 'menu', id }`, and name the `loose` action (today `create-plan`, `delivery-row-form.ts:228`).
3. **Item sets for the other 11 You reasons** (testability 3): map each `YouReason` (`delivery-placement.ts:211-224`) to its row kind's item set, with unit tests.
4. **Mine-rule inputs** (estate 1, 2): `ticketsForReader` needs the Planning cards for plan owners (`DeliveryMapInput` has none, `delivery-readings.ts:55`); the agent arm never answers `theirs` (`ownership.ts:287-288`), so test the real change by name and give `agentsForReader` (`mine-filter.ts:236`) the rows.
5. **Text and tests**: line 94 still states the old grouping rule (line 87 is right); the grouped Unblock consequence is the age range only (the object already counts); the group label "Clean up" (`delivery-view.ts:69`, browser `:148,:184`) becomes "Unblock"; loose browser tests `:62,:86` assert absence and need rewriting; `LINE_STATE` is at `ReleasePlanParts.tsx:26`; the You exception is at `delivery-readings.ts:462-465`.
