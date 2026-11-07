# restart refuses unknown-branch when it has no current pulse

> `restartBranch` answers `no-pulse` when it has no current fleet reading and no named worktree, and keeps `unknown-branch` for a reading that does not list the branch.

## Status

- **State:** Released
- **Type:** feature
- **Sprint:** card-alignment
- **Issue:** #3100
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-04, Jan Wloka, plan-PR #3114 merged
- **Started:** 2026-11-05, Jan Wloka, `feature/restart-refuses-no-pulse`
- **Delivered:** 2026-11-05
- **Released:** 2026-11-07, v2.31.0

## Changelog

- `plot-restart-command.mjs` and `POST /api/restart` refuse `no-pulse: no current fleet reading to look the branch up in` when they have no fleet reading, instead of `unknown-branch: no plan on this board names that branch`.

Board impact: the board changes. `POST /api/restart` (`packages/board/src/server/restart.ts:64-68`) calls the same `restartBranch` with `pulseFor(opts)`, which is `null` on a cold board cache (`packages/board/src/server/fleet.ts:3301-3303`), so the board answers `no-pulse` too. `no-pulse` joins the shared `ContinueRefusal` union, and the board's `refusalWord` switch (`packages/board/src/app/components/ContinueWithAnAnswer.tsx:34-76`, no `default`, `strict: true`) gains a case, or `pnpm run typecheck` fails. The plan format, the template, the helper scripts and the `docs/plans` layout do not change.

## Motivation

`restartBranch` (`packages/fleet/src/shared/restart-command.ts:114-119`) refuses `unknown-branch` with the detail `no plan on this board names that branch` in two different cases:

- The pulse lists no such branch.
- No pulse exists to read.

The second case has two sources, one per caller:

- The CLI: `bridgedPulse` (`packages/fleet/src/server/entry/restart-command.ts:49-52`) returns `null` when `fleetStateFile().readSync()` answers no value. `parseBridge` (`packages/domain/src/adapters/fleet-state/fleet-state-file.ts:73-93`) returns `null` for a foreign version, a non-finite timestamp, an age below 0 or above `BRIDGE_MAX_AGE_MS` (15 min), and a pulse that fails `FleetReadingSchema`. `readSync` returns `null` for a missing or unreadable file. `restart-stopped-command.ts:43-46,102` reads the same bridge.
- The board: `pulseFor` returns `null` while the board's own scan cache is cold.

`branchFromPulse(null, branch)` then returns `null` (`packages/fleet/src/shared/continue-command.ts:28-29`).

The detail blames the plan. The cause is the missing reading. Issue #3092 reports `unknown-branch` on the spike of a Design plan that names the branch; nobody reproduced that run. `assemblePlanWalk` keeps Design plans in the pulse (`packages/domain/src/workflows/plan-walk-assembly.ts:19`, `:302-303`) and `branchFromPulse` has no phase filter, so a missing or stale reading is the code path that produces that refusal for a branch a plan names.

## Design

### Approach

Add the refusal reason `no-pulse`, with the detail `no current fleet reading to look the branch up in`, for the case where `input.pulse` is `null` and `input.worktree` is empty. `unknown-branch` stays for a non-null pulse that does not list the branch.

- The order in `restartBranch` is: pulse `null` and no worktree → `no-pulse` (404); pulse lists no branch and no worktree → `unknown-branch` (404); a found entry with no worktree → `no-worktree` (404). A pulse `null` with `input.worktree` set (`PLOT_RESTART_WORKTREE` from `plot-dispatch.sh --restart` at `skills/plot/scripts/plot-dispatch.sh:1839`, or a recorded desk path in `restart-stopped-command.ts:108-113`) does not refuse `no-pulse` and continues as today.
- The detail names the reading and not its writer, so it is true for both callers: the bridge file for the CLI, the board's scan cache for the board.
- The status for `no-pulse` is 404. Reason: no caller branches on the status (`plot-dispatch.sh:1841` exits 1 on any failure, `restart-stopped-command.ts:117` prints the reason, `RestartTheWorker.tsx:55-58` reads `body.ok` and `body.reason`), and 404 keeps every restart lookup refusal in one status class. A change to 503 later touches one literal and its tests.
- The board sentence in `refusalWord` for `no-pulse` is: `No current fleet reading to look this branch up in — wait for the next fleet scan, then restart again.`
- `no-pulse` joins `ContinueRefusal` (`packages/fleet/src/shared/continuation.ts:99-103`) after `unknown-branch`, with the TSDoc line `/** No current fleet reading exists to look the branch up in. */`. The `unknown-branch` TSDoc changes to `/** The current pulse does not list this branch. */`.
- Scope is the refusal reason, its detail and its board sentence. `restart` stays a controller for a claimed slice whose worker died. A never-started slice has no worktree, so a correct lookup still answers `no-worktree` for it (`restart-command.ts:120-122`).
- `continue` (`continueBranch`, `continue-command.ts:82-91`) and the agent panel (`packages/board/src/server/agent-panel.ts:161-162`) refuse `unknown-branch` for a `null` pulse too. This plan does not change them; #3117 carries that work and waits on this slice. Reason: the issue scopes `restart`, and the shared union and board sentence land here first, so the follow-up is a two-call-site change.
- A partial board pulse that does not list the branch still refuses `unknown-branch`. That is #3118, out of scope here.

### Callers and documents searched

`git grep unknown-branch` over `packages`, `skills`, `test` and `docs` on origin/main finds no caller that matches on the restart refusal string. `plot-dispatch.sh --restart` matches none. The hits that the slice changes are listed under the slice below. The hits for `continue` and the agent panel stay unchanged (#3117).

### Seams with open pull requests

- #3109 (`bug/an-answer-records-its-true-author`, open on 2026-11-04) edits `packages/fleet/src/shared/continuation.ts`, `packages/board/src/app/components/ContinueWithAnAnswer.tsx`, `packages/board/test/unit/continue-route.test.ts` and `packages/fleet/src/server/entry/continue-command.ts`. This slice edits the `ContinueRefusal` union and the `refusalWord` switch in the first two. The slice waits on that branch (the `waits:` marker on its branch line), and rebases on main after #3109 merges.
- #3112 (open on 2026-11-04) edits `skills/plot/scripts/README.md`. This slice edits row `board/plot-restart-command.mjs` (line 86 on origin/main) only. Expect a textual rebase on that file if #3112 merges first; keep both changes.

## Slices

### Restart names a missing pulse

- `feature/restart-refuses-no-pulse` <!-- waits: bug/an-answer-records-its-true-author --> — `restartBranch` refuses `no-pulse` when the pulse is `null` and no worktree is named; `no-pulse` joins `ContinueRefusal` and the board's `refusalWord`; tests and documents follow. → #3157

Files the slice changes:

- `packages/fleet/src/shared/restart-command.ts` — the `no-pulse` branch before `unknown-branch` in `restartBranch` (`:114-119`), and the TSDoc at `:102-113` names `no-pulse`, `unknown-branch` and `no-worktree`.
- `packages/fleet/src/server/entry/restart-command.ts` — the module doc at `:17-18` names `no-pulse`.
- `packages/fleet/src/shared/continuation.ts` — `ContinueRefusal` gains `'no-pulse'` with its TSDoc line.
- `packages/board/src/app/components/ContinueWithAnAnswer.tsx` — `refusalWord` gains the `no-pulse` case with the sentence above.
- `skills/plot/scripts/README.md` — row `board/plot-restart-command.mjs` (`:86`) says it refuses `no-pulse`, `unknown-branch` and `no-worktree`. Row `:85` (`continue`) stays.
- `test/reconcile/fleetctl.test.mjs:505-508` — the comment says the controller refuses `no-pulse` instead of `unknown-branch`. No assertion changes.

Tests that fail on origin/main and pass after the change:

- `packages/fleet/test/unit/restart-command.test.ts:54-57` — rewrite `refuses unknown-branch where there is no pulse at all` to `refuses no-pulse where there is no pulse and no named worktree`, asserting `{ kind: 'refused', status: 404, reason: 'no-pulse', detail: 'no current fleet reading to look the branch up in' }`.
- `packages/fleet/test/unit/restart-command.test.ts` — new test in `describe('the restart entry')`: `run(['nope'], repo, scriptDir, { pulse: () => null, worktree: '', caller: 'person' }, write, warn)` returns 1 and `warn` receives `plot-restart-command: no-pulse: no current fleet reading to look the branch up in`. `repo` is a `git init` directory from `fs.mkdtempSync(path.join(os.tmpdir(), 'plot-restart-nopulse-'))`, pushed to the file's `dirs` list and removed by that exact name.
- `test/reconcile/restart.test.mjs:478-483` — the sandbox has no bridged pulse and `never-dispatched` has no worktree, so the launcher now prints `no-pulse`. Rename the test to `--restart refuses a branch with no fleet reading and no worktree, naming the refusal` and assert `/no-pulse/`.
- `packages/board/test/unit/continue-control.test.ts:58-65` — add `'no-pulse'` to the `reasons` list, so `renders a distinct sentence for each` and `tells the reader what to do` cover it.
- `packages/board/test/unit/restart-route.test.ts` — new test: `handleRestart(request({ branch: 'nope' }), res, opts, { pulse: () => null })` answers `{ status: 404, body: { ok: false, reason: 'no-pulse', branch: 'nope' } }`.

Tests that pass before and after, and guard the order:

- `packages/fleet/test/unit/restart-command.test.ts:49-52` — a non-null pulse without the branch still refuses `unknown-branch`. Unchanged.
- `packages/fleet/test/unit/restart-command.test.ts` — new test: `restartBranch({ opts, pulse: null, branch: 'x', worktree: '/w/x', caller: 'unattended' })` refuses `unattended` (409, `continuation.ts:917-919`), not `no-pulse`. It touches no file system. It fails against an implementation that checks `input.pulse === null` without `input.worktree`.
- `packages/board/test/unit/restart-route.test.ts:52-56` — its stub pulse is non-null, so it keeps `unknown-branch`. Unchanged.

Checks the slice runs before it pushes:

- `pnpm --filter @plot-pm/fleet exec vitest run test/unit/restart-command.test.ts`
- `pnpm --filter @plot-pm/fleet exec tsc --noEmit -p .`
- `pnpm --filter @plot-pm/board exec vitest run --project parallel test/unit/continue-control.test.ts test/unit/restart-route.test.ts`
- `pnpm run typecheck`
- `node --test --test-name-pattern='--restart refuses' test/reconcile/restart.test.mjs`
- `node skills/plot/scripts/board/plot-local-checks.mjs` and what it prints, including the `scripts/check-*.sh` gates.

The slice commits no generated bundle: `skills/plot/scripts/board/plot-restart-command.mjs` and `board-server.mjs` are built on main (`scripts/check-no-bundle-diff.sh`). The slice adds no shell lines, so `scripts/check-shell-lines.sh` is unaffected. The slice adds a changeset for `plot` (patch) whose description is the Changelog line above.

## Notes

- Source: issue #3100, found by the panel on plan PR #3095 (`.plot/panels/2026-11-03-registry-never-hands-out-an-approved/`).
- Panel round 1: `.plot/panels/2026-11-04-restart-refuses-unknown-branch-when-it/panel.md` (four jurors, unanimous amend).
- Follow-ups: #3117 (`continue` and the agent panel), #3118 (a partial board pulse reads as `unknown-branch`).
- The slice branch builds no new deliverable, so it carries no `builds:` annotation. The deliverable search for `no-pulse refusal` found no existing artifact by that name.
