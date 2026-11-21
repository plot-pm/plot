# A delivered docs plan counts as finished

> A sprint or release member that the pulse leaves out because it is a delivered docs or infra plan counts as delivered on the sprint, release and person cards, and no longer reads as a missing merge reading.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #3640
- **Review:** pr
- **Impl:** own branches

## Changelog

- The sprint card, the release cards and the release person cards count a delivered docs or infra plan as delivered, so a sprint that holds one shows its bar and tier progress instead of "The merge reading for this sprint is missing."

<!-- Board impact: the `/api/fleet` payload's `plans` entries gain three optional fields (`phase`, `type`, `slices`). No change to the plan format, the template, the helper scripts or the docs/plans layout. -->

## Motivation

The Delivery tab shows "The merge reading for this sprint is missing." and "The merge reading for this release is missing." for sprint `delivery-ui-polish` (2026-W47). Every sprint that holds a delivered docs or infra plan shows the defect.

- **The walk drops the plan on purpose.** `planWalkAssembler.add` returns no entry for a Delivered plan of `Type: docs` or `Type: infra` (`packages/domain/src/workflows/plan-walk-assembly.ts:301`, added in `cbcf7bb5a`, 2026-10-01). The JSDoc at `:218` states it and `packages/domain/test/plan-walk-assembly.test.ts:244` pins it. `/plot-release` never records Released for such a plan (`packages/domain/src/workflows/release.ts:296`, reason `docs-live-on-merge`), so without the omission the plan would stay on the board for ever. This plan keeps that behaviour.
- **The consumers read the omission as an unread answer.** `countedSlicesByPlan` (`packages/board/src/app/lib/agent-rows/delivery-readings.ts:522-539`) gives an entry only to a plan with a row, a Draft card or a slice item. Its copy in `packages/board/src/app/lib/agent-rows/delivery-view.ts:912-926` does the same for the release person cards. A plan the walk dropped has none of the three, so it gets no entry.
- **No entry means "missing".** `countSliceStatesOver` answers `undefined` where any named plan has no entry (`packages/domain/src/rules/slice-states.ts:148-149`). `sprintBarOf` then answers `bar: null, readingMissing: true` (`packages/domain/src/rules/sprint-card.ts:118-135`), `sprintCards` draws no tier progress (`:162`), and `releaseCards` shows `RELEASE_READING_MISSING` for the targeted card (`packages/domain/src/rules/release-card.ts:138-149`) and for the carried card (`:162-173`). `releasePersonCards` reads `sprintBarOf` too (`packages/domain/src/rules/release-person-cards.ts:67`).
- **Measured 2026-11-21.** `templates-show-named-identifiers` (`Type: docs`, `State: Delivered`, delivered by the fleet at 09:08) is the only one of the sprint's 8 members with no row. `plot-fleet-scan.sh templates-show-named-identifiers` prints "No plans found". With `Type: feature` in a throwaway clone, the scan carries the plan and its merged slice.
- **The rule has two copies and no name.** The type test `type === 'docs' || type === 'infra'` appears at `plan-walk-assembly.ts:301` and at `release.ts:296`. The board cannot ask the walk's question without a third copy.
- **The client does not hold the facts it needs.** The `/api/fleet` payload's `plans` entry carries `file` and `issues` only (`packages/board/src/contract/schema.ts:4876-4879`, filled at `packages/board/src/server/fleet.ts:1883`). The server's `planMetas` already carry `phase`, `type` and `slices` (`PlanMetaSchema`, `schema.ts:68-110`).

## Design

### Approach

- **One named rule for the omission.** `packages/domain/src/rules/pulse-omits-plan.ts` exports `liveOnMerge(type)`, true for `docs` and `infra` in any letter case, and `pulseOmitsPlan(phase, type)`, true where `planIsFinished(phase)` holds (`packages/domain/src/rules/plan-names-branch.ts:21`) or where the phase is `delivered` and `liveOnMerge(type)` holds. `planWalkAssembler.add` replaces its two tests at `plan-walk-assembly.ts:300-301` with one call to `pulseOmitsPlan`. `release.ts:296` calls `liveOnMerge`. The walk's output does not change.
- **One domain function seeds the counted slices.** `packages/domain/src/rules/counted-slices.ts` exports `countedSlicesByPlan({ seen, slices, plans })`. `seen` is the plan keys the payload read a row, a Draft card or a pulse slice for; each gets an entry, `[]` where it holds no counted slice. `slices` is the counted slices as `{ plan, id, merge }`; each is appended to its plan's entry. `plans` is the plan facts `{ plan, phase, type, sliceIds }`; a plan that has no entry yet and for which `pulseOmitsPlan(phase, type)` holds with a `delivered` phase gets one `{ id, merge: 'merged' }` per id in `sliceIds`. A plan with an entry keeps it, because the payload's own reading is closer to the merge than the plan file. Every other plan gets no entry, as today, so an unread plan still reads missing. Both board copies call this function: `delivery-readings.ts:522` builds `seen` from rows and drafts and `slices` from the slice items; `delivery-view.ts:912-926` builds `seen` from rows, drafts and pulse slices and `slices` from `counted`. The board keeps no seeding loop of its own.
- **Decision: the member counts as delivered, not skipped.** The other option is to skip the member as `known: false` members are skipped (`sprint-card.ts:125`). That option fixes the bar but scores the member `withdrawn` in tier progress (`sprint-card.ts:170`), so a delivered Must reads as not done in "Must N/M". Counting it delivered matches the truth: the delivery gate passed every non-deferred slice of the plan, and the plan is finished. A merged slice counts as `delivered` with no work item (`slice-states.ts:66`), so `countSliceStates` needs no change, and `planDelivered` (`sprint-card.ts:91`) answers true from the seeded slices.
- **Decision: the release cards count the member as the sprint card does.** The merged code ships in the release tag, although `/plot-release` marks the plan not Released. One counting path for the sprint, release and person cards keeps the three bars equal for one sprint, which `packages/board/test/unit/delivery-view.test.ts:170` already asserts for the sprint and person cards. `[question-release-counts-docs]` keeps the other option open for a person.
- **A plan with no counted slice.** A delivered plan whose file lists no non-deferred slice (`Impl: none`, or every branch deferred) gets one id, `sliceItemId(plan, '')`, so it scores delivered and adds one delivered slice. Without it, `planDelivered([])` answers false (`sprint-card.ts:91-92`) and the member reads not done.
- **The payload carries readings, not a verdict.** `fleetPlanIndexOf` (`packages/board/src/server/fleet.ts:1872-1886`) adds `phase`, `type` and `slices` (the names of the slices that hold at least one non-deferred branch, in document order) to each `plans` entry from `meta`. `schema.ts:4876` adds the three fields as optional, so a client talking to an older server still validates, and an absent field reads as "not omitted", which keeps today's behaviour. The client maps each entry to `{ plan: slug, phase, type, sliceIds: slices.map((s) => sliceItemId(slug, s)) }` and the domain decides. `AgentList.tsx:1242` and `:1249` pass `fleet.plans` through `DeliveryMapInput`; `placeMapping` passes it to `deliveryView`.

**Tests, slice `bug/the-pulse-omission-is-one-domain-rule`:**

- `packages/domain/test/pulse-omits-plan.test.ts`: `released`, `superseded` and `rejected` omit for every type; `delivered` with `docs`, `infra` and `Docs` omits; `delivered` with `feature`, `bug` and `''` does not; `approved` with `docs` does not; `liveOnMerge` answers true for `docs` and `infra` only.
- `packages/domain/test/counted-slices.test.ts`: the three cases now in `packages/board/test/unit/sprint-card-slices.test.ts:8,18,30` (slice items grouped by plan with delivered read as merged; a Draft plan and a row-only plan get `[]`; a plan with no slice item gets no entry); a delivered docs plan with no other entry gets one merged slice per slice id; a delivered infra plan with a pulse entry keeps the pulse's slices; a delivered feature plan with no other entry gets no entry; an approved docs plan with no other entry gets no entry; a delivered docs plan with no slice id gets one merged slice.
- `packages/domain/test/plan-walk-assembly.test.ts:244` and `packages/domain/test/workflows-release.test.ts` (`docs-live-on-merge`) stay green unchanged.
- `packages/board/test/unit/sprint-card-slices.test.ts` and `packages/board/test/unit/delivery-view.test.ts` stay green with the board copies replaced: the slice changes no rendered state.

**Tests, slice `bug/a-delivered-docs-member-counts-as-finished`:**

- `packages/domain/test/sprint-card.test.ts`: a sprint whose Must member is a delivered docs plan, seeded through `countedSlicesByPlan`, draws a bar with that plan's slices as delivered, `readingMissing: false`, and "Must 1/1".
- `packages/domain/test/release-card.test.ts`: the targeted card and the carried card for such a sprint draw a bar and no `RELEASE_READING_MISSING`.
- `packages/domain/test/release-person-cards.test.ts`: the person card's bar equals the sprint card's bar for the same sprint.
- `packages/board/test/unit/sprint-card-slices.test.ts`: `sprintCardViewOf` and `releaseCardsOf` with a `plans` entry `{ phase: 'delivered', type: 'docs', slices: ['Docs'] }` and no row draw a bar; the same entry without `phase` and `type` still reads missing.
- `packages/board/test/unit/delivery-view.test.ts`: the person card for that sprint draws the same bar as the sprint card.
- `packages/board/test/unit/every-fleet-plan-has-an-index-entry.test.ts`: each `plans` entry carries the meta's `phase`, `type` and non-deferred slice names.

### Open Questions

- [ ] `[question-release-counts-docs]` Should the release cards count a delivered docs or infra plan at all? This plan counts it as delivered, because its merged code ships in the release tag. The other option leaves it out of the release bar, because `/plot-release` never marks it Released (`release.ts:296`); that needs a second set beside `slicesByPlan` and makes the release bar differ from the sprint bar for one sprint.

## Slices

### Rule

- `bug/the-pulse-omission-is-one-domain-rule` — `pulseOmitsPlan` and `liveOnMerge` in `rules/pulse-omits-plan.ts`, called from `plan-walk-assembly.ts:300-301` and `release.ts:296`, and `countedSlicesByPlan` in `rules/counted-slices.ts` replacing the two board seeding loops with no change to any rendered state, with the unit tests <!-- builds: pulseOmitsPlan and countedSlicesByPlan, the pulse omission rule and the domain's slice seeding -->

### Counting

- `bug/a-delivered-docs-member-counts-as-finished` — `phase`, `type` and `slices` on the `/api/fleet` `plans` entries, passed through `DeliveryMapInput` to `countedSlicesByPlan`, so the sprint, release and person cards count a delivered docs or infra member as delivered, with the unit tests <!-- builds: the plan facts on the fleet payload's plans index --> <!-- waits: bug/the-pulse-omission-is-one-domain-rule -->

## Notes

- **Deliverable search, 2026-11-21.** `plot-deliverable-search.sh "pulseOmitsPlan"` found no rule of that name; its hits are unrelated uses of "pulse" and "omits". `"countedSlicesByPlan"` found only the board function at `delivery-readings.ts:522` and its callers at `:559` and `:595`, and the comment at `delivery-view.ts:912`. `"slicesByPlan seeding"` found the copy at `delivery-view.ts:916-925` and 17 domain lines that read `slicesByPlan` and seed nothing. `"live on merge"` found only reconcile section headings. No existing domain function seeds the counted slices.
- **The issue's claims hold on `origin/main` at `8a24d99f1`.** The line numbers match except `release-card.ts`: the targeted card's count is at `:138` and its bar at `:148`, and the carried card's count is at `:162` and its bar at `:173`.
- **One premise of the triage does not hold.** The `/api/fleet` payload's `plans` entries carry `file` and `issues` only, not `phase` and `type` (`schema.ts:4876-4879`). The second slice adds them.
- **Out of scope.** The walk keeps dropping the plan (`cbcf7bb5a`). `plot-fleet-scan.sh` keeps printing "No plans found" for such a slug; the shell has no copy of the docs or infra test, so no corpus pair is needed.
