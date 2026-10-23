# bounded-run-group-stop test times out at 5 s under CI load

> The group-stop test carries a timeout that covers a loaded runner and waits on process exit, so a slow CI machine no longer turns `validate` red.

## Status

- **State:** Approved
- **Sprint:** bugfix-2-28-1
- **Type:** bug
- **Issue:** #2380
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2381 merged
- **Started:** 2026-10-23, Jan Wloka, `bug/bounded-run-group-stop-test-times`

## Changelog

- Tests: `packages/domain/test/bounded-run-group-stop.test.ts` no longer fails with `Test timed out in 5000ms` when the runner is slow to start the stand-in.

<!-- Board impact: none. Test file only; no plan-format, template, helper-script or board change. -->

## Motivation

The test "a group stop reaches boundedRun's child and its descendants" › "ends the wrapper, the prompt, and the prompt's own child, together" failed CI with `Error: Test timed out in 5000ms` twice in two days:

- 2026-10-21, plan PR #2292 (run 39652704158), a PR that changed only a plan file.
- 2026-10-23, `main` at 4052903ee (run 39920891443), a commit that only annotated a plan.

The other 6539+ domain tests passed both times, and a rerun passed on #2292. Each failure turns `validate` red with no code change.

The test file shows where the 5000 ms goes. The test sets no timeout of its own, so it runs under vitest's default of 5000 ms. Inside that bound it does three things in sequence:

1. It spawns the stand-in with `--experimental-strip-types` and a loader (`spawnStandin`), and waits for `READY` (its own bound: 10 000 ms).
2. It sends the group `SIGTERM`.
3. It polls three pids for exit (`waitForExit`, default 5000 ms each, in parallel).

The inner waits add up to more than the outer bound, so the outer bound fires first whenever Node start-up, the loader or the kill is slow. The sibling test "ends the prompt and its descendants when its own bound fires" already carries `20_000` and says why its own bound is 4 s; the group-stop test has no such statement. The three signal tests below it (`SIGTERM`, `SIGINT`, `SIGHUP`) share the same shape and the same default.

The cause is read from the code, not reproduced. The slice starts by reproducing it under load.

## Design

### Approach

1. **Reproduce.** Run the file with the machine loaded (for example parallel `node --test` or `vitest` processes) and confirm the timeout fires in the group-stop test, and in which of the three steps above.
2. **Set a timeout that covers a loaded runner.** Give the group-stop test, and the tests that share its shape, a per-test timeout above the sum of their inner bounds (readiness 10 s + exit wait), written once as a named constant with a comment stating why.
3. **Wait on exit, not on the clock.** Where a step can wait on an event, wait on it: the wrapper's `exit` event for the wrapper, `waitForExit` for the descendants. The 5000 ms poll limit stays a bound that fails with a message naming the surviving pid, not the thing that ends the test.
4. **Keep the proof.** The test must still fail when `boundedRun` detaches the prompt. Mutate the adapter to `detached: true`, confirm the test fails, restore the adapter.

Domain-package style applies to anything written: arrow functions, factual comments.

### Open Questions

- [ ] Does the loaded-runner failure sit in the readiness wait, the exit poll, or both? The reproduction in step 1 decides which bound moves.
- [ ] Should the timeout constant be shared with the sibling tests in the file, or apply only to the group-stop test? One shared constant is the smaller diff.

## Slices

### Group-stop test timeout

- `bug/bounded-run-group-stop-test-times` — reproduce the timeout under load, then give `bounded-run-group-stop.test.ts` a stated per-test timeout and exit-based waits, keeping the detached-prompt mutation failing

## Notes

- Issue: https://github.com/plot-pm/plot/issues/2380
- Related, delivered: `flaky-process-timing-tests` (#1850) fixed five other process-timing tests; this test was not among them.
