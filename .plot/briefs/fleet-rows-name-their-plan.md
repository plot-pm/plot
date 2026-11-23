## Implementation brief — delivery-sections-count-alike (wave 3: Fleet rows)

- **Plan (canonical):** `docs/plans/2026-11-22-delivery-sections-count-alike.md` on `main`
- **Approved:** 2026-11-22, Jan Wloka, plan-PR #3656 merged
- **Branch:** `feature/fleet-rows-name-their-plan` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention (`Review: pr`)

Wave 3 of 3, sprint "Delivery UI Polish". Its wait, `feature/fleet-switches-in-fleet-section`, merged as #3673. It does not wait on waves 1 (`feature/delivery-header-counts-every-state`, #3662) or 2 (`feature/a-held-slice-names-its-hold`, #3675). Both touch `delivery-view.ts` and the header code; rebase on `origin/main` before the first push and again before opening the PR.

### What to build

On 2026-11-22 the Fleet section read "5 working" while only 1 of the 5 acted on a sprint slice. In the same reading, 28 of 29 `/api/fleet` agent entries were synthesized desks with `branch: ""` and the branch in `checkout`. `branch` stays empty for such a desk by design (#1101). The placement reads `agent.branch` alone (`mapReadings` in `delivery-readings.ts`: `actsOn: agent.branch === '' ? null : …`), so a desk agent acts on nothing and its row names no item, plan, slice or sprint. A blocked row comes from a stopped design or verify run (`RoleRun.stopped`); `RoleRunSchema` carries `plan` and no `branch`, so its Branch cell is empty.

Find code by symbol; the plan's line numbers are a day old. The code now lives here:

- Facts per Fleet row: `agentRowFactsOf` in `packages/board/src/app/lib/agent-rows/delivery-row-facts.ts`. It reads `entry.branch` and sets `facts.branch`; the `row` lookup `all.find((r) => r.branch === entry.branch && entry.branch !== '')` is where a desk agent loses its row.
- Placed agent view: `PlacedAgentView`, `ownRow` and `agentViews` in `packages/board/src/app/lib/agent-rows/delivery-view.ts`. `ownRow` returns `null` for `entry.branch === ''`.
- Readings: `mapReadings` in `delivery-readings.ts`.
- Payload schema: `RoleRunSchema` in `packages/board/src/contract/schema.ts`; the registry entry's `checkout` (`z.string().default('')`) is in the same file. The domain's `RoleRun` and `roleRuns` are in `packages/domain/src/rules/agent-roles.ts`; the server builds the runs in `readRoleRuns` (`packages/board/src/server/fleet.ts`).
- Sprint mark: `rowSprintMembership` in `packages/domain/src/rules/sprint-selection.ts`, already used by `AgentList.tsx` for the work-item rows.
- Fleet row renderer: `packages/board/src/app/components/FleetAgentRow.tsx`.

Build the plan's two rules:

1. `agentActsOnBranch` (domain; a new file under `packages/domain/src/rules/` exported from the index): reads an agent's `branch`, then its `checkout` where `branch` is empty, for display only. The Fleet row gets its item link, plan, slice and sprint from the payload row with that branch. A row of an agent on a sprint member carries the sprint's name; a row with no sprint mark is work the sprint header does not count, and shows as a grey "no sprint" pill, drawn as plan 5 draws it.
2. `RoleRunSchema.branch`: the blocked row's Branch cell names the branch. `agentRowFactsOf` reads `run.branch` where there is no registry entry.

### Settled decisions — do not re-derive them

- **Display reads `checkout`; placement does not.** Placement and `blockedOn` keep reading `agent.branch` alone, as #1101 requires. Rejected: filling `branch` from `checkout` in the registry reading, because 28 desk agents would then be placed as acting on items, and #1101 empties `branch` on purpose. A test must prove a desk agent keeps its placement group while its row names the item.
- **No new file, no new reading.** The payload row with that branch already carries `plan` and `sprint`. Rejected: a second lookup source.
- **Reuse `rowSprintMembership`.** A second membership rule would drift from the sprint header's, and the point of this slice is that the two sections agree.
- **A working row whose process state reads `unknown` still shows its acts-on item.** The 19 `state: "unknown"` worktrees are a reading failure that has its own bug plan. Do not fix them here and do not hide the item.
- **The Fleet group shows no sprint count** (`decision-fleet-sprint-count`); the per-row sprint mark is the whole answer.
- **Rules carried over:** a view state decided in `.tsx` is a domain property not yet extracted, so the rule lives in the domain and the component renders its answer; absent is not false, so a row whose branch matches no payload row shows no plan and no sprint rather than "no sprint".

### Open point to settle first, and report

The plan says "the writer of the role-run state records [the branch]". `readRoleRuns` builds design and verify runs from `readDesignStatus` and `readVerifyStatus`, whose rows carry `plan` or `slug` and `reason`, `restart`, `log`. Before writing code, find the writer of those status rows and check that a branch exists there to record. If a stopped run has no branch of its own, report that rather than deriving one by guess; the plan's `tests:` line expects "a stopped run with no matching row gives facts.branch", so the run must carry one.

### Done when

The plan has no `## Done when`; the slice line and its `tests:` annotation are the specification. Assertions that exist because a naive implementation would pass without them:

- A synthesized agent with `branch: ''` and `checkout: X` links to X's item and shows X's plan and sprint, and keeps its placement group. Catches the shortcut of setting `branch` from `checkout`, which passes the link assertion and moves the placement.
- A desk agent whose checkout matches no payload row shows no link and no sprint pill. Catches treating no match as "no sprint".
- A stopped run with no matching payload row gives `facts.branch` (`delivery-readings.test.ts`). Catches a Branch cell that still reads only the registry entry.
- An agent on a sprint member shows the sprint's name; an agent on a non-member shows the grey "no sprint" pill. Catches a pill drawn for every row.
- The schema accepts a payload from an older server with no `branch` on a run. Catches a required field that fails every older payload.
- Unit tests for the domain rule live in the domain package; the board unit test is `packages/board/test/unit/delivery-view.test.ts` or `delivery-readings.test.ts`. The count gate `EXPECTED_FILES` and `EXPECTED_TESTS` in `packages/board/test/integration/stubbed-tests-start-no-board.test.ts` should not move; if you add a browser test, record the delta and the reason.

Plus: run `pnpm build:board` locally to test and commit no bundle (`scripts/check-no-bundle-diff.sh` refuses one). Add a changeset for `@plot-pm/board`, description first and `bumps:` block last (`./scripts/check-changeset-packages.sh`). Before each push, commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. This slice touches no `.sh` file; if that changes, `scripts/check-shell-lines.sh` refuses growth and has no override. New or rewritten functions are arrows with factual TSDoc; the domain package holds that rule, and a new helper in a board file follows it too. The word `Wave` stays out of new code where `Slice` is meant.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the new domain rule `agentActsOnBranch` and its test, `delivery-row-facts.ts` (`agentRowFactsOf`), the Fleet-row parts of `delivery-view.ts` (`PlacedAgentView`, `ownRow`, `agentViews`), `delivery-readings.ts` where it carries the branch, `RoleRunSchema` and the writer of the run's branch, `FleetAgentRow.tsx`, the tests named above, and one changeset. It touches no `headerCountParts`, no `releaseDeliveryHeader`, no `slice-states.ts` and no placement rule.

In flight: `feature/a-held-slice-names-its-hold` (#3675) extends the header's not-started part and the pills in `slicePills` and `workItemPills`; `feature/delivery-header-counts-every-state` (#3662) changes the header callers in `delivery-view.ts`. Keep the diff to the Fleet-row code so the merges stay clean. If you find something the plan did not anticipate, report it rather than improvising outside scope.
