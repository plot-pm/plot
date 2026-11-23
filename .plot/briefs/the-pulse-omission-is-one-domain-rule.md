## Implementation brief — a-delivered-docs-plan-counts-as-finished (wave 1: Rule)

- **Plan (canonical):** docs/plans/2026-11-21-a-delivered-docs-plan-counts-as-finished.md on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3641 merged
- **Branch:** `bug/the-pulse-omission-is-one-domain-rule` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (`Review: pr`)

This wave builds the rule and moves two existing board loops onto it with no change to any rendered state. Wave 2, `bug/a-delivered-docs-member-counts-as-finished`, waits on it and adds the payload facts that make the cards change.

### What to build

Issue #3640: the Delivery tab shows "The merge reading for this sprint is missing." for sprint `delivery-ui-polish` (2026-W47), because `templates-show-named-identifiers` (`Type: docs`, Delivered) is the only one of 8 members with no counted-slice entry. The walk drops a delivered docs or infra plan on purpose (`plan-walk-assembly.ts:301`), and the board reads the missing entry as an unread answer. This wave gives the rule one name and the seeding one domain function. It does not fix the symptom: the symptom needs wave 2's payload facts.

1. `packages/domain/src/rules/pulse-omits-plan.ts` exports `liveOnMerge(type)` (true for exactly `docs` and `infra`) and `pulseOmitsPlan(phase, type)` (true where `planIsFinished(phase)` holds, or where the phase is `delivered` and `liveOnMerge(type)` holds). `planWalkAssembler.add` replaces its two tests at `plan-walk-assembly.ts:300-301` with one call to `pulseOmitsPlan`. `release.ts:296` calls `liveOnMerge`.
2. `packages/domain/src/rules/counted-slices.ts` exports `countedSlicesByPlan({ seen, slices, plans })`. `seen` is the plan keys that get an entry (`[]` where no counted slice). `slices` is `{ plan, id, merge }`, appended per plan. `plans` is `{ plan, phase, type, sliceIds, planId }`. A plan whose phase is `delivered`, for which `pulseOmitsPlan` holds, and whose entry is absent or `[]` gets one `{ id, merge: 'merged' }` per `sliceIds` id, or `[{ id: planId, merge: 'merged' }]` where `sliceIds` is empty. A non-empty entry stays as it is. Every other plan keeps what it has.
3. The board's `countedSlicesByPlan(items, input)` in `delivery-readings.ts:522` keeps its signature and becomes a thin wrapper that builds `seen` and `slices` from `items`, `input.rows` and `input.drafts` and calls the domain function. `input.plans` does not exist yet in this wave: the wrapper reads it as optional and empty, so the seeding never fires from the board until wave 2. The person cards' copy at `delivery-view.ts:916-926` calls the domain function directly.

### Decisions the plan settles — do not re-derive them

- **Count the member as delivered, do not skip it.** Skipping it as `known: false` fixes the bar but scores the member `withdrawn` in tier progress (`sprint-card.ts:171`), so a delivered Must reads as not done in "Must N/M". A merged slice counts as `delivered` with no work item (`slice-states.ts:66`), so `countSliceStates` needs no change.
- **The walk keeps dropping the plan.** `/plot-release` never records Released for it (`release.ts:296`, `docs-live-on-merge`); without the omission the plan stays on the board for ever. `plan-walk-assembly.test.ts:244` and `workflows-release.test.ts:366` stay green unchanged. If one goes red, the rule is wrong.
- **The type comparison stays exact.** `type === 'docs' || type === 'infra'`, no case folding: `Docs` and `''` do not match. `norm_type` in `plot-plan-meta.sh:513` already lowercases. Changing the comparison changes the walk's output and the release's `notMarked` list.
- **The domain owns the no-slice rule; the client owns the id.** `sliceItemId` and `sliceKeyOf` are board code, so the domain cannot build a `slice:` id. The wrapper passes `planId: sliceItemId(slug, '')` as a value.
- **The merge word stays a board derivation.** `delivery-view.ts:924` reads `s.merge`, `s.complete` and the item's `delivered`; `delivery-readings.ts:534` reads `item.delivered`. Both pass precomputed `{ plan, id, merge }` to the domain. Neither derivation moves into the domain.
- **An empty entry is seeded too.** A row with `wave: ''` maps to a `branch:` item, not a slice item (`rowInSlice`, `delivery-readings.ts:167`), so a delivered docs plan with such a row holds `[]`, and `planDelivered([])` answers false (`sprint-card.ts:92-93`).
- **A Draft plan never matches the seeding condition**, so a Draft card's `[]` stays `[]`.
- **The untargeted release card is not changed.** `carried.approved` holds only plans with a pulse slice, so it never asks for the omitted plan's entry. No test claims a fix there.
- **Carried-over rules:** absent is not false — an unread plan keeps no entry and still reads missing; the payload's own non-empty reading beats the plan file.

### Done when

The plan's `## Done when` list is the specification, given as the test lists of slice 1:

- `packages/domain/test/pulse-omits-plan.test.ts`: `released`, `superseded`, `rejected` omit for every type; `delivered` with `docs` and `infra` omits; `delivered` with `feature`, `bug`, `Docs` and `''` does not; `approved` with `docs` does not; `liveOnMerge` is true for `docs` and `infra` only. The `Docs` and `''` rows catch a case-folding or truthiness shortcut.
- `packages/domain/test/counted-slices.test.ts`: the nine cases the plan lists. The `[]`-entry case catches a seeding that checks only for an absent key; the "pulse entry kept" case catches a seeding that overwrites; the empty-`sliceIds` case catches a seeding that yields nothing.
- `packages/board/test/unit/sprint-card-slices.test.ts` and `delivery-view.test.ts` stay green with no edit to their expectations. A changed expectation means a rendered state changed, which this wave must not do.

Plus: domain code uses arrow functions and factual TSDoc only (no decision history in comments; that goes in the commit message). Add a changeset (package `plot` or `@plot-pm/board`, description first, `bumps:` block last; `./scripts/check-changeset-packages.sh`). Do not commit a rebuilt board bundle. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. The slice touches no `.sh` file, so `check-shell-lines.sh` does not bind it.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/pulse-omits-plan.ts`, `counted-slices.ts`, their tests, the two call sites in `plan-walk-assembly.ts` and `release.ts`, and the two board loops in `delivery-readings.ts:522-538` and `delivery-view.ts:912-926`. It does not touch `schema.ts`, `fleet.ts`, `AgentList.tsx` or `DeliveryMapInput` consumers: those belong to wave 2. PR #3630 (`feature/delivery-header-release-group`) adds `releaseGroupOf` as a third caller of the board wrapper; the kept signature keeps it working, and whichever lands second rebases. PR #3629, PR #3618 and the plan `board-readings-take-the-domain-answer` touch other lines of the same files.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
