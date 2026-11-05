# continue and the agent panel refuse unknown-branch with no pulse

> `continueBranch` and `agentPanel` answer `no-pulse` when they have no fleet reading, and keep `unknown-branch` for a reading that does not list the branch.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3117
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-05, Jan Wloka, plan-PR #3129 merged

## Changelog

- `plot-continue-command.mjs` and `POST /api/continue` refuse `no-pulse: no current fleet reading to look the branch up in` when they have no fleet reading, instead of `unknown-branch: no plan on this board names that branch`. The board's agent panel reports the same `no-pulse` miss with its own sentence.

Board impact: the board changes. `POST /api/continue` and `GET /api/agent-panel` read `pulseFor(opts)`, which is `null` on a cold board cache (`packages/board/src/server/fleet.ts:3301-3303`). `AgentPanelMiss` gains a member, and the panel strip reads its sentence from a new exhaustive `panelMissWord`, so `pnpm run typecheck` covers the board change. The plan format, the template, the helper scripts and the `docs/plans` layout do not change.

## Motivation

Two callers refuse `unknown-branch` when they have no pulse to read, and the detail blames the plan. The cause is the missing reading.

- `continueBranch` (`packages/fleet/src/shared/continue-command.ts:82-91`) calls `branchFromPulse(input.pulse, input.branch)` and refuses `unknown-branch` with `no plan on this board names that branch` when the answer is `null`.
- `branchFromPulse` (`continue-command.ts:28-29`) returns `null` for a `null` pulse. `plot-continue-command.mjs` passes the bridged pulse (`packages/fleet/src/server/entry/continue-command.ts:50-53`), which is `null` for a missing, stale, foreign-version or unparseable bridge file.
- `agentPanel` (`packages/board/src/server/agent-panel.ts:161-162`) answers `reason: 'unknown-branch'` for `pulseFor(opts)` = `null`, a cold board cache.
- `packages/fleet/test/unit/continue-command.test.ts:42-45` asserts `unknown-branch` for `pulse: null`.

Plan `2026-11-04-restart-refuses-unknown-branch-when-it` (issue #3100, Approved) fixes the same defect for `restart`, adds `no-pulse` to `ContinueRefusal` and adds its `refusalWord` sentence. This plan applies that reason to the two remaining callers and moves the "no reading versus a reading without the branch" decision into one lookup that all three callers share.

## Design

### Approach

This plan owns the `null` pulse: for `continue`, `restart` and the agent panel, a `null` pulse answers `no-pulse`. A non-null pulse that does not list the branch answers `unknown-branch`. A partial non-null pulse is #3127's scope (see Seams).

- **One lookup.** `continue-command.ts` gains an exported arrow function `lookupBranch(pulse: FleetReading | null, branch: string): BranchLookup` with `type BranchLookup = { kind: 'no-pulse' } | { kind: 'unknown-branch' } | { kind: 'found'; desk: PulseBranch }`. `branchFromPulse` stays exported with its signature and answers `lookupBranch(...)`'s desk for `found` and `null` otherwise, so its callers and tests (`packages/board/test/unit/agent-panel.test.ts:96-115`, `continue-command.test.ts:57-59`) keep passing.
- **`continueBranch`** maps the lookup: `no-pulse` → refused, 404, reason `no-pulse`, detail `no current fleet reading to look the branch up in`; `unknown-branch` → refused, 404, reason `unknown-branch`, detail unchanged; `found` with an empty worktree → `no-worktree`, unchanged. `continueBranch` takes no `worktree` override (unlike `restartBranch`), so it tests nothing about `input.pulse` itself.
- **`restartBranch`** moves to the same lookup in this slice. The restart slice (`feature/restart-refuses-no-pulse`) adds a `no-pulse` check inside `restartBranch`; this slice replaces that check with a mapping of `lookupBranch` and keeps its behaviour: `found` → the desk; not found with `input.worktree` set → the synthetic entry as today; `no-pulse` without a worktree → `no-pulse`; `unknown-branch` without a worktree → `unknown-branch`. The restart slice's tests in `packages/fleet/test/unit/restart-command.test.ts` and `packages/board/test/unit/restart-route.test.ts` guard that the behaviour does not change.
- **Order against `unattended`.** The lookup refusals come before `continueOnDesk`'s `unattended` check (`packages/fleet/src/shared/continuation.ts:917-919`), the same order `restartBranch` uses. So `continueBranch` with `pulse: null` and `caller: 'unattended'` refuses `no-pulse` (404). The lookup reads no file and no process, so the `ContinueBranchInput.caller` TSDoc ("an unattended caller is refused before any read") stays true.
- **`agentPanel`.** `AgentPanelMiss` (`agent-panel.ts:60-64`) gains `'no-pulse'` with the TSDoc `/** No current fleet reading exists to look the branch up in. */`. The `unknown-branch` TSDoc, which today describes `no-worktree` ("The pulse knows the branch but reports no worktree path for it"), changes to `/** The current pulse does not list this branch. */`. `agentPanel` maps `lookupBranch` the same way as `continueBranch`. On `no-pulse` and `unknown-branch` it returns before `uptimeSeconds`, `readConfigAsync` and `transcriptFacts`, so a missing pulse reads nothing from disk or the process table.
- **A pulse seam for `agentPanel`.** `agentPanel` gains a fourth parameter `deps: { pulse?: (opts: BuildBoardOptions) => ReturnType<typeof pulseFor> } = {}`, defaulting to `pulseFor`. The route at `packages/board/src/server/index.ts:663` does not pass it. A unit test then asserts each miss with no board server and no race against a cold cache.
- **The panel sentence is a function, not a ternary.** `AgentPanelFacts.tsx` exports an arrow function `panelMissWord(reason: AgentPanelMiss): string`, a `switch` with no `default` so `strict` fails on a new member. `AgentPanelFacts` renders `{panelMissWord(panel.reason)}` and keeps `data-panel-miss={panel.reason}`. The sentences:
  - `no-worktree`: `No worktree for this branch on this machine — ask the machine that took it.` (unchanged)
  - `unknown-branch`: `No scan has reported this branch — the next pulse may know it.` (unchanged)
  - `no-pulse`: `No current fleet reading yet — wait for the next fleet scan.`
- **Status.** `GET /api/agent-panel` keeps 404 for every miss, `no-pulse` included: `index.ts:667` writes `panel.ok ? 200 : 404` for any reason, and `WorkerLogModal.tsx:205-210` reads the body, not the status. No route change. `POST /api/continue` answers 404 for `no-pulse`, as `restart` does.
- **Documents.** The TSDoc of `continueBranch` (`continue-command.ts:73-81`) and of `restartBranch` name `no-pulse`, `unknown-branch` and `no-worktree`. The module doc of `packages/fleet/src/server/entry/continue-command.ts` (the sentence "refuses `unknown-branch` and `no-worktree`", `:20-21` on origin/main) names `no-pulse` too. `skills/plot/scripts/README.md` row `board/plot-continue-command.mjs` (`:85` on origin/main) names `no-pulse`, `unknown-branch` and `no-worktree`.
- **Placement.** The lookup stays in `@plot-pm/fleet/shared` beside `branchFromPulse`, where the rule lives today. The slice adds no decision in `packages/board/src/server/` beyond mapping the lookup. Moving the rule into `@plot-pm/domain` is #3139.

### Callers and documents searched

`git grep unknown-branch` over `packages/*/src`, `skills` and the tests on origin/main (bundles excluded) finds no caller that branches on the continue or panel reason string. `ContinueWithAnAnswer.tsx:36` and `AgentPanelFacts.tsx:364-368` render it. `WorkerLogModal.tsx:203-210` stores any non-error panel body and polls again, so a `no-pulse` panel clears itself when the cache warms. `packages/fleet/test/entry-module-graph.test.mjs:106-108` asserts that the continue bundle names `unknown-branch`; the bundle still names it after the change.

### Seams with other plans and open pull requests

- **Plan #3127** (issue #3118, `idea/partial-board-pulse-reported-as-unknown`) edits the same call sites: `agent-panel.ts:161-162`, the `continueBranch` lookup and `restartBranch`. Its amendment covers only a non-null partial pulse, and its slice `feature/partial-pulse-names-itself` waits on this plan's slice branch. This plan does not wait on #3127. The invariant #3127 keeps: a `null` pulse answers `no-pulse`; the partial refusal applies only to a non-null pulse that is incomplete. #3127 extends `lookupBranch` rather than adding a fourth check.
- **PR #3109** (`bug/an-answer-records-its-true-author`, open and `DIRTY` on 2026-11-04) edits `packages/fleet/test/unit/continue-command.test.ts`, `packages/board/test/unit/continue-route.test.ts` and `packages/fleet/src/server/entry/continue-command.ts`, and moves their lines (it inserts 43 lines before `continue-route.test.ts:744` and rewrites the entry's module doc). This slice reaches #3109 through the restart slice, which waits on it. The agent finds each test and doc sentence by its name, not by the line numbers in this plan: `refuses unknown-branch where there is no pulse at all`, `refuses a branch the board has never heard of`, `gives each refusal its own reason`, and the module doc sentence "refuses `unknown-branch` and `no-worktree`".
- **PR #3112** edits `skills/plot/scripts/README.md`. This slice edits row `board/plot-continue-command.mjs` only; the restart slice edits row `board/plot-restart-command.mjs`. Expect a textual rebase on that file; keep every change.

## Slices

### Continue and the panel name a missing pulse

- `feature/continue-refuses-no-pulse` <!-- waits: feature/restart-refuses-no-pulse --> — one `lookupBranch` answers `no-pulse`, `unknown-branch` or the desk; `continueBranch`, `restartBranch` and `agentPanel` map it; the panel strip reads `panelMissWord`; tests and documents follow.

Files the slice changes:

- `packages/fleet/src/shared/continue-command.ts` — `BranchLookup`, `lookupBranch`, `branchFromPulse` over it, the `no-pulse` mapping in `continueBranch`, TSDoc.
- `packages/fleet/src/shared/restart-command.ts` — `restartBranch` maps `lookupBranch`; its own `null`-pulse check from the restart slice goes; TSDoc.
- `packages/fleet/src/server/entry/continue-command.ts` — module doc names `no-pulse`.
- `packages/board/src/server/agent-panel.ts` — `AgentPanelMiss` gains `no-pulse`, `unknown-branch` TSDoc corrected, the `deps.pulse` seam, the lookup mapping.
- `packages/board/src/app/components/AgentPanelFacts.tsx` — exported `panelMissWord`, used in place of the ternary.
- `skills/plot/scripts/README.md` — row `board/plot-continue-command.mjs`.
- `packages/board/test/unit/routes-are-thin.test.ts` — the `restart.ts` and `continue.ts` cases add `lookupBranch` to their `doesNotMatch` patterns, so a route that calls the lookup itself fails.

Tests that fail on origin/main and pass after the change:

- `packages/fleet/test/unit/continue-command.test.ts`, `refuses unknown-branch where there is no pulse at all` — rename to `refuses no-pulse where there is no pulse at all` and assert `{ kind: 'refused', status: 404, reason: 'no-pulse', detail: 'no current fleet reading to look the branch up in' }`.
- `packages/fleet/test/unit/continue-command.test.ts` — new test `lookupBranch answers no-pulse, unknown-branch or the desk`: `null` pulse → `{ kind: 'no-pulse' }`; the file's `pulse` fixture and `nope` → `{ kind: 'unknown-branch' }`; `has-desk` → `{ kind: 'found', desk: { worktree: '/w/has-desk', pid: '41' … } }`.
- `packages/fleet/test/unit/continue-command.test.ts` — new test `refuses no-pulse before unattended where there is no pulse`: `continueBranch({ opts, pulse: null, branch: 'has-desk', caller: 'unattended', answer: 'yes' })` refuses `no-pulse` with 404. It touches no file system.
- `packages/fleet/test/unit/continue-command.test.ts` — new test in a `describe('the continue entry')` block with its own `dirs` list: `run(['x', 'yes'], repo, '/nonexistent', { pulse: () => null, caller: 'person' }, write, warn)` returns 1, and `warn` receives `plot-continue-command: no-pulse: no current fleet reading to look the branch up in`. `repo` is a `git init -q -b main` directory under `fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-continue-nopulse-')))`, pushed to `dirs` and removed by that exact name, as the `PLOT_UNATTENDED` test in the same file does.
- `packages/board/test/unit/continue-route.test.ts`, `refuses a branch the board has never heard of` — `deps(null)` is a `null` pulse (`deps` at `:312-317`). Rename to `refuses no-pulse where the board has no fleet reading` and assert status 404, reason `no-pulse` and the detail string.
- `packages/board/test/unit/agent-panel.test.ts` — new test `agentPanel names each miss without a board server`: `agentPanel(opts, 'x', {}, { pulse: () => null })` → `{ ok: false, branch: 'x', reason: 'no-pulse' }`; a non-null pulse without the branch → `unknown-branch`; an entry with an empty `local_worktree` → `no-worktree`. `opts` is a plain options object; no miss reaches a spawn.
- `packages/board/test/unit/agent-panel.test.ts` — new test `panelMissWord gives each miss its own sentence`: the three reasons give three distinct sentences, and `panelMissWord('no-pulse')` equals `No current fleet reading yet — wait for the next fleet scan.`

Tests the slice changes that pass before and after:

- `packages/board/test/unit/continue-route.test.ts`, `gives each refusal its own reason` (`:840-857` on origin/main) — add `'no-pulse'` to the list and change the comment's count from five to six. It checks only `Set` size, so it guards drift, not this change.
- `packages/board/test/unit/continue-route.test.ts` — new test `refuses unknown-branch where the pulse does not list the branch`: `post({ branch: 'nothing', answer: 'go' }, deps('/tmp/no-such-worktree'), …)` answers 404 and `unknown-branch`.
- `packages/fleet/test/unit/continue-command.test.ts`, `refuses unknown-branch with 404 where the pulse does not list the branch` — unchanged; it guards that a non-null pulse keeps `unknown-branch`.
- `packages/fleet/test/unit/restart-command.test.ts` and `packages/board/test/unit/restart-route.test.ts` — unchanged; they guard that `restartBranch` keeps its behaviour on the shared lookup.
- `packages/board/test/agent-panel.test.mjs` — unchanged. Its stub scan supplies a non-null pulse (`:164-166`), so the security cases at `:211-218` keep `unknown-branch`. The slice adds no cold-cache case there: a request before the first scan lands races the boot scan.
- `packages/board/test/unit/continue-control.test.ts` — not this slice's evidence. The restart slice adds `'no-pulse'` to its `reasons` list.

Checks the slice runs before it pushes:

- `pnpm --filter @plot-pm/fleet exec vitest run test/unit/continue-command.test.ts test/unit/restart-command.test.ts`
- `pnpm --filter @plot-pm/fleet exec tsc --noEmit -p .`
- `pnpm --filter @plot-pm/board exec vitest run --project parallel test/unit/continue-route.test.ts test/unit/agent-panel.test.ts test/unit/restart-route.test.ts test/unit/continue-control.test.ts test/unit/routes-are-thin.test.ts`
- `pnpm run typecheck`
- `node skills/plot/scripts/board/plot-local-checks.mjs` and what it prints, including the `scripts/check-*.sh` gates.

The slice adds no shell lines, so `scripts/check-shell-lines.sh` is unaffected. It commits no generated bundle: `skills/plot/scripts/board/plot-continue-command.mjs` and `board-server.mjs` are built on main (`scripts/check-no-bundle-diff.sh`). It adds a changeset for `plot` (patch) whose description is the Changelog line above. New functions are arrow functions, including `panelMissWord` in a file of declarations.

## Notes

- Source: issue #3117 (refs #3100). Order: the slice waits on `feature/restart-refuses-no-pulse`, which adds `no-pulse` to `ContinueRefusal` and to `refusalWord`; without it, `tsc` fails by name on the `no-pulse` literal.
- Panel round 1: `.plot/panels/2026-11-04-continue-and-the-agent-panel-refuse/panel.md` (four jurors, unanimous amend).
- Follow-ups: #3127 (a partial non-null pulse, waits on this slice), #3139 (the lookup rule moves into the domain package).
- The deliverable search for `no-pulse refusal` found no existing artifact. The slice builds no new deliverable, so it carries no `builds:` annotation.
