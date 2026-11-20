## Implementation brief — delivery-rows-act-from-one-place (wave 1: Mine rule)

- **Plan (canonical):** `docs/plans/2026-11-20-delivery-rows-act-from-one-place.md` on `main`
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3583 merged
- **Branch:** `feature/mine-means-mine-or-my-plan` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention (`Review: pr`)

The plan's first slice, in the sprint "Delivery UI Polish". It waits on nothing. Five slices wait on it: this plan's You rows, Work items grid and Fleet switches slices, `feature/folded-sections-summarise-visually` and `feature/tickets-show-what-the-sprint-delivers-and-found`. It changes no view and no section; those plans read its output.

### What to build

Today the lenient Mine mode reads one ownership arm per row, so a row shows or hides on the wrong fact. `ownedFromRow` gives a row with a PR the PR author's ownership and ignores the plan (`mine-filter.ts:141-146`). `agentsForReader` reads only the agent's `identity` and `state` (`mine-filter.ts:155,236-244`). `ticketsForReader` reads only the ticket's assignees (`mine-filter.ts:279`). `mineAllows` reads only a ticket's own ownership (`delivery-placement.ts:302-304`). The operator decision (2026-11-20, spec decision 4) is "assigned to me or my plan": a row of another person's PR on a plan of the reader stays; a row of the reader on another person's plan stays; a row of unknown owner on a plan of unknown owner stays.

Build one domain rule beside `ownership` (`packages/domain/src/rules/ownership.ts:298`): `mineOwnership(arms)`. It answers `mine` where any arm answers `mine`, `theirs` where no arm answers `mine` and one answers `theirs`, and `unknown` otherwise. The arms are the row's own (PR author, agent, ticket assignees) and the plan's (`ownership` with kind `plan` over the plan's assignee, author and approver). Then apply it in four places, in the lenient mode only (`MineMode` `mine-and-unknown`, `DeliveryMine` `mine`), keeping a row where `mineOwnership` is not `theirs`:

- `rowsForReader` (`mine-filter.ts:200`) and `deliveryMapping`'s `keeps` (`delivery-readings.ts:465-469`) read the PR arm and the plan arm of a row. A row already carries `assignee`, `author` and `approver` of its plan (`AgentRow`), so no new wire field is needed.
- `agentsForReader` reads the agent arm and the plan of the row that the agent's `branch` joins. `AgentList.tsx:644` already holds `rowByBranch`; pass the join in rather than reading the payload a second time.
- `ticketsForReader` reads the assignees and the plans whose `Issue:` names the ticket: the fleet payload's `plans` (`schema.ts:4830-4833`, `{ file, issues }`), each resolved to its card owner through `cardForPlanFile` (`AgentList.tsx:1187`).
- The ticket reading's `ownership` (`ticketItem`, `delivery-readings.ts:305-310`) is the same combined answer, so `mineAllows` needs no change of its own.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

- **The strict mode keeps today's rule in every place.** `MineMode` `mine` and `DeliveryMine` `strict` stay on `isMineStrict` (`ownership.ts:326`) over today's single arm, and on the You exception of `deliveryMapping` (`delivery-readings.ts:445-446`). Do not feed the combined answer to strict: it would hide rows the strict mode shows today and show rows it hides today.
- **`ticketsForReader` keeps its lenient answer in the strict mode.** Its TSDoc records "`mine` mode does not sharpen it" (the panel's "the box wins"). Leave that sentence true. Plan 7's two new scope groups read `isMineStrict` in the strict mode; that is plan 7's work, not this slice's.
- **The branch name is never an owner arm.** `ownedFromRow`'s TSDoc says why: `feature/jw-something` looks like a claim of ownership and is not one. Do not add a guess from the name.
- **Absent is not false.** A field that is `''` or `undefined` (an older server's payload) names no owner. It contributes `unknown`, never `theirs`. An empty arm list answers `unknown`.
- **A plan that names nobody gives `unknown`, not `theirs`.** Without this a PR of another person on an unowned plan reads `theirs` (correct), and a row of unknown owner on an unowned plan reads `unknown` (kept). Test both.
- **`mineOwnership` is a new arrow in the domain package.** Factual TSDoc, no history. A function you rewrite in `mine-filter.ts` or `delivery-readings.ts` is an arrow too; a function you only pass through stays as it is.
- **No view change.** No section, count or label changes here. If a view test fails after this slice, the rule leaked into a component; fix the rule.

### Done when

The plan's `## Slices` line for this branch is the specification: `mineOwnership`, the lenient mode over the row's arm and its plan's arm in `rowsForReader`, `deliveryMapping`, `agentsForReader`, `ticketsForReader` and the ticket reading that `mineAllows` reads, the strict mode unchanged, and unit tests for every `MineMode` and `DeliveryMine` cell of each filter. Assertions that exist because a naive implementation would pass without them:

- `mineOwnership` per combination of two arms (`mine`/`theirs`/`unknown` × the same) in `packages/domain/test/ownership.test.ts`. Catches an `or` that lets `theirs` beat `mine`.
- For each of `rowsForReader`, `deliveryMapping`, `agentsForReader`, `ticketsForReader` and `mineAllows`, every `MineMode` value (and its `DeliveryMine` word through `MINE`, `delivery-readings.ts:143`) over three cases: a PR or agent of another person on a plan of the reader, a row of the reader on a plan of another person, and a row of unknown owner on a plan of unknown owner. Files: `packages/domain/test/ownership.test.ts`, `packages/domain/test/delivery-placement.test.ts`, `packages/board/test/unit/mine-filter.test.ts`. Catches a rule wired into three of the four places, and a strict mode that moved.
- A `mode: 'all'` case that asserts `rowsForReader`, `agentsForReader` and `ticketsForReader` still return the array itself (identity), because `rowsBySection` memoises on it.
- A ticket whose `Issue:` plan is the reader's, assigned to another person, stays in the lenient mode. Catches a ticket reading that still looks at assignees alone.

Plus: run `pnpm build:board` locally to test, and commit no bundle (`scripts/check-no-bundle-diff.sh` refuses one). Add a changeset for `@plot-pm/board` with the description first and the `bumps:` block last (`./scripts/check-changeset-packages.sh`). Before each push, commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite and no `test:e2e`. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count.

If this slice changes a browser test, record the delta in `packages/board/test/integration/stubbed-tests-start-no-board.test.ts` (`EXPECTED_FILES = 99`, `EXPECTED_TESTS = 719`). A rule change is expected to need none.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/ownership.ts`, `packages/domain/src/rules/delivery-placement.ts` (`mineAllows` only, and only if the ticket reading makes it unnecessary to touch), `packages/board/src/app/lib/agent-rows/mine-filter.ts`, `packages/board/src/app/lib/agent-rows/delivery-readings.ts` (`deliveryMapping`, `ticketItem`), the call sites of the three filters in `packages/board/src/app/components/AgentList.tsx` (`:644` and `:865`, argument changes only), and the three test files named above.

It does not touch `collapse.ts`, `delivery-view.ts`, `menus.tsx`, `rows.tsx` or any component's markup: the sibling slices of the sprint own those. `feature/delivery-tuple-vocabulary` is in flight on `origin` (plan 1); at the start, run `git diff origin/main...origin/feature/delivery-tuple-vocabulary --stat` and name any shared file before editing it. `AgentList.tsx` is the likeliest collision; keep your edit to the call-site arguments.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
