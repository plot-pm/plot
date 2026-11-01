# The bounded-run group-stop test sees a live wrapper on main

> The group-stop test reads the wrapper's state only after the stop is delivered and a bounded wait has ended, with no fixed sleep, and a wrapper that really survives fails as a `boundedRun` defect.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** delivery-loop
- **Issue:** #3010
- **Review:** pr
- **Impl:** own branches

## Changelog

- Tests: `packages/domain/test/bounded-run-group-stop.test.ts` no longer fails with `wrapper <pid> survived the group stop` on a loaded runner, and a wrapper that really survives fails with a message that names `boundedRun`.

<!-- Board impact: none. Test file only; no plan-format, template, helper-script or board change. -->

## Motivation

The test `a group stop reaches boundedRun's child and its descendants › ends the wrapper, the prompt, and the prompt's own child, together` failed the checks job on `main` at `926339afd` (job 124912486260) on 2026-11-01:

    AssertionError: wrapper 66195 survived the group stop: expected false to be true

- 8670 of 8671 tests passed. The commit recorded a PR number for a plan and changed no code.
- The failed run made `main` red. `plot-ask.mjs merge` refused every merge with `default-branch-red` until a later commit read green.
- #2390 (#2380) fixed a 5 s timeout in the same test. This failure is a different assertion: the wrapper process is still alive when the test checks it.

## Design

### Approach

The test sends `SIGTERM` to the wrapper's process group, then calls `waitForExit(pid)` for the wrapper, the prompt and the grandchild. `waitForExit` polls `process.kill(pid, 0)` every 50 ms and gives up after a fixed 5000 ms. The wrapper assertion is the first of three and the only one that failed.

Two facts about the wrapper differ from the other two pids:

- The wrapper is a direct child of the test runner. `process.kill(pid, 0)` succeeds on a zombie, so a wrapper that has exited but is not yet reaped by the runner reads as alive. The prompt and the grandchild are not children of the runner, so `init` reaps them.
- The test holds the wrapper's `ChildProcess`, so its `exit` event is an exact answer that needs no polling.

The slice reads the wrapper's end from the `exit` event instead of from `kill -0`, keeps the polling wait for the two descendants, and bounds both waits with one named constant instead of the literal `5000`. The failure message then separates two cases: the wrapper's `exit` event never fired inside the bound (a `boundedRun` defect, named as such), and the event fired but a descendant is still alive.

The slice first reproduces the failure, then changes the wait. Candidate causes, none yet measured:

1. A zombie wrapper read as alive by `kill -0`.
2. A wrapper whose `SIGTERM` cleanup (read descendants first, then kill them) takes longer than 5 s on a loaded runner.
3. A wrapper that survives the signal. This is the defect case, and the test must report it as one.

The fix for cause 1 or 2 is in the test. The fix for cause 3 is in `boundedRun` and needs its own plan.

### Open Questions

- [ ] Which of the three causes produced the failure on 2026-11-01? A reproduction under load (a loop of the test beside a CPU hog, in a Linux container as in the memory note on CI-only failures) decides it before the wait changes.
- [ ] Do the two sibling tests that call `waitForExit` on a wrapper-owned pid (`--exit-normally` and the signal-to-caller cases) need the same change? The issue names only the group-stop test.

## Slices

### Group-stop wait

- `feature/the-bounded-run-group-stop-test` — read the wrapper's end from its `exit` event, bound the waits with one named constant, and word the failure so a surviving wrapper reads as a `boundedRun` defect

## Notes

- Source: tracker issue #3010. The plan stops at Draft; whether it is worth doing is the reader's decision.
- Definition of Done: docs/definition-of-done.md.
