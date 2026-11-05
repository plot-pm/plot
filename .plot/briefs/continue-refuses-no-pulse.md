## Implementation brief — continue-and-the-agent-panel-refuse (wave 1: Continue and the panel name a missing pulse)

- **Plan (canonical):** docs/plans/2026-11-04-continue-and-the-agent-panel-refuse.md on main
- **Approved:** 2026-11-05, Jan Wloka, plan-PR #3129 merged
- **Branch:** `feature/continue-refuses-no-pulse` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` on the PR, per `Review: pr`

This is the only branch of the plan. It waited on `feature/restart-refuses-no-pulse`; that slice merged as #3157, so `ContinueRefusal` already holds `no-pulse` and `restartBranch` already carries its own `null`-pulse check. PR #3109 merged on 2026-11-05 too. Branch from current `origin/main`. `feature/partial-pulse-names-itself` (#3127) waits on this slice and extends the lookup you add.

### What to build

Three callers answer `unknown-branch` ("no plan on this board names that branch") when they have no fleet reading, and the detail blames the plan for a missing reading. `continueBranch` (`packages/fleet/src/shared/continue-command.ts`) and `agentPanel` (`packages/board/src/server/agent-panel.ts`) do it for a `null` pulse: a missing, stale, foreign-version or unparseable bridge file for the CLI, a cold scan cache for the board. `restartBranch` already refuses `no-pulse` through a check of its own.

Add one exported arrow function `lookupBranch(pulse: FleetReading | null, branch: string): BranchLookup` beside `branchFromPulse`, with `type BranchLookup = { kind: 'no-pulse' } | { kind: 'unknown-branch' } | { kind: 'found'; desk: PulseBranch }`. `continueBranch`, `restartBranch` and `agentPanel` map it. A `null` pulse answers `no-pulse`; a non-null pulse without the branch answers `unknown-branch`. The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

- **`branchFromPulse` stays exported with its signature.** It answers the desk for `found` and `null` otherwise, built over `lookupBranch`. `agent-panel.test.ts` (`resolving a branch against the pulse`, including `branchFromPulse(null, …) === null`) and `continue-command.test.ts` call it, and they must keep passing unedited. Dropping it, or changing what it returns for `null`, breaks them.
- **The lookup refusals come before `unattended`.** `continueBranch({ pulse: null, caller: 'unattended', … })` refuses `no-pulse` (404), the order `restartBranch` uses. The lookup reads no file and no process, so the `ContinueBranchInput.caller` TSDoc ("an unattended caller is refused before any read") stays true. `continueBranch` has no `worktree` override, so it tests nothing about `input.pulse` beyond the lookup.
- **`restartBranch` keeps its behaviour exactly.** Replace its inline `input.pulse === null && !input.worktree` check with a mapping of `lookupBranch`: `found` → the desk; not found with `input.worktree` set → the synthetic entry as today; `no-pulse` without a worktree → `no-pulse`; `unknown-branch` without a worktree → `unknown-branch`. A `null` pulse WITH `input.worktree` (`PLOT_RESTART_WORKTREE` from `plot-dispatch.sh --restart`) must still continue. A mapping that returns `no-pulse` on `null` alone breaks that caller. `restart-command.test.ts` and `restart-route.test.ts` are unchanged and guard it.
- **`agentPanel` returns before any read.** On `no-pulse` and `unknown-branch` it returns before `uptimeSeconds`, `readConfigAsync` and `transcriptFacts`. Add the fourth parameter `deps: { pulse?: (opts: BuildBoardOptions) => ReturnType<typeof pulseFor> } = {}`, defaulting to `pulseFor`. The route at `packages/board/src/server/index.ts` does not pass it. Without the seam, a unit test of the miss has to start a board server and races the cold cache; that is how `agent-panel.test.mjs` came to avoid the case.
- **Status stays 404 for every panel miss.** `index.ts` writes `panel.ok ? 200 : 404` for any reason and `WorkerLogModal.tsx` reads the body, not the status. Do not touch the route. `POST /api/continue` answers 404 for `no-pulse`, as `restart` does.
- **The panel sentence is a function, not a ternary.** Export an arrow function `panelMissWord(reason: AgentPanelMiss): string` from `AgentPanelFacts.tsx`, a `switch` with no `default`, so `strict` fails on the next member. Keep `data-panel-miss={panel.reason}`. Sentences, verbatim: `no-worktree` → `No worktree for this branch on this machine — ask the machine that took it.`; `unknown-branch` → `No scan has reported this branch — the next pulse may know it.`; `no-pulse` → `No current fleet reading yet — wait for the next fleet scan.`
- **TSDoc:** `AgentPanelMiss` gains `'no-pulse'` with `/** No current fleet reading exists to look the branch up in. */`. The `unknown-branch` doc, which today describes `no-worktree`, becomes `/** The current pulse does not list this branch. */`.
- **The rule stays in `@plot-pm/fleet/shared`.** No decision lands in `packages/board/src/server/` beyond mapping the lookup. Moving it into `@plot-pm/domain` is #3139; do not start it.
- **Out of scope, and leave unchanged:** a partial non-null pulse that does not list the branch still answers `unknown-branch` (#3127). `git grep unknown-branch` finds no caller that branches on the continue or panel reason string, and `packages/fleet/test/entry-module-graph.test.mjs` asserts the continue bundle still names `unknown-branch`. Do not "fix" the other hits.
- **Function style:** any function you write is an arrow, `panelMissWord` included in a file of declarations (`CLAUDE.md`, *The Domain Package*). No gate enforces it outside `packages/domain/src/`.

### Done when

The plan's `## Slices` lists the files and the tests; that list is the specification. Find each test by its name — line numbers date from before #3109 and #3157. The assertions that exist because a naive implementation would pass without them:

- `continueBranch({ opts, pulse: null, branch: 'has-desk', caller: 'unattended', answer: 'yes' })` refuses `no-pulse` with 404 and touches no file system. It catches a lookup placed after the `unattended` check.
- `lookupBranch` gives `{ kind: 'unknown-branch' }` for the file's `pulse` fixture with branch `nope`. It catches a lookup that turns every miss into `no-pulse`. The existing `refuses unknown-branch with 404 where the pulse does not list the branch` stays unchanged for the same reason.
- `continue-route.test.ts`: `deps(null)` is a `null` pulse, so `refuses a branch the board has never heard of` becomes `refuses no-pulse where the board has no fleet reading`. The new `refuses unknown-branch where the pulse does not list the branch` posts `{ branch: 'nothing', answer: 'go' }` against `deps('/tmp/no-such-worktree')` and answers 404 `unknown-branch`. Without it no route test keeps the second reason.
- `agentPanel(opts, 'x', {}, { pulse: () => null })` → `{ ok: false, branch: 'x', reason: 'no-pulse' }`; a non-null pulse without the branch → `unknown-branch`; an entry with an empty `local_worktree` → `no-worktree`. No miss reaches a spawn.
- The `describe('the continue entry')` test for `no-pulse` creates its repo with `fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'plot-continue-nopulse-')))`, pushes it to its own `dirs` list and removes it by that exact name. `run(['x', 'yes'], repo, '/nonexistent', { pulse: () => null, caller: 'person' }, write, warn)` returns 1 and `warn` receives `plot-continue-command: no-pulse: no current fleet reading to look the branch up in`.
- `routes-are-thin.test.ts`: the `restart.ts` and `continue.ts` cases add `lookupBranch` to their `doesNotMatch` patterns, so a route that calls the lookup itself fails.
- `gives each refusal its own reason` gains `'no-pulse'` (six reasons). It checks only `Set` size, so it guards drift and not this change.

Documents: the TSDoc of `continueBranch` and `restartBranch` names `no-pulse`, `unknown-branch` and `no-worktree`; the module doc of `packages/fleet/src/server/entry/continue-command.ts` ("refuses `unknown-branch` and `no-worktree`") names `no-pulse` too; `skills/plot/scripts/README.md` row `board/plot-continue-command.mjs` names all three.

Plus: add a changeset for `plot` (patch) whose first line after the frontmatter is the plan's Changelog line, with the `bumps:` block last. Commit no generated bundle (`plot-continue-command.mjs`, `board-server.mjs`): `scripts/check-no-bundle-diff.sh` refuses it. The slice adds no shell lines, so `scripts/check-shell-lines.sh` is unaffected.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints, including the `scripts/check-*.sh` gates. The plan names five targeted commands:

- `pnpm --filter @plot-pm/fleet exec vitest run test/unit/continue-command.test.ts test/unit/restart-command.test.ts`
- `pnpm --filter @plot-pm/fleet exec tsc --noEmit -p .`
- `pnpm --filter @plot-pm/board exec vitest run --project parallel test/unit/continue-route.test.ts test/unit/agent-panel.test.ts test/unit/restart-route.test.ts test/unit/continue-control.test.ts test/unit/routes-are-thin.test.ts`
- `pnpm run typecheck`
- `node skills/plot/scripts/board/plot-local-checks.mjs`

The suites in the `CI suites` key run in CI. Do not run `test:e2e` locally.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. Append `→ #<number>` to the branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the seven files the plan lists under the slice: `continue-command.ts` and `restart-command.ts` (`packages/fleet/src/shared/`), `packages/fleet/src/server/entry/continue-command.ts`, `agent-panel.ts`, `AgentPanelFacts.tsx`, `skills/plot/scripts/README.md` (row `board/plot-continue-command.mjs` only) and `routes-are-thin.test.ts`, plus the test files named in the plan.

In flight, checked 2026-11-05: no open PR touches these files (#3076, #3105, #3169, #3171, #3172, #3173 read). #3112 merged and edited `skills/plot/scripts/README.md`; rebase on `origin/main` and keep every change there. `feature/partial-pulse-names-itself` (#3127) holds no branch yet and waits on this slice.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
