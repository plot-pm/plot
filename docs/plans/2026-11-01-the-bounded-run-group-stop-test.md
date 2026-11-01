# The bounded-run group-stop test sees a live wrapper on main

> `boundedRunProcess` drops a SIGTERM that reaches its caller in the same event-loop turn as its child's end, and the caller keeps running. The adapter keeps that stop, and the group-stop test tells a slow stop from a surviving wrapper and names each.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** delivery-loop
- **Issue:** #3010
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #3019 merged
- **Started:** 2026-11-01, Jan Wloka, `bug/a-stop-that-lands-with-the-child-s-exit-still-stops`

## Changelog

- A process that runs a bounded child through `boundedRunProcess` no longer survives a SIGTERM, SIGINT or SIGHUP that arrives in the same event-loop turn as the child's end. It exits with `128 + signal number`, as it does while the child runs. A caller that has its own listener for that signal keeps its own handling between runs.
- Tests: `packages/domain/test/bounded-run-group-stop.test.ts` reads the wrapper's end from its `exit` event, and its failure message tells a wrapper that exits late from a wrapper that never exits. A wrapper that never exits fails with a message that names `boundedRun`.

<!-- Board impact: none. One domain adapter, its tests and a test fixture; no plan-format, template, helper-script or board change. -->

## Motivation

The test `a group stop reaches boundedRun's child and its descendants › ends the wrapper, the prompt, and the prompt's own child, together` failed the checks job on `main` at `926339afd` (job 124912486260, run 41328179417) on 2026-11-01:

    AssertionError: wrapper 66195 survived the group stop: expected false to be true

- 8670 of 8671 tests passed. The commit recorded a PR number for a plan and changed no code.
- The failed run made `main` red. `plot-ask.mjs merge` refused every merge with `default-branch-red` until a later commit read green.
- The assertion failed in 1 of the 94 completed `ci.yml` runs on `main` from 2026-10-31T17:44Z to 2026-11-01T20:02Z.
- The wrapper assertion is the first of three `expect` calls. Vitest stops at the first failure, so the prompt and grandchild assertions did not run on 2026-11-01, and the log does not say whether those two processes were alive.
- The failing case ran 5282 ms: about 280 ms to `READY` plus the full 5000 ms `waitForExit` bound. In the same run, the three signal-to-caller cases took 282, 351 and 308 ms, and each of them also runs `killTreeSync`.
- #2390 (#2380) fixed `Test timed out in 5000ms` in the same test. Its plan (`docs/plans/2026-10-23-bounded-run-group-stop-test-times.md`, Approach step 3) approved the wrapper's `exit` event as the wrapper wait, and the merged test still polls the wrapper with `waitForExit` (`bounded-run-group-stop.test.ts:134-138`). The record does not say why the step was dropped. Before #2390 the test ran under vitest's 5000 ms default, which equals the `waitForExit` bound, so a wrapper that never exited showed as a timeout. #2380's failures are consistent with the lost signal below; nobody re-read those runs.

## Design

### Causes measured

Four jurors ran probes in round 1. Two causes reproduce; the zombie cause does not.

1. **A lost SIGTERM (production defect).** `boundedRunProcess` adds `exitOnSignal` for SIGTERM, SIGINT and SIGHUP for each run (`packages/domain/src/adapters/bounded-run/bounded-run-process.ts:137`). `finish()` removes them when the child closes (`:139-144`, called on `close` at `:156`). With `stdio: ['ignore', out, out]` the child has no pipes, so `close` fires inside the SIGCHLD dispatch. When the child's end and the caller's SIGTERM reach the loop in one batch, child first, `finish()` removes the last SIGTERM listener, Node stops the signal watcher, and libuv drops the SIGTERM that is already queued. The caller keeps running.
    - Layering juror, against the real adapter at `origin/main`, main thread busy for 1 s while both signals arrive: Linux (`node:26`, v26.13.0) child-first `SURVIVED` 2 of 2, SIGTERM-first exit 143 2 of 2; macOS v26.13.0 `SURVIVED` in both orders. Controls: SIGTERM alone gives 143; a caller with its own `process.once('SIGTERM')` gives 143.
    - Seams juror, macOS: child ends during a 1 s block, external SIGTERM at 0.5 s: `SURVIVED` 10 of 11; SIGTERM while the child still runs: 143 in 5 of 5.
    - The worker loop does not lose the stop: `onStop` (`packages/fleet/src/server/entry/worker-loop.ts:2013`, called at `:2508`) adds its own `once` listeners, which keep the watcher alive. The test's stand-in (`test/fixtures/bounded-run-group-standin.mjs`) adds none, and it stays alive on its `setInterval` (`:64`). The other callers — `packages/board/src/server/entry/review.ts:573`, `packages/fleet/src/shared/agent-run-for.ts:83`, `packages/fleet/src/shared/auto-fixer.ts:617`, `packages/fleet/src/shared/repair-start-world.ts:47` — run in host processes that round 1 did not check.
2. **A slow stop.** The wrapper's `exit` listener runs `killTreeSync` (`bounded-run-process.ts:54-70`), which calls `execFileSync('pgrep', ['-P', pid])` once per tree node, with no timeout. Safety juror, 16 local runs: signal handler reached in 0–1 ms, `killTreeSync` 101–662 ms, exit 143 every time. A `pgrep` stub first on `PATH` that sleeps before it runs the real `pgrep` reproduces the exact CI message every time, with the prompt and grandchild already dead: safety with a 3 s sleep (exit after 3289–3528 ms), testability with a 7 s sleep (`× … together 6014ms`, `wrapper 2227 survived the group stop`). The current message calls this slow stop a survival.
3. **A zombie wrapper read as alive (refuted).** `kill(pid, 0)` read the wrapper gone 2–6 ms after its `exit` event (safety). `waitForExit` polls through `setTimeout` on the loop that reaps the wrapper, so a zombie cannot last 5 s of polling. It can last only across a synchronous stall at the deadline: a timer fires in the timers phase, before the poll phase that delivers SIGCHLD (testability, measured with `node -e`). The test slice closes that window with one `setImmediate` turn.

**Which cause failed `main` on 2026-11-01 is not proven.** Both spend the full 5000 ms bound. The siblings' 282–351 ms in the same run, each with its own `killTreeSync`, fit a lost signal better than a slow `pgrep`. On Linux a group stop queues SIGTERM on the wrapper before the prompt can end, and Linux delivers the lower-numbered pending signal first (SIGTERM 15 before SIGCHLD 17), so the child-first order needs more than a busy loop there; layering forced that order by sending the signals apart. Both causes are fixed or reported here, and the test's new message names the cause of the next failure.

### Approach

**Slice 1 is a production fix: a run never drops an ending signal.**

- The module adds one listener per ending signal for the process, on the first run, and never removes it. It counts the live runs. `finish()` decrements the count and removes no signal listener.
- The listener decides from the count and the other listeners:
    - one or more live runs: `process.exit(128 + n)`, as today, so the `exit` listeners kill each run's tree;
    - no live run, and the process has another listener for that signal: return, and let that listener act;
    - no live run and no other listener: `process.exit(128 + n)`. Without the adapter the signal's default action would end the process; the exit code 143 keeps the regression test's discriminator (143 means the adapter's handler ran).
- The effect on callers with their own listener: during a run, unchanged (the adapter still exits synchronously, as `onStop`'s comment at `worker-loop.ts:2005-2007` states). Between runs, the caller's listener alone acts, as today — `onStop`'s asynchronous cleanup, `packages/fleet/src/server/entry/pr-reader.ts:256`, and fleetd's `stopOnSignals` in `registryd-main.ts` keep their behaviour. The PR body lists each `boundedRunProcess` caller, its host process, and whether that host has its own listener.
- Removing the listeners one `setImmediate` later is not the fix: a signal that arrives between the read of the signal pipe and the removal is still dropped, so the delay narrows the window and does not close it.
- The port's doc comment (`ports/bounded-run.ts`) states the contract: a run never swallows an ending signal sent to its caller.

**Slice 2 is a test fix: the group-stop test tells a slow stop from a survivor.**

- The `exit` promise for the wrapper exists before `process.kill(-wrapperPid, 'SIGTERM')`, as at `bounded-run-group-stop.test.ts:215`. The wait helper checks `exitCode`/`signalCode` first, then the event, and races it against one named bound, `GROUP_STOP_BOUND_MS`. After the deadline it yields one `setImmediate` turn before it decides. `waitForExit` for the prompt and the grandchild yields the same turn and uses the same bound.
- When the bound expires without an `exit` event, the test waits a further named grace, `LATE_EXIT_GRACE_MS`, used only for the message:
    - the wrapper exits inside the grace with code 143: the message reads as a slow stop and gives the elapsed milliseconds;
    - the wrapper never exits: the message names `boundedRun` as the defect, and gives the wrapper's `ps -o stat=` and its child pids, so a reader can tell "stuck in its exit listener" from "ignored the signal";
    - the wrapper exits by `signal: 'SIGTERM'` with `code: null`: the message says that `boundedRun`'s handler did not run.
- One assertion carries all readings: the wrapper's `exit` code and signal, its elapsed milliseconds, and whether the prompt and the grandchild are alive. A verdict helper turns the readings into the message, and unit tests drive it from fixed readings.
- The group-stop test calls `readyOf` instead of its own inline ready-wait. `readyOf` gains the reject for a stand-in that exits before `READY` (now only in the inline copy at `:120-123`). The two other inline copies (`:150-161`, `:190-201`) call `readyOf` too, so no fifth form appears.
- The `--exit-normally` test and the three signal-to-caller tests already read the wrapper's `exit` event (`:166-168`, `:215`, `:221`), with no bound. Each gets `GROUP_STOP_BOUND_MS` and the same `boundedRun` message.
- The `afterEach` kills the wrapper's group and then the recorded `promptPid` and `grandchildPid` by pid, so a prompt that `boundedRun` detached into its own group does not outlive the test. It signals the group only while the wrapper's `exit` event has not fired or a recorded pid is alive.
- The deterministic reproduction is a `pgrep` stub inside the test's own `mkdtempSync` directory, first on the `PATH` that `spawnStandin` passes to the stand-in through a new `env` option. The stub sleeps, then runs the real `pgrep` found on the original `PATH`. No load loop and no CPU hog.

### Constraints

- Every bound stays finite, and a bound that expires fails the test. No retry, no second signal, no SIGKILL fallback and no longer bound turns a red case green: each would hide the lost signal.
- `TEST_TIMEOUT_MS` is greater than the readiness bound (10 s) plus `GROUP_STOP_BOUND_MS` plus `LATE_EXIT_GRACE_MS` plus 5 s, so the test's own message fires before vitest's timeout. With 5 s and 5 s, `TEST_TIMEOUT_MS` is 25 000.
- A regression test forces the signal order by state, never by a sleep or a busy loop of a set length.
- A container reproduction runs with `docker run --init`. Without a reaping PID 1, the reparented prompt and grandchild stay zombies and `kill(pid, 0)` reads them alive.
- New and changed functions are arrows; TSDoc states behaviour, not history.
- Slice 1 changes production code that the worker loop runs, so it carries a changeset for package `plot`. Slice 2 changes tests and a test fixture and carries none.

### Open Questions

- [x] Which of the three causes produced the failure on 2026-11-01? Two causes reproduce (lost SIGTERM, slow `pgrep`); the zombie does not (see *Causes measured*). The run's own evidence fits the lost signal better and does not prove it. The plan fixes the lost signal and makes the test name a slow stop, so the next failure, if any, names its cause. No load loop is needed.
- [x] Do the sibling tests that call `waitForExit` need the same change? The premise does not hold: they already read the wrapper's end from its `exit` event and poll only the prompt and the grandchild, which are not the runner's children. Their `exit` waits have no bound, so slice 2 bounds them and gives them the `boundedRun` message.

## Done when

Rows run in `pnpm --filter @plot-pm/domain exec vitest run <file>`. Every row asserts a state, not an elapsed time; every wait has a bound and fails by name.

| Claim | Input | Expected | Test | Slice |
|---|---|---|---|---|
| A SIGTERM after the child's end still ends the caller | stand-in mode `--late-signal`: after `READY`, in one synchronous block, it kills its prompt, waits until `ps -o stat=` reads the prompt as `Z`, then sends itself SIGTERM | the stand-in exits with code 143 inside the bound; on `origin/main` it stays alive (fails on macOS and in `node:26` with `--init`) | `packages/domain/test/bounded-run-late-signal.test.ts` | 1 |
| A second live run keeps the stop | two runs; the first child ends; SIGTERM | exit 143; both trees killed | `packages/domain/test/bounded-run-late-signal.test.ts` | 1 |
| A caller's own listener acts alone between runs | a stand-in with its own `once('SIGTERM')` that exits 7 after an `await`; one finished run; SIGTERM | exit 7, not 143 | `packages/domain/test/bounded-run-late-signal.test.ts` | 1 |
| No listener, no run: the process still ends | a stand-in whose run finished, no listener of its own; SIGTERM | exit 143 | `packages/domain/test/bounded-run-late-signal.test.ts` | 1 |
| A slow stop below the bound passes | `pgrep` stub sleeping 1 s | the test passes; the wrapper's `exit` gives code 143 | `packages/domain/test/bounded-run-group-stop.test.ts` | 2 |
| A slow stop past the bound reads as slow | `pgrep` stub sleeping past `GROUP_STOP_BOUND_MS` and inside the grace | on `origin/main`: `wrapper … survived the group stop`; on the branch: the slow-stop message with code 143 and the elapsed milliseconds | `packages/domain/test/bounded-run-group-stop.test.ts` | 2 |
| A surviving wrapper names `boundedRun` | verdict helper with readings "no `exit` event after bound and grace", and "`signal: 'SIGTERM'`, `code: null`" | each message names `boundedRun` and carries every reading | `packages/domain/test/bounded-run-group-stop.test.ts` | 2 |
| The wait survives a stall at the deadline | a child that exits; a synchronous stall past the bound; then the helper decides | the helper answers "exited"; `waitForExit` on `origin/main` answers `false` | `packages/domain/test/bounded-run-group-stop.test.ts` | 2 |
| The teardown leaks nothing | `detached: true` in `bounded-run-process.ts:111` (mutation); the group-stop test fails | `ps` shows no stand-in, prompt or grandchild after the run | manual, recorded in the PR | 2 |

**Mutation checks.** Slice 1: restore the per-run `removeListener` in `finish()`, and the first row fails. Slice 2: remove the `setImmediate` yield, or read the wrapper by `kill -0`, and the stall row fails; make the survival readings exit 143, and the survival row passes, which shows the row tests something.

**Delivery observation, not a test.** Before `/plot-deliver`, the deliverer reads the next 30 `ci.yml` runs on `main` after both slices merge and records how many failed this test, with the cause its message names. The baseline is 1 of 94 runs; the expected count is 0. At that baseline 30 clean runs prove little, so the count is an observation, and the deterministic rows above are the proof.

## Slices

### Late signal

- `bug/a-stop-that-lands-with-the-child-s-exit-still-stops` — `packages/domain/src/adapters/bounded-run/bounded-run-process.ts`: one process-wide listener per ending signal, a live-run count, no listener removal in `finish()`, the three-way decision in the Approach; the contract line in `packages/domain/src/ports/bounded-run.ts`; the `--late-signal` mode and the own-listener mode in `test/fixtures/bounded-run-group-standin.mjs`; `packages/domain/test/bounded-run-late-signal.test.ts`; a changeset for `plot`. The PR body lists each `boundedRunProcess` caller's host and whether it has its own listener. → #3023

### Group-stop wait

- `bug/the-group-stop-test-tells-a-slow-stop-from-a-survivor` <!-- waits: bug/a-stop-that-lands-with-the-child-s-exit-still-stops --> — `packages/domain/test/bounded-run-group-stop.test.ts` and its stand-in fixture only: the `exit`-event wait with the `setImmediate` yield, `GROUP_STOP_BOUND_MS` and `LATE_EXIT_GRACE_MS`, `TEST_TIMEOUT_MS` per the Constraints, the verdict helper and its message, `readyOf` with the early-exit reject for all four ready-waits, bounded sibling `exit` waits, the teardown by group and by recorded pid, the `pgrep` stub arms. No production change and no changeset.

## Notes

- Source: tracker issue #3010. Amended from panel round 1 (`.plot/panels/2026-11-01-the-bounded-run-group-stop-test/panel.md`, unanimous amend).
- **Order.** Slice 2 waits on slice 1. Alone, slice 2 renames the failure and leaves `main` red at the same rate when the signal is lost. The slices share no file with #3008's slices.
- Definition of Done: docs/definition-of-done.md.

**Left out, each a follow-up rather than a slice here:**

- `plot-dispatch.sh --stop` (`skills/plot/scripts/plot-dispatch.sh:1804`) sends one `kill -TERM -- "$stop_target"`, writes a `stopped` ending and exits. Nothing waits, checks that the group is gone, or sends SIGKILL, so a wrapper that hangs in its exit listener keeps its desk and claim while the ending file says `stopped`. It needs its own issue.
- `killTreeSync` calls `execFileSync('pgrep')` once per tree node, with no timeout. A hung `pgrep` gives a wrapper that never exits. A timeout, or one read of the process table, is its own change.
- 23 test files probe a pid with `process.kill(pid, 0)` and a local helper; 15 also carry a deadline. A shared zombie-aware helper per package is a separate decision; the domain tests cannot import the board's or the fleet's helpers.
- Two processes from `.worktrees/free-b71b8ae4` (pids 75870 `bounded-run-group-standin.mjs` and 75927 `bounded-run-prompt.mjs`, started 2026-10-23 11:24:39, out file `/tmp/pgid-test/out.log`) were alive on the operator's machine on 2026-11-01. Two jurors saw them and left them; the operator removes them.
