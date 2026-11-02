# The reporter SIGTERM test fails on main one run in some

> `reporterShell` forks its reporter subshell with the default `SIGTERM` action, and the reporter ignores `SIGTERM` only once it runs its first command. A group `SIGTERM` in that window ends the reporter before it reports, which fails `reporterShell — … survives a group SIGTERM and reports 143 (20 runs)` and, in production, loses the desk's `WorkerMonitor` finding. The outer shell ignores `SIGTERM` after it forks the agent and before it forks the reporter, so the reporter starts with the ignore already set.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** delivery-loop
- **Issue:** #3033
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-02, Jan Wloka, plan-PR #3039 merged
- **Started:** 2026-11-02, Jan Wloka, `bug/the-reporter-sigterm-test-fails-on`

## Changelog

- A group `SIGTERM` that reaches a continued or restarted desk right after its start no longer loses the reporter's `WorkerMonitor` finding, and the reporter's group-`SIGTERM` test gives the same result on every run of an unchanged tree.

<!-- Board impact: none. One shell string in `packages/fleet/src/shared/continuation.ts` and its unit tests; no plan-format, template, helper-script-contract or board change. -->

## Motivation

CI failed twice in `checks` on the same test: run 41361916665 on `main` at `4d33c00dd`, and run 41376720118 on PR #3036 at `609cc0c34`. Both logs name `packages/fleet/test/unit/continuation.test.ts:736:75`, the one `expect(...).toBe(true)` in the test: after `process.kill(-rig.pgid, 'SIGTERM')`, the reporter must write its one `WorkerMonitor` finding within 5 s. The test passed on `4c182b6d0`, the first-parent predecessor of `4d33c00dd`, which only rebuilt bundles. The test came with #3027 (plan #3025).

A red `main` holds every merge (`default-branch-red`). The plan `fleetd-s-fixer-and-main-repair` is delivered on `main` at `8a767598b`, and issue #3028 is still open. The test loops 20 times, so a miss of 2 % per iteration fails about a third of runs.

The defect is also in production. `plot-dispatch.sh --stop` sends `kill -TERM -- -<pgid>` to a continued or restarted desk's group (`plot-dispatch.sh:1786-1804`), and that group holds the reporter. A stop in the window ends the reporter with no finding and leaves `.plot-worker.reporter.fifo` in the worktree until the next spawn removes it (`continuation.ts:1312-1318`).

## Design

### Cause measured

`reporterShell` (`continuation.ts:855-883`) forks the agent subshell, writes `$PLOT_PID_FILE`, then forks the reporter as `( trap '' TERM; … ) &` and exits. The ignore is set inside the child, after the fork. The test waits for the outer `sh` to exit and for `ready`, which the agent's command writes. Neither proves that the reporter has run its first command. A group `SIGTERM` that arrives first ends the reporter with the default action.

Four panel jurors reproduced the miss outside vitest, with `reporterShell` taken from `origin/main` and the test's own sequence (start, wait for the pid file and `ready`, group `SIGTERM`, wait for the finding):

| Shell | Before the fix | After the fix |
|---|---|---|
| macOS `/bin/sh` (bash 3.2), load about 5 | 34/600, 7/300, 5/200 | 0/600, 0/300, 0/200 |
| `/bin/dash`, 24 busy processes on 16 cores | 13/150 | 0/150 |

Every miss left exit file `143` (the agent's trap ran), no finding file, the FIFO still on disk and no process in the group. The reporter died before it armed its trap; it did not run late.

Two candidate causes of the first draft are refuted:

- **The 5 s bound is too short.** The failing test took 5709 ms and 5854 ms; a passing run takes 912 ms for 20 iterations, about 45 ms each. The failing iteration produced nothing for the whole 5 s. A dead reporter writes nothing at any bound, so a larger bound only makes the failure slower.
- **Delivery order across the group skips the reporter's trap.** An ignored disposition cannot be skipped by order, so this collapses into the pre-trap window above.

### Approach

The outer shell runs `trap '' TERM;` after `agent=$!` and the pid-file write, and before the reporter's `(`. An ignored disposition is inherited at `fork`, so the reporter starts with `SIGTERM` ignored and the window is zero by construction. The agent subshell is forked before that line, so it keeps the default disposition and its own `143` trap. `plot-dispatch.sh:1450-1455` states the same rule for the worker wrapper ("THE WRAPPER IGNORES SIGTERM, AND ONLY AFTER ITS CHILDREN EXIST"), and `:1507` applies it.

The fix changes production code, not the test rig. A readiness signal in the rig has nothing to wait on, because the reporter writes nothing before its trap, and adding a marker would put test instrumentation into the fleet's start path.

### Constraints

- The ignore never comes before `agent=$!`. A `trap '' TERM` before the agent fork makes `( ${cmd} )`, and with it `plot-worker-loop.sh` and `claude`, start with `SIGTERM` ignored, so a group stop ends nothing.
- The reporter's own inner `trap '' TERM` stays. It is redundant after the fix and documents the intent at the place that needs it.
- The TSDoc sentence at `continuation.ts:848-849` says the reporter starts with `SIGTERM` already ignored, and it states the placement constraint above.
- The 20-run test "survives a group SIGTERM and reports 143 (20 runs)" stays unchanged: its `ready` wait, its `5_000` bound, its 20 iterations and every assertion (one finding within 5 s, exit `143`, `finding: gone`, FIFO removed).
- The fix does not claim that the reporter always reports a group `SIGTERM`. The agent subshell has its own early window (see *Notes*), which the test's `ready` wait excludes.

### Proof

- A structural test beside "holds no sleep and no absolute path between the open and the tail" (`continuation.test.ts:653-662`): in `reporterShell(cmd)`, an outer `trap '' TERM;` appears after `agent=$!` and before the reporter subshell's `( trap '' TERM;`, and no `trap '' TERM` appears before the agent subshell's `(`. It fails on `origin/main`'s string on every run and passes after the fix.
- A behavioural test that the agent's command still dies on a group `SIGTERM`: the `cmd` process writes its own pid, as in the SIGKILL test at `continuation.test.ts:691-707`; after the group `SIGTERM` that process is dead and the exit file reads `143`.
- The existing 20-run test, unchanged.
- The PR records a before/after A/B of the group-`SIGTERM` sequence at a stated N of at least 300 iterations, original string against fixed string, on macOS `/bin/sh` and on Linux `dash` (a container, for example `debian:stable-slim`). The original must miss at least once and the fixed must miss zero times. If the original never misses on one shell, the PR says so and keeps the other shell's numbers. One green CI run is not the proof.

### Open Questions

- [x] Does the failure reproduce locally under load, or only on the CI runner? It reproduces locally at this machine's normal load (about 5 on 16 cores) with no stress harness: 34/600, 7/300 and 5/200 on macOS `/bin/sh`, and 13/150 under `/bin/dash` with 24 busy processes. Decided 2026-11-02 from the panel.
- [x] Is 20 iterations still the right count once the miss is fixed? Keep 20. After the fix the window is zero by construction, so the loop no longer multiplies a miss chance; it costs under 1 s green (912 ms) and still catches a regression that reopens the window. Decided 2026-11-02 from the panel.

## Slices

### Reporter ignores SIGTERM from its fork

- `bug/the-reporter-sigterm-test-fails-on` — set `trap '' TERM` in `reporterShell`'s outer shell after `agent=$!` and before the reporter fork, add the structural and agent-dies tests, and record the macOS and dash A/B counts in the PR

## Notes

- Source: issue #3033. A rerun of the failed job was requested; this plan does not depend on the rerun's result.
- Panel: `.plot/panels/the-reporter-sigterm-test-fails-on/`, round 1, unanimous `amend` (layering, safety, testability, seams).
- Follow-up outside this slice: the agent subshell has its own early-`SIGTERM` window before its `143` trap and before it forks `( cmd )`. With the fix applied and the signal sent with no `ready` wait, the agent subshell survived alone in 2/60 runs under `dash` (safety juror) and 2/200 and 3/200 runs on macOS `/bin/sh` (seams and testability jurors), and wrote `137` instead of `143` in 1/200 (seams juror). In production a surviving agent subshell reads as `running` and is never reported. It needs its own issue.
- Optional, not required: a stress case that sends the group `SIGTERM` the moment the outer `sh` exits, with no `ready` wait, and asserts only one finding, never the exit code, because the agent's window above makes that value depend on timing.
