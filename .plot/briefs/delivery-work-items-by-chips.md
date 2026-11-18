## Implementation brief — delivery-work-items-show-gates (wave 4: Agent chips)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-work-items-show-gates.md on main
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-work-items-by-chips` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is the last of four slices. Both of its waits have merged: `feature/delivery-work-items-progress` (#3517) and plan 4's `feature/delivery-agent-roles` (#3493). Nothing waits on it. Touch the By column of Work items and the one payload field the fixer's attempt needs, and nothing else.

### What to build

The By cell of a Work items row shows one agent's raw id as a link: `byAgents` (`packages/domain/src/rules/delivery-row-form.ts`, near `:309`) returns the first id in `placement.agents` as the cell value, linked to `{ to: 'agent', id }`. For a registry agent that id is readable. For a state-file agent it is not: a fixer or reviewer run has the id `agent:fixer:<pr>` or `agent:reviewer:<pr>:<sha7>` (`roleRuns`, `rules/agent-roles.ts`), so the cell reads `agent:fixer:3480`. The cell shows no role and, for a fixer, no attempt. `workItemCells` (`rules/delivery-work-columns.ts`) passes `row.by` through unchanged, and `AgentList.tsx` renders it with `byItem` → `byCell` → `RowCell` (near `:1156`).

This slice makes the By cell show the agent's role chip, its name and the link to its Fleet row, and adds a fixer's attempt (`1/2`):

1. **A domain fact per agent.** `ItemRowFacts` has no agent facts today: the cell is built from `placement.agents`, a `string[]` of ids. Add the agent's role, name and, for a fixer, attempt to the facts, filled in `itemRowFactsOf` (`packages/board/src/app/lib/agent-rows/delivery-row-facts.ts`). The role of an id is in `mapping.readings.agents` (`AgentPlacementReading.role`), which holds registry agents and state-file runs alike; a state-file run is also in `mapping.runsById`. The By cell is then a domain property: which role, which name, which attempt text, which link. Names of the new facts and their types are the builder's call, within the domain's terminology (an Agent is the actor; a Worker is its process).
2. **The chip is plan 4's, built once.** `RoleChip` (`packages/board/src/app/components/RoleChip.tsx`) takes an `AgentRole` and takes its label, colour key and accessible name from the domain's `roleChip` (`rules/agent-roles.ts:140`). Import it. Do not write a second chip, a second colour table or a second label list. `AgentList.tsx:1411` already renders it for Fleet rows with `agent.placement.role`.
3. **The cell needs a shape for a chip.** `Cell` is `{ value, links }`, a value and its targets, with no place for a role. Decide in the domain how a By cell carries its role (a field on the cell, or a By-specific cell type) and render it in `RowCell` or beside it. Keep it to Work items: `itemRowCells`' `by` stays the plain value for You and the other sections, as the gate-cells slice kept `status` for them.
4. **The fixer's attempt is a new payload field.** Today the payload carries `fixerInFlight` (`schema.ts:3332`) and nothing that says which attempt it is. `readRoleRuns` (`server/fleet.ts:8497`) already reads every PR's record once per scan with `listFixerAttempts(repoRoot)` and `roleRuns` already reduces it to one run per in-flight fixer. Put the attempt on that run: add an optional field to `RoleRun` (`rules/agent-roles.ts`) and to `RoleRunSchema` (`schema.ts:4408`), computed in `roleRuns` from the record it already holds. No new file read and no per-row read. The field is optional so a payload from an older server still parses, as `roleRuns` itself is (`schema.ts:5003-5007`).
5. **Name.** The name must equal the text of the agent's Agent cell on its Fleet row, so the By link and its target read alike. `agentLabel` (`lib/agent-rows/delivery-view.ts:233`) returns `entry?.branch || entry?.worktree || id`, which is the raw id for a state-file run. Read how the Fleet row builds its Agent cell (`AgentRowFacts.name`, `delivery-row-form.ts:115`) and reuse that, so a fixer is named once.

The plan is canonical. This brief is orientation.

### The decisions the plan settles — do not re-derive them

**The attempt is counted on the finding kind in flight, not over the whole record.** The record holds one entry per start, of two kinds: `finding.kind` is `high` or `ci` (`entities/fixer-attempts.ts`). `fixerAttemptsSpent(record, kind)` (`rules/fixer-attempts.ts`) counts one kind and skips an attempt with `start: 'failed'`, which spent nothing because the CLI refused before any agent ran. Use it with the `kind` of the attempt that carries `inFlight`. The in-flight attempt counts itself, because an attempt is spent by starting, so the first start reads `1/2`. Counting `record.attempts.length` is wrong: its own doc says two attempts on red CI leave the HIGH budget whole.

**The denominator is `FIXER_ATTEMPTS_BUDGET` (2), not the `Correction budget` key.** The key is the desk's correction budget that plan 2's PR rule reads. The two have different owners and can differ. A test that sets `correctionBudget` to 5 and still reads `/2` catches an implementation that reads the key.

**The finding kind comes from the record, not from the PR's reading.** `delivery-row-facts.ts:132-133` sets `fixerFinding` today from the PR's `ci` and `review` readings, which a PR can show both at once (red CI and a HIGH review). The record says which finding the running fixer answers. A record that says `ci` while the PR also reads a HIGH must show the CI count.

**`AgentRowFacts.fixerAttempt` is declared and has no producer.** `delivery-row-form.ts:134` declares it and `:557-558` reads it for the Fleet row's Doing now cell (`fixing CI ✗ · attempt 1 of 2`). Measured on `main` at `5d76f07dc`: no code under `packages/domain/src` or `packages/board/src` sets it, so every Fleet fixer row shows `fixing CI ✗` with no attempt today. The field in step 4 is what feeds both cells. Fill `fixerAttempt` from the same field in this slice; that is one more line, and it closes a gap that already ships. The By cell writes `1/2` and the Doing now cell keeps `attempt 1 of 2`: two cells, two wordings the plan and the Fleet slice each already fixed.

**An unread record shows no attempt.** `roleRuns` already skips a `none` or `unreadable` record and yields no fixer run. A run with no attempt field (an older server) shows the chip and the name and no `/2`. An absent reading is not `0/2`.

**A person is not an agent.** Another person's Draft or Design plan sits in Queued with a person in By today (`byAgents` falls back to `{ to: 'person', handle }`). That cell keeps its person link and gets no chip, because a chip names an agent role and a person has none. A test for that case catches an implementation that gives every By cell a chip.

**The link stays on the first agent, and all agents keep their targets.** `byAgents` names the cell with the first id and links every id to its Fleet row (`delivery-row-form.test.ts` lines 60–98 assert that today). Keep it. The order of `placement.agents` when a loop agent and a fixer both act on one item is not measured here: the builder reads `placeDelivery`'s order, asserts which agent names the cell in a test, and reports it if the answer looks wrong rather than reordering.

**The role comes from the reading, never from the id.** Do not parse `agent:fixer:` out of the id string. `AgentPlacementReading.role` carries the role for every agent, registry or run. A test with a registry agent whose id happens to contain `fixer` and whose role is `loop` catches an id parse.

**Rules carried over unchanged from this estate:** absent is not false, and an unread value yields a `null` cell, never a default word (`delivery-row-form.ts:215-216`). Read a reading's own value, never the emptiness of a string.

### Done when

The plan's `Done when` line for this slice is the specification: By shows the agent's role chip and name, linked to its Fleet row; a fixer row shows its attempt against `FIXER_ATTEMPTS_BUDGET` on the finding kind it fixes.

The assertions that exist because a naive implementation passes without them:

- **Attempt on the kind.** A record with one `ci` attempt (finished) and one `high` attempt in flight reads `1/2`, not `2/2`. This catches a count over all attempts.
- **A refused start spends nothing.** A record with a `start: 'failed'` attempt and one real attempt in flight reads `1/2`. This catches a count that ignores `start`.
- **The attempt is on the run.** `roleRuns` returns the attempt for a fixer run and none for a reviewer, design or verify run, asserted in `packages/domain/test/agent-roles.test.ts`. This catches a field set on every run.
- **The budget is the constant.** `correctionBudget: 5` still reads `/2`.
- **Role from the reading.** Registry agent `fixer-x` with role `loop` shows the `loop` chip.
- **One chip.** The By chip and the Fleet row chip for the same role carry the same `data-chip-colour` and accessible name, because both come from `roleChip`.
- **No chip for a person.** A Queued item whose By is a person shows the person link and no `data-role-chip`.
- **Older server.** A fixer run with no attempt field shows the chip and the name and no `/`.
- **Link to the Fleet row.** The name's link resolves to the agent's Fleet row (`{ to: 'agent', id }` through `resolveLink`).
- **The other sections keep `by`.** The You rows' By value in `delivery-row-form.test.ts` still passes unchanged. Update the tests that go through the Work items form, and keep those for You. Which existing browser tests select the By text is the builder's to find.

Every cell value, role, attempt and link is a domain property with a unit test in `packages/domain/test/`. One browser test proves the chip, the name and `1/2` render in a Work items row; `a-fleet-row-shows-its-role-chip.browser.test.ts` is the precedent. The decisions are asserted in the domain.

Plus: add a changeset (`.changeset/<name>.md`, package `@plot-pm/board`, description first, `bumps:` block last). Run `pnpm build:board` locally to test, and commit no bundle: `scripts/check-no-bundle-diff.sh` refuses one. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count. Functions you write are arrows. The schema change is a payload contract change: keep the field optional.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the By cell in `delivery-row-form.ts` and `delivery-work-columns.ts`, the agent facts in `delivery-row-facts.ts`, the `RoleRun` attempt field in `rules/agent-roles.ts` with its `RoleRunSchema` entry, the `fixerAttempt` producer, the By render in `AgentList.tsx`, and the tests that select By text.

No slice of this plan follows it. Remote branches in flight on `origin` when this brief was written: `feature/delivery-fleet-header-switches`, `feature/delivery-slice-states`, `feature/delivery-tab-footer` and `feature/delivery-you-loose-prs`. Whether any of them touches `delivery-row-form.ts`, `delivery-row-facts.ts` or `agent-roles.ts` is not verified here: run `git diff --stat origin/main...origin/<branch>` for each before editing those files, and rebase on a collision rather than rewriting its lines.

Do not write the Gates, Progress or Waits on cells here: they merged in #3515 and #3517. Do not change the Fleet rows' columns or the role readings of plan 4 beyond the attempt field above.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
