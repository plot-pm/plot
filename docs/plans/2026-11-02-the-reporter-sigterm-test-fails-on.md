# The reporter SIGTERM test fails on main one run in some

> `reporterShell — … survives a group SIGTERM and reports 143 (20 runs)` failed once on `main` at `4d33c00dd` and passed on the commit before it. The plan finds which of its waits misses and makes the test give the same result on every run of an unchanged tree.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #3033
- **Review:** pr
- **Impl:** own branches

## Changelog

- The reporter's group-`SIGTERM` test reports the same result on every run of an unchanged tree. A timing-dependent miss no longer turns `main` red.

<!-- Board impact: none. One fleet unit test, and possibly the reporter shell string it runs; no plan-format, template, helper-script-contract or board change. -->

## Motivation

CI on `main` at `4d33c00dd` failed in `checks` (run 41361916665, job 125014338508). One test of 1804 failed: `packages/fleet/test/unit/continuation.test.ts > reporterShell — the reporter waits on a held descriptor > survives a group SIGTERM and reports 143 (20 runs)`, with `AssertionError: expected false to be true`. The same test passed on `4c182b6d0`, one commit earlier, which only rebuilt bundles. The test came with #3027 (plan #3025).

A red `main` holds every merge (`default-branch-red`), and fleetd's main-repair cannot start until #3028 lands. The test loops 20 times, so one rare miss per run fails the whole test; a miss that has a 1 % chance per iteration fails about 18 % of runs.

## Design

### Approach

The failure message names no line. Two `expect(...).toBe(true)` calls in the test can produce it, and only the first is unambiguous in the log:

- `expect(await rig.waitFor(() => rig.findings().length === 1, 5_000)).toBe(true)` (line 736): after `process.kill(-rig.pgid, 'SIGTERM')`, the reporter must write its one `WorkerMonitor` finding within 5 s.
- `rig.start` and the `ready` wait use `waitFor` too, but their results are not asserted, so a miss there surfaces later, as a missing finding or a wrong exit file.

Candidate causes to test, in order:

1. The 5 s bound is too short on a loaded CI runner, where the reporter must run its trap, write the exit record and start the monitor script.
2. The `SIGTERM` arrives before the reporter has installed its trap or opened the FIFO. The `ready` file proves the agent command started, not that the reporter wait is armed.
3. A signal delivered to the whole group reaches the reporter and the agent in an order that sometimes skips the reporter's trap.

The first slice reproduces the miss (a loop with CPU load, or `stress` of the group-`SIGTERM` path) and records which cause it is, before any fix. The fix follows the cause: a readiness signal in the rig for cause 2, a bound taken from the other `waitFor` calls for cause 1, a change to `reporterShell` for cause 3. A change to `reporterShell` is production code and needs its own review.

### Open Questions

- [ ] Does the failure reproduce locally under load, or only on the CI runner?
- [ ] Is 20 iterations still the right count once the miss is fixed? The count multiplies the chance of a miss, and the plan keeps it unless the reproduction shows the loop adds nothing.

## Slices

### Reproduce and fix

- `feature/the-reporter-sigterm-test-fails-on` — reproduce the miss, name its cause, and make the test deterministic

## Notes

- Source: issue #3033. A rerun of the failed job was requested; this plan does not depend on the rerun's result.
