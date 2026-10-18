## Implementation brief — manifest-retry-and-race-findings (wave 1: Implement lock)

- **Plan (canonical):** [docs/plans/2026-10-17-manifest-retry-and-race-findings.md](../../docs/plans/2026-10-17-manifest-retry-and-race-findings.md) on `main`
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1968 merged
- **Branch:** `bug/the-implement-lock-covers-its-start` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

This wave leads the plan. `bug/a-continue-starts-one-loop` waits on it, because the continue start reuses the lock shape settled here. Do not start the continue lock in this branch.

### What to build

Issue #1528 lists six gaps around the implement lock that #1525 (`bug/the-implement-lock-lives-on-disk`) left. Re-check each against main first, fix the ones that hold with a test that fails on main, and record any that no longer holds in the PR with the command that showed it. Measured against main at `e05c03256`, all six still hold in substance; the line numbers in the issue are stale because #1525 and #1695 moved the code.

1. **The real detached path has no test.** Every `runDetached` test in `packages/fleet/test/unit/dispatch-command.test.ts` injects `deps.launch`, so `launchSelf` and the `--foreground` argv switch in `packages/fleet/src/server/entry/dispatch-command.ts` never run. A launch without `--foreground` makes each child call `runDetached` again: a chain of detached processes with no end. Add one test that spawns the built entry (`skills/plot/scripts/board/plot-dispatch-command.mjs`, or the fleet entry the test graph builds) against a sandbox repo whose `Implement command` is `sh -c 'sleep 2'`, and asserts the parent exits 0 once the state file reads `running <pid>` and that exactly one implement process exists.
2. **A timeout leaves a live child.** `runDetached` returns 1 "did not start" after `startWaitMs` (30 s) while the detached child keeps going and can still take the lock and dispatch. An implement that ends inside one 50 ms poll also reads as a failed start. Name the child's pid in the timeout message, or end its process group on timeout; pick one and say why in the PR.
3. **A brief run takes no lock.** `askForBrief` in `packages/fleet/src/shared/brief-ask.ts` calls `startBoardRun` with `statePath: null`, so it runs beside a `startImplement` and both can write a brief for one plan. The brief run takes the same implement lock (`takeImplementLock` / `releaseImplementLock` in `implement-run.ts`) before it starts and releases it when `startBoardRun` reports the end. A brief that loses the lock logs why and returns `''`, as it does for an unopenable log.
4. **The lock is per checkout.** `implementLockPath` derives from `implementStatePath`, which derives from `agentLogPath(repoRoot, …)` → `agentLogDir(repoRoot)`, and every caller passes `--show-toplevel`. A call from a desk worktree and the board use different lock directories. Resolve the main checkout (`git rev-parse --git-common-dir`, then its parent) before building the lock path, and keep the log and state paths where they are unless the lock cannot be found otherwise.
5. **`ImplementButton.tsx` shows a 409 as failed.** `/api/implement` answers 409 to a second start (`packages/board/src/server/implement.ts`, `json(started.failure.running ? 409 : 500, …)`), and `run()` in `packages/board/src/app/components/ImplementButton.tsx` sets `failed` for any non-OK answer. Map a 409 whose body is the running refusal to the running state. Other 409s (`no-implement-command`) stay failures.
6. **The default `briefBranch` resolver of `handleDispatch` has no test, and its `slug` parameter shadows the outer one** (`packages/board/src/server/dispatch.ts`, the `(o, slug) => briefBranchFromPulse(pulseFor(o), slug)` default). Rename the inner parameter and add a route test that leaves `deps.briefBranch` unset and asserts the branch the run receives as `PLOT_BRIEF_BRANCH`.

### The decisions the plan settles — do not re-derive them

**The lock shape set here is the shape the continue start reuses.** The plan's Design says the continue lock is taken "in the same shape #1528 settles for the implement lock, so the two do not diverge." So the main-checkout resolution in item 4 goes into one helper that a second caller can import, not into `implement-run.ts` as a private detail.

**The lock stays a file read by pid and start time, not a `Set` and not a lock manager.** #1525 settled this (`lockHolds`, `processProbeSystem`, `publishLock`); `implementRunning` already answers across processes. Do not reopen it. Items 3 and 4 widen who takes the lock and where it lives, and change nothing about how a holder is judged live.

**A refusal is the end of that action.** A brief or an implement that loses the lock does not retry, wait, or truncate the winner's log. `startImplement` already takes the lock before it truncates the log; the brief run keeps that order.

**Rules carried over unchanged:** absent is not false (an unreadable lock holds nothing, but a probe that could not ask is not "dead"; follow `lockHolds`' `null` handling); read the exit code, not the emptiness; `plot-ask`-style bundles read the file, never `jq` over it.

**Style:** a helper you write or rewrite is an arrow. A neighbouring `function` declaration stays untouched. Comments state interface, not history.

### Done when

The plan's `## Done when` list is absent; the plan's Slices line is the specification: *the six gaps in #1528, ending with a real detached-start test and the 409 mapped to running.* Concretely:

- A test spawns the built entry as a real process and proves `--foreground` stops the chain: one implement process, parent exits 0. It must fail if `launchSelf` omits `FOREGROUND`. Mutate it once and watch it fail.
- The timeout message names the child's pid (or the child is ended); a test drives `startWaitMs` to a small value with a launch that never writes the state file and asserts the message or the ended child.
- A brief run and an implement for one slug cannot both hold the lock: start one, assert the other is refused, and assert the winner's log is untouched. A dead holder's lock does not block the brief.
- A call from a desk worktree and a call from the main checkout read and write the same lock file. The fixture needs a real `git worktree add`, since a path-string fixture proves nothing.
- A component or route test shows a 409 running refusal rendering as running, and a 500 rendering as failed.
- The default `briefBranch` resolver is exercised through `handleDispatch` with no injected `briefBranch`.

Gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. This branch touches `packages/fleet/src/**` and `packages/board/src/**`, so expect the fleet and board vitest and typecheck entries. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e` locally. Add a changeset for `plot` with the description first and the `bumps:` block last. `scripts/check-shell-lines.sh` refuses growth of shipped shell; this slice touches no `.sh` file, and if that changes, remove an equal number of lines elsewhere in the same change.

### Bookkeeping

Open the PR through the controller once the branch holds a commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### Implement lock` in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/fleet/src/shared/implement-run.ts`, `packages/fleet/src/shared/brief-ask.ts`, `packages/fleet/src/server/entry/dispatch-command.ts`, `packages/board/src/server/dispatch.ts`, `packages/board/src/server/implement.ts`, `packages/board/src/app/components/ImplementButton.tsx` and their tests.

Other branches of this plan, all later waves, are not started and hold `packages/fleet/src/server/entry/continue*.ts`, `continue-route.test.ts`, `plot-dispatch.sh` and the continuation modules. Do not touch them. If you find something the plan did not anticipate, report it rather than improvising outside scope.
