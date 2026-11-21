## Implementation brief — board-readings-take-the-domain-answer (wave 2: Plan state)

- **Plan (canonical):** `docs/plans/2026-11-21-board-readings-take-the-domain-answer.md` on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3613 merged
- **Branch:** `bug/a-delivery-row-carries-its-plan-state` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention (`Review: pr`)

Wave 2 of 8. Wave 1 (`bug/an-approval-with-no-pr-writes-no-pr-key`) is independent and touches no file here. The `Spike card` wave waits on this one by heading order only; it reads nothing this branch builds.

### What to build

The Delivery tab decides a plan's lifecycle state from a column name. The server fills `AgentRow.phase` with a column name (`phaseOfPlan(...)` at `packages/board/src/server/fleet.ts:7613` for a slice row, `:8004` for an `idea/` row). The client maps the name back to a state through `PHASE_OF` (`packages/board/src/app/lib/agent-rows/delivery-readings.ts:148-157`) and feeds the placement rule as `WorkItemReading.phase` (`:258-262`). Two observed failures:

- `phaseOfPlan` puts a tracer plan in the column that holds `design` in every state except `released` (`rules/workflow-phases.ts:149-152`). An approved tracer plan's slices read as `design` and land under You › Input to the fleet instead of Work items.
- Under a custom `Workflow phases` map every `PHASE_OF` lookup misses and `phase` is unset. An `idea/` PR row lands in Work items, and a plan in its delivered column does not count as delivered (`:262`).

The fix: `AgentRow` carries the state itself. Add `planState: PlanStateSchema.nullable().default(null)` beside `phase` (`packages/board/src/contract/schema.ts:2786`; `PlanStateSchema` is `packages/domain/src/entities/card-facts.ts:39`). `phase` keeps its column-name meaning for the column cell. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive

- **The server uses the existing domain parse `planStateOf`** (`packages/domain/src/entities/plan.ts:101`), which answers `none` for an unread word; `none` becomes `null`. A slice row (`fleet.ts:7613`) takes `planStateOf(plan.phase)`. An `idea/` row (`:8004`) takes `'draft'`. No lowercase-and-match stays in `fleet.ts`. Rejected: a second client-side table or a lowercase compare, because that is the defect. The tracer and deliverable column rules of `phaseOfPlan` do NOT apply to `planState` — that is the point of the field.
- **`delivery-readings.ts` reads `first.planState` and drops `PHASE_OF` and `phaseOf`** (`:148-157`). `rejected` and `superseded` leave `WorkItemReading.phase` unset, as an unknown column does today. A row from an older server reads as `null` (the schema default).
- **Expected movement under the default map: one kind of row.** An approved tracer plan's slices go from You › Input to the fleet to Work items. A draft row reads `draft` in place of `design`; `delivery-placement.ts:321` places both the same. Any other movement is a bug in your change.
- **Fixtures.** Every `AgentRow` literal or factory that sets `phase` to a column name also sets `planState`. Run `git grep -n "phase: '\(Discovery\|Design\|Development\|Testing\|Released\)'" -- packages/board` and settle each hit: an `AgentRow` gains `planState`; a `PlanMeta` or `CardFacts` fixture, which carries a lifecycle word, is left alone. Known sites: `packages/board/test/catalogue/states.ts` (45 rows), `test/integration/agents-tab.browser.test.ts` (16), `test/unit/tuple-row.test.ts` (12), `test/integration/plan-row-shows-plan-status-only.browser.test.ts` (11), `test/unit/schema.test.ts` (10), `test/unit/delivery-view.test.ts` (9), `packages/board/src/server/mock-fleet.ts:81,93,108,118`. Where a file builds rows through one factory, set it once there. Do not convert neighbouring `function` declarations to arrows; a function you write is an arrow, one you pass through stays.
- **Rule carried over:** absent is not false. A row with `planState: null` leaves the phase unset; it must not default to `design`.

### Done when

The plan's slice line is the specification: `AgentRow.planState` from `planStateOf`, filled at `fleet.ts:7613` and `:8004`; `delivery-readings.ts` drops `PHASE_OF`; every row fixture and `mock-fleet.ts` row carries `planState`; the six phase-word tests restated; tracer and custom-map tests; two browser tests that a blocker mark and an `← agents:` link open a closed group.

Tests the plan names, and what each catches:

- The six `PHASE_OF` tests in `describe('deliveryMapping phase words')` (`packages/board/test/unit/delivery-readings.test.ts:130-165`) restated over `planState`: one per state, plus a row with `planState: null` that leaves the phase unset. Catches a default-to-`design` fallback.
- New in `delivery-readings.test.ts`: an approved tracer plan's slice row (`phase: 'Design'`, `planState: 'approved'`) places under Work items (fails on main); an `idea/` PR row under a custom map (`phase: 'Ideas'`, `planState: 'draft'`) places under You; a row of a delivered plan under a custom map counts as delivered. These pass only if the placement reads the state and not the column.
- In `packages/board/test/unit/fleet.test.ts`: the tracer cell at `:5153-5192` also asserts `planState: 'approved'`; one cell under a custom `Workflow phases` map asserts the state while `phase` reads the custom column; one cell for a plan whose `phase` is no lifecycle word asserts `null`.
- **M2, two browser cases** in `packages/board/test/integration/delivery-tab-sections.browser.test.ts`: fold the group that holds a blocking slice (Queued), click its `[data-slice-blocked-by]` mark, expect the group toggle `aria-expanded="true"` and the target row in the viewport; then the same for an `← agents:` link (`linkLine`, `packages/board/src/app/components/AgentList.tsx:1395`) whose target sits in a folded group. `d452cb9d5` (2026-11-20) already routes both through one jump, so they may pass on first run; where a case fails on main, this slice fixes the jump. The nearest existing test, *"leaves a delivered blocker without a row"* (`agents-tab.browser.test.ts:1165`), covers a blocker in a folded Done section only. Raise `EXPECTED_TESTS` in `packages/board/test/integration/stubbed-tests-start-no-board.test.ts` by 2, with a dated reason line.

Plus: run `pnpm build:board` locally to test and commit NO bundle — `scripts/check-no-bundle-diff.sh` refuses one. Add a changeset (`@plot-pm/board`, description first, `bumps:` block last; optional `plan:` line after the description). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in `CI suites` run in CI and a failure there comes back as a correction. Do not run `test:e2e`. No `.sh` file is in scope; if one becomes so, `scripts/check-shell-lines.sh` refuses shell growth, so remove shell elsewhere or write the rule in the domain.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. Then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/board/src/contract/schema.ts`, `packages/board/src/server/fleet.ts` (the two `phaseOfPlan` fill sites), `packages/board/src/server/mock-fleet.ts`, `packages/board/src/app/lib/agent-rows/delivery-readings.ts`, the board fixtures and tests listed above, and the changeset.

In flight elsewhere: `bug/an-approval-with-no-pr-writes-no-pr-key` (domain `sprint-annotation.ts`, `rendering.ts`, `entry/approve.ts` — no overlap). The Delivery UI Polish plans (*delivery-rows-act-from-one-place*, *every-delivery-section-folds*, *folded-sections-summarise-visually*, *delivery-tab-has-one-header*) cite `delivery-readings.ts` near `:143`, `:305-310`, `:445-471`, `:571`; none changes `AgentRow.phase` or `PHASE_OF`. Branches `feature/delivery-tab-has-one-header` and `feature/delivery-row-menu-column` do not touch the file. Whichever lands second rebases. On a `board-server.mjs` conflict, restore the generated path from the merge base; do not commit a rebuild.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
