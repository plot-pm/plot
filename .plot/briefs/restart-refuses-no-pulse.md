## Implementation brief — restart-refuses-unknown-branch-when-it (wave 1: Restart names a missing pulse)

- **Plan (canonical):** docs/plans/2026-11-04-restart-refuses-unknown-branch-when-it.md on main
- **Approved:** 2026-11-04, Jan Wloka, plan-PR #3114 merged
- **Branch:** `feature/restart-refuses-no-pulse` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` on the PR, per `Review: pr`

This is the only branch of the plan. It waited on `bug/an-answer-records-its-true-author`; #3109 merged on 2026-11-05, so rebase on `origin/main` before the first edit to `continuation.ts` and `ContinueWithAnAnswer.tsx`.

### What to build

`restartBranch` (`packages/fleet/src/shared/restart-command.ts`) refuses `unknown-branch: no plan on this board names that branch` in two cases: the pulse lists no such branch, and no pulse exists to read. The second case blames the plan for a missing reading. Issue #3092 reports that refusal on the spike of a Design plan that names the branch. The code path that produces it is a `null` pulse: the CLI's `bridgedPulse` is `null` for a missing, foreign-version or older-than-15-min bridge file, and the board's `pulseFor` is `null` on a cold scan cache.

Add the refusal `no-pulse` (status 404, detail `no current fleet reading to look the branch up in`) for `input.pulse === null` and an empty `input.worktree`. Add `'no-pulse'` to `ContinueRefusal` and a case to the board's `refusalWord` switch. The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

- **The order is fixed.** Pulse `null` and no worktree → `no-pulse`. A non-null pulse that lists no branch and no worktree → `unknown-branch`. A found entry with no worktree → `no-worktree`. A `null` pulse WITH `input.worktree` set (`PLOT_RESTART_WORKTREE` from `plot-dispatch.sh --restart`, or a recorded desk path in `restart-stopped-command.ts`) continues as today. A check on `input.pulse === null` alone breaks that caller; the guard test below catches it.
- **The detail names the reading, not its writer.** The CLI reads a bridge file and the board reads a scan cache, so a detail naming either is false for the other caller.
- **Status 404, not 503.** No caller branches on the status: `plot-dispatch.sh:1841` exits 1 on any failure, `restart-stopped-command.ts` prints the reason, `RestartTheWorker.tsx` reads `body.ok` and `body.reason`. 404 keeps every restart lookup refusal in one class.
- **Board sentence, verbatim:** `No current fleet reading to look this branch up in — wait for the next fleet scan, then restart again.`
- **TSDoc:** `no-pulse` gets `/** No current fleet reading exists to look the branch up in. */`. `unknown-branch` becomes `/** The current pulse does not list this branch. */`.
- **Out of scope, and leave unchanged:** `continueBranch` and `agent-panel.ts:161-162` still refuse `unknown-branch` for a `null` pulse (#3117 follows this slice). A partial board pulse that does not list the branch still refuses `unknown-branch` (#3118). `git grep unknown-branch` over `packages`, `skills`, `test` and `docs` finds no caller matching on the restart refusal string; do not "fix" the other hits.
- **The union has no `default` in `refusalWord`** and the board compiles with `strict: true`. Forgetting the case fails `pnpm run typecheck`. That is the intended tripwire.
- **Function style:** any function you write is an arrow (`CLAUDE.md`, *The Domain Package*). No gate enforces it outside `packages/domain/src/`.

### Done when

The plan's `## Slices` lists the files and the tests; that list is the specification. The assertions that exist because a naive implementation would pass without them:

- `restartBranch({ opts, pulse: null, branch: 'x', worktree: '/w/x', caller: 'unattended' })` refuses `unattended` (409), not `no-pulse`. It touches no file system. It catches a guard on `pulse === null` that ignores `worktree`.
- A non-null pulse without the branch still refuses `unknown-branch` (`restart-command.test.ts:49-52`, unchanged). It catches a guard that turns every lookup miss into `no-pulse`.
- The `run(['nope'], ...)` entry test creates its repo with `fs.mkdtempSync(path.join(os.tmpdir(), 'plot-restart-nopulse-'))`, pushes it to the file's `dirs` list and removes it by that exact name.
- `restart.test.mjs:478-483` is renamed to `--restart refuses a branch with no fleet reading and no worktree, naming the refusal` and asserts `/no-pulse/`.

Plus: add a changeset for `plot` (patch) whose first line after the frontmatter is the plan's Changelog line, with the `bumps:` block last. Commit no generated bundle (`plot-restart-command.mjs`, `board-server.mjs`): `scripts/check-no-bundle-diff.sh` refuses it. The slice adds no shell lines, so `scripts/check-shell-lines.sh` is unaffected.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints, including the `scripts/check-*.sh` gates. The plan names five targeted commands for this slice:

- `pnpm --filter @plot-pm/fleet exec vitest run test/unit/restart-command.test.ts`
- `pnpm --filter @plot-pm/fleet exec tsc --noEmit -p .`
- `pnpm --filter @plot-pm/board exec vitest run --project parallel test/unit/continue-control.test.ts test/unit/restart-route.test.ts`
- `pnpm run typecheck`
- `node --test --test-name-pattern='--restart refuses' test/reconcile/restart.test.mjs`

The suites in the `CI suites` key run in CI. Do not run `test:e2e` locally.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. Append `→ #<number>` to the branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the six files the plan lists under the slice: `restart-command.ts` (shared and `server/entry/`), `continuation.ts`, `ContinueWithAnAnswer.tsx`, `skills/plot/scripts/README.md` (row `board/plot-restart-command.mjs` only), and the comment at `test/reconcile/fleetctl.test.mjs:505-508`, plus the five test files named in the plan.

In flight, checked 2026-11-05: #3112 (`bug/plot-approve-reads-the-plan-from`) edits `skills/plot/scripts/README.md`. Expect a textual rebase there if it merges first; keep both changes. No other open PR touches these files.

Line numbers in the plan date from 2026-11-04 and #3109 has merged since, so locate each edit by symbol, not by line. If you find something the plan did not anticipate, report it rather than improvising outside scope.
