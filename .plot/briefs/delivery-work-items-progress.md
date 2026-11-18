## Implementation brief — delivery-work-items-show-gates (wave 3: Progress and waits)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-work-items-show-gates.md on main
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-work-items-progress` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is the third of four slices. It waits on `feature/delivery-work-items-gate-cells` (#3515), which has merged, and `-by-chips` waits on this slice. Touch the Progress column of Being built and the Waits on column of Queued, and nothing else.

### What to build

After #3512 and #3515, `workItemCells` (`packages/domain/src/rules/delivery-work-columns.ts`) fills the group column from `gatesCell` for At a gate. For Being built and Queued it still copies `row.status`, the shared single string of `itemRowCells`. That string is `null` for a `slice-being-built` row (`statusOf` returns `null` for that shape) and `waits on <slice>` for a `slice-queued` row. So the Progress column is empty today, and the Waits on column names only the earlier slice and never "no agent assigned" or another person's phase or approval.

This slice makes both columns carry one kind of value each:

1. **Progress cell** (`holds: 'progress'`). A row being built shows `no PR yet` where it has no open PR and `PR open` where it has one. Where the pulse reads unpushed commits it adds the count named as such: `2 unpushed`. Both parts go in one cell, for example `PR open · 2 unpushed`.
2. **Waits on cell** (`holds: 'wait'`). A queued row shows one of: `no agent assigned`; the earlier slice that `AgentRow.blockedBy` names, linked as `{ to: 'slice' }` (existing `waitsOn` fact); or, for another person's item, the phase or the approval and the person: `Draft · Max Albrecht`, `plan approval · Max Albrecht`. The name comes through `People`, as `plan-card-facts.ts` reads it. `ItemRowFacts.person` holds a handle today, so resolve the display name where the fact is built or add a field; do not resolve it in the component.
3. **Another plan's slice.** A wait on another plan's slice shows where the server names it in `blockedBy`. Where the server names no slice the cell reads `an earlier slice`.
4. **Facts.** `itemRowFactsOf` (`packages/board/src/app/lib/agent-rows/delivery-row-facts.ts`) feeds `ItemRowFacts`. Add the unpushed count there: it sets no count today, and `agentRowFactsOf` already reads `row.localAhead` into `facts.commits` for Fleet rows. Use the same reading, taken from the item's rows, and set it only where `localAhead > 0`.
5. **Callers.** Only the Work items group column takes the new cells. You and the other sections keep `status`, and At a gate keeps `gatesCell`. `ROW_COLUMNS` does not change.

The plan is canonical. This brief is orientation. Re-read the files before you edit, because the groups, gate-cells and fleet-agent-rows slices moved them this week:

- `packages/domain/src/rules/delivery-work-columns.ts`: `workItemCells`, `WORK_GROUP_COLUMN`, `GroupValueKind`.
- `packages/domain/src/rules/delivery-row-form.ts`: `ItemRowFacts`, `itemRowCells` and its `statusOf`, `rowShape`.
- `packages/domain/src/rules/delivery-placement.ts`: which items reach `queued` and `being-built`; read it, change no placement rule.
- `packages/board/src/app/lib/agent-rows/delivery-row-facts.ts` and `delivery-readings.ts` (`rowItem` sets `waitsOn` from `blockedBy`).
- `packages/board/src/contract/schema.ts`: `AgentRow.blockedBy` (near `:3198`) and `localAhead` (near `:2492`).

### The decisions the plan settles — do not re-derive them

**`localAhead` is an unpushed count, not a commit count.** It counts commits the machine holds that the remote does not, and it reads 0 for a pushed branch. A cell that said `3 commits` for a branch would be wrong for every pushed branch. Name it `N unpushed`. A count of a branch's own commits against the default branch has no reading today and stays out of this plan. `localAhead` is not part of row identity (`row-identity.ts`, near `:418`), so it stays out of any key.

**An absent count is not zero.** Where the pulse read no `localAhead`, the cell shows the PR state alone. Do not print `0 unpushed`. A test with the count absent and a test with it present catch a default of 0.

**`no PR yet` and `PR open` come from the PR, not from a stage word.** The item's own reading says whether an open PR exists (`openPr` in `delivery-row-facts.ts`, `hasOpenPr` in `delivery-readings.ts`). Do not infer it from `stage`.

**Queued holds no state of its own.** Plan 1's slice states count a Queued slice as being built. Queued here means a slice of an approved plan with a branch or claim and no live agent, and another person's Draft or Design plan or owed approval. Tickets leave Queued with plan 6, so add no ticket case.

**Waits on reads `blockedBy`, and the plan does not claim where the server derives it.** Whether the server reads the `<!-- waits: -->` marker for `blockedBy` is settled while building. Assert the cross-plan case in a unit test and do not add a client-side derivation from the marker.

**A slice that has not started is not a row here.** Plan 5's `feature/delivery-release-plan-rows` removes those rows through `isUnbegun`, and gives them Start. This slice does not remove them, so Start never disappears. A row with no branch and no agent is not your case; do not build a cell for it.

**Rules carried over unchanged from this estate:** absent is not false, and a fact nobody read yields a `null` cell, never a default word. A cell holds a value and never a sentence.

### Done when

The plan's `Done when` line for this slice is the specification: a row being built shows `no PR yet` where it has no PR, `PR open` where it has one, and the unpushed count named as unpushed where the pulse reads one; a queued row names what it waits on: `no agent assigned`, the earlier slice from `blockedBy`, or the phase or approval with the person who owes it, each asserted in a unit test.

The assertions that exist because a naive implementation passes without them:

- **Pushed branch shows no count.** `localAhead: 0` and `localAhead` absent both give `PR open` with no `unpushed` part. This catches `0 unpushed` and a count read as commits.
- **Both PR states.** A being-built row with no open PR reads `no PR yet`, and one with an open PR reads `PR open`. This catches a cell that always reads one.
- **Another person's item names the person.** A Draft plan of another person reads `Draft · <name>`, and an owed plan approval reads `plan approval · <name>`, with the name resolved through `People`. This catches a raw handle in the cell.
- **Cross-plan wait.** A `blockedBy` naming another plan's slice shows that slice. A queued row with no `blockedBy` and no agent reads `no agent assigned`; a wait with no named slice reads `an earlier slice`. Each case needs its own test, because one `default` branch collapses three outputs.
- **Other groups unchanged.** At a gate still shows both gate marks, and the You rows keep their `status` value.

Every progress value and waits-on value is a domain property with a unit test in `packages/domain/test/`. One browser test proves a Progress cell and a Waits on cell render; the decisions are asserted in the domain. Move any existing browser test that selects the old queued text to a unit test where it asserts a decision.

Plus: add a changeset (`.changeset/<name>.md`, package `@plot-pm/board`, description first, `bumps:` block last). Run `pnpm build:board` locally to test, and commit no bundle: `scripts/check-no-bundle-diff.sh` refuses one. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite and no `test:e2e`. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count. Functions you write are arrows. New code in the domain package follows the domain's rules: arrow functions, factual TSDoc, `Agent` for the actor and `Slice` for one branch.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the Progress and Waits on cells in `delivery-work-columns.ts` and `delivery-row-form.ts`, the unpushed-count and person-name facts in `delivery-row-facts.ts`, and the tests that select those cells.

In flight after it: `feature/delivery-work-items-by-chips` (the By cell; it waits on this slice and on plan 4's `feature/delivery-agent-roles`). Do not touch the By cell or the fixer attempt, and do not add a role chip. In the same two domain files, plan 5's `feature/delivery-release-plan-rows` gives Release delivery's plan rows their own column set; take no part in that change.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
