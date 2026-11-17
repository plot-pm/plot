## Implementation brief — delivery-fleet-rows-per-agent (wave 3: Agent rows)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-fleet-rows-per-agent.md on main
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-fleet-agent-rows` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is the third slice of plan 4 of the six-plan Delivery-tab design. It waits on `feature/delivery-fleet-plan-runs`, merged on `main` as PR #3499. `feature/delivery-fleet-time-tokens` waits on this slice, so the Tokens and Time left cells and the header tokens are not yours. Before you start, confirm the plan-runs merge with `git log origin/main --oneline -- packages/board/src/app/components/RoleRunRow.tsx packages/domain/src/rules/agent-roles.ts`; if either file is absent, stop and report.

### What to build

The Fleet section today shows agent rows that carry internals as row text ("no manifest names this desk", measured on the running board on 2026-11-16), folds each group, and builds a seven-cell agent row (`agentRowCells`, `packages/domain/src/rules/delivery-row-form.ts:310`) whose cells are the item-row columns (`kind item where status do by age`) filled with agent facts. This slice changes four things:

1. **Groups.** Working and Blocked stay open and Free collapses into one line, "Free · 3 agents ready: … · show". Fleet agents render through `group.agents.flatMap(agentBody)` inside `fold(group.key, …)` (`packages/board/src/app/components/AgentList.tsx`, about `:1484-1520`); that fold is the one to remove for Working and Blocked. `isCollapsible` / `readCollapsed` (`lib/agent-rows/collapse.ts`) belong to the item sections; do not change their rule for any other group.
2. **Columns.** `agentRowCells` and `AgentRowFacts` (`:81`) change into the design's set: Agent · Role · Acting on · Doing now (Blocked: **Waits on**) · Tokens · Time left. You change the function and its facts; you build no second agent row form. `ROW_COLUMNS` (`:13`) stays the item rows' set. Tokens and Time left are columns of the form here and carry "—" until `feature/delivery-fleet-time-tokens` fills them.
3. **Acting on and Doing now.** Acting on links to the item's row with its branch beneath. Doing now names the activity: "writing code · 4 commits" with the last commit subject for a loop agent (cut at its end where the column is narrow), "reviewing head 2d929a6" for a reviewer, "fixing CI ✗ · attempt 1 of 2" for a fixer (the attempt from the fixer-attempts record against `FIXER_ATTEMPTS_BUDGET`). The commit count and subject come from the pulse's local git reading of the branch, which this slice adds to the agent facts.
4. **Waits on.** A blocked agent's Waits on names the gate and links to it. `DeliveryGate` (`delivery-placement.ts:26`) already holds `ci`, `review`, `machine`, `rate-limit` and `person`. The board sets `blockedOn` only to `person` today (`lib/agent-rows/delivery-readings.ts`, the `blockedOn: agent.state === 'waiting' ? 'person' : null` line). Add `ci` where the agent's item is a PR whose CI reads `running`, through `ciOf` (`delivery-readings.ts:104`), linked to the PR's `checksUrl`. Add `review` where that PR's CI passed and its review reads `pending`, linked to the PR's `url`. Add `rate-limit` where the connector's limit reading (`packages/domain/src/entities/limit.ts`; the host's remaining budget travels on `fleet.machine`, `schema.ts` about `:4697`) reports an exhausted window. A gate with no reading shows no Waits on value.

Then move "no manifest names this desk" out of the row text and into the Agent cell's tooltip. The text comes from `unnamedDeskLabel` (`packages/domain/src/rules/desk-manifest.ts:260`), used at `lib/agent-rows/rows.tsx:2653`. `an-unnamed-desk-says-so.browser.test.ts` asserts today that the row prints it; that test changes to assert the tooltip and the absence from the row text.

The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**`agentRowCells` is changed, not replaced.** The plan names it, and the round-2 panel found it already builds an agent row with the role as its `kind` cell. A second form would give plan 3's By column and the header two sources for one agent.

**`agentGroup` stays.** An agent with an unread process (`process === undefined`) goes to `unplaced` with the reason `unread`, and plan 6's footer counts it (`delivery-placement.ts:263`). "Every placed agent shows once" means every agent that has a group; do not give an unread agent a group to make the count look whole. A stopped agent with no item is `free`, with an item `blocked`; leave that as it is.

**An absent reading is not a gate.** A PR whose `ciChecks` and `state` are both absent reads `unread` through `ciOf`, and `unread` is not `running`: it gives no `ci` gate. A host that answers `none` is a reading ("no check gates the PR"), not an absence. A limit reading with basis `unknown` (`LimitBasisSchema`) is not exhausted and is not free: it gives no `rate-limit` gate. This is the rule the estate keeps relearning, and the tests below pin it.

**No role gains a host read.** Every Waits on value comes from a reading already on the payload: the row's `pr`, `ciChecks`, `plotReview`, and `fleet.machine`. Do not call `plot-host.sh` or a connector from the board to name a gate.

**The approver shows no row.** `delivery-readings.ts` skips the role (`if (agent.role === 'approver') continue;`) because nothing reads it on `main`. Keep it.

**Free collapses, and the other two do not.** The design keeps groups open; Free is one of the design's three collapsibles. The Free line is a domain fact (the count and the names), not a string built in the component.

**Design and verify keep a `null` start time.** The plan-runs slice left it so. Time left is `feature/delivery-fleet-time-tokens`'s.

**Domain first.** Every group, Doing now value, Waits on target and link is a domain property with a unit test built on `agentRowCells`; a browser test only proves the value is seen. Measured: 42 of this repo's 43 browser tests came to start a full board server because a decision lived in a `.tsx`.

### Done when

The plan's Done When item for this slice is the specification: every placed agent shows once, in exactly one of Working, Blocked or Free; Working and Blocked stay open and Free collapses into one line; a reviewer, a fixer and a loop agent each show a Doing now value; a blocked agent's Waits on names `person`, `ci`, `review` or `rate-limit` from its reading and links to it; `agentRowCells` builds the design's columns; no agent row shows "no manifest names this desk" as row text; each asserted in unit tests.

Lift these assertions, because a naive implementation passes without them:

- Waits on is computed per gate from its own reading, not from `blockedOn` alone: a fixture with a PR whose CI is `pending` gives `ci` linked to `checksUrl`, a PR with `ciChecks: 'green'` and `plotReview: 'pending'` gives `review` linked to `url`, and a PR with `ciChecks` absent gives no gate. This catches a Waits on that names `ci` for every PR it cannot read.
- A blocked agent with two true gates (CI running and a person's question) shows one Waits on value, chosen by a stated order, and the order is asserted. This catches a cell that renders both or flips between renders.
- Free with one agent and Free with zero agents: zero renders no Free line and no empty `<ul>`; one renders "Free · 1 agent ready: …" in the singular. This catches the empty section and the "1 agents" wording.
- A fixture with five agents across the three groups shows each agent exactly once, and `sectionCount` for the Fleet section equals five minus the unplaced. This catches an agent counted under two groups or dropped by the fold removal.
- The Agent cell of an unnamed desk holds the tooltip text and the row text does not contain "no manifest names this desk". This catches a move that copies the text instead of moving it.
- The existing assertions of `delivery-row-form.test.ts` for the seven-cell agent row change with the form; list each changed assertion in the PR body, so a reviewer sees the form moved on purpose.

Plus the repo's gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. `pnpm run typecheck` does not cover `packages/domain`: run `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .` for any domain file you change. Run `pnpm build:board` only to look at the result in a browser, and restore any generated bundle path before you push: `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Never run board tests while an operator's board is open on this machine. Add a changeset for the package `@plot-pm/board`, the description first and at least 20 characters, then the `plan: docs/plans/2026-11-16-delivery-fleet-rows-per-agent.md` line inside the comment block; `scripts/check-changeset-packages.sh` checks the order and the package name. The slice changes no skill, so the changeset names no `bumps:` entry. The slice touches no `.sh` file under `skills/`, so `scripts/check-shell-lines.sh` has nothing to count. Any function you write is an arrow, and `packages/domain` takes TSDoc that states what an export does and returns, not the history of the decision; leave neighbouring declarations alone.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the Fleet groups and their folds in `packages/board/src/app/components/AgentList.tsx`, `agentRowCells` and `AgentRowFacts` in `packages/domain/src/rules/delivery-row-form.ts`, the agent facts in `lib/agent-rows/delivery-row-facts.ts`, the `blockedOn` reading in `lib/agent-rows/delivery-readings.ts`, the Agent cell's tooltip in `rows.tsx`, and the tests that select the Fleet columns (`an-unnamed-desk-says-so.browser.test.ts`, `delivery-row-form.test.ts`, `delivery-readings.test.ts`).

It does not own Time left, Tokens, the `Worker bound` read or the spend read (`feature/delivery-fleet-time-tokens`), the header counts, switches or token figure (`feature/delivery-fleet-header-switches`, and plan 1's section header), the role chip and role readings (`feature/delivery-agent-roles`, merged), design and verify runs (`feature/delivery-fleet-plan-runs`, merged), `ROW_COLUMNS`, the item rows, or the Tickets section. At dispatch `git ls-remote --heads origin 'feature/delivery-*'` lists only `feature/delivery-you-groups`, a plan 1 slice that edits the You groups, not Fleet; verify it, do not assume, and report a collision with `AgentList.tsx` rather than resolving it by guess.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
