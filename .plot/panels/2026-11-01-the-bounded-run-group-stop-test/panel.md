# Panel moderation — the-bounded-run-group-stop-test

Subject: `docs/plans/2026-11-01-the-bounded-run-group-stop-test.md` (Draft, plan PR #3019, issue #3010). Jurors: layering, safety, testability, seams. Round 1.

**Reconciled: unanimous amend.** All four verdicts name `Position: amend`, and each passed the gate.

## What each juror looked at

| Juror | Read | Ran |
|---|---|---|
| layering | `bounded-run-process.ts`, the test and its stand-in, `worker-loop.ts` `onStop`, the other `boundedRunProcess` callers, the 2026-10-23 plan | `race-probe.mjs` against the real adapter at `origin/main`: main thread busy 1 s while the child's death and the caller's SIGTERM arrive in a set order. Linux (`node:26`, v26.13.0) child-first `SURVIVED` 2 of 2, SIGTERM-first 143 2 of 2; macOS `SURVIVED` in both orders. `race-control.mjs`: SIGTERM alone, or a caller with its own listener, gives 143. A partial scan of 100 failed `main` runs found 1 occurrence |
| safety | the adapter, the test, `plot-dispatch.sh --stop`, the 2026-10-23 plan, CI log of job 124912486260 | a timing script over 16 group stops of the real stand-in: handler 0–1 ms, `killTreeSync` 101–662 ms, exit 143 every time, `kill -0` reads the wrapper gone 2–6 ms after its `exit` event. A `pgrep` stub sleeping 3 s: exit after 3289–3528 ms, prompt and grandchild already dead. `ps` over the machine for leaked stand-ins. 300 `main` runs: 1 occurrence |
| testability | the test, the adapter, the CI job log and the systemd-unit job's timing for the same file | the named test at `origin/main` with a `pgrep` stub sleeping 7 s: the exact CI message in 6014 ms. A `node -e` probe of a synchronous stall across a deadline: `kill -0` reads a zombie alive and the `exit` event has not fired until one `setImmediate` later. 40 failed `main` runs: 1 occurrence |
| seams | the adapter, the test, the stand-in, open PRs, active plans, #3008 | a scratch script against the real adapter on macOS: child ends during a 1 s block, external SIGTERM at 0.5 s, `SURVIVED` 10 of 11; SIGTERM while the child runs, 143 in 5 of 5. Per-case timings from job 124912486260. 94 completed `ci.yml` runs on `main`: 1 occurrence. `git grep` counts of `kill(pid, 0)` probes |

Every juror ran a probe against real code. No juror ran the group-stop test itself on Linux with the real `pgrep`, and no juror reproduced the 2026-11-01 failure in its original form.

## What they agreed on

1. "Candidate causes, none yet measured" is wrong: at least one cause reproduces, and the plan must name it.
2. The zombie cause does not explain 5 s of live polling. The loop that runs the 50 ms poll also reaps the wrapper.
3. The current message calls any wrapper that has not ended by the deadline a survivor, and the plan's proposed message keeps that fault.
4. The 2026-10-23 plan approved the `exit`-event wait for the wrapper, and the merged test does not use it.
5. Open Question 2 rests on a false premise: the sibling tests already read the wrapper's `exit` event.
6. A green CI run proves nothing at 1 failure in about 100 runs; the fix needs a deterministic proof and a mutation check.

## Where they differed, and what the plan took

- **Which cause failed `main`.** Layering and seams reproduced a lost SIGTERM: `finish()` (`bounded-run-process.ts:139-144`) removes the last listener when the child closes, and a SIGTERM in the same batch is dropped. Safety and testability reproduced a slow stop: `killTreeSync`'s synchronous `pgrep`, slowed by a stub, gives the exact CI message. Testability argued against the lost signal on Linux: a group stop queues SIGTERM on the wrapper before the prompt can end, and Linux delivers signal 15 before 17. Layering's Linux probe agrees that SIGTERM-first gives 143, and gets `SURVIVED` only when it forces child-first. Seams used the CI timings: the failing case spent the full 5000 ms bound while the three signal-to-caller cases, each also running `killTreeSync`, took 282–351 ms on the same runner. That fits a lost signal better than a slow `pgrep`. **Neither cause is proven to be the 2026-11-01 failure.** Both are real defects in what they show. **Taken: both.** Slice 1 fixes the lost signal in production; slice 2 makes the test tell a slow stop from a survivor, so the next failure names its cause.
- **Where the fix lives.** Testability and safety put the fix in the test and the `killTreeSync` cost in a later plan. Layering and seams required an adapter slice in this plan, and said a test-only slice renames the failure at the same rate. **Taken: layering and seams**, with slice 2 waiting on slice 1.
- **How the adapter keeps the signal.** Seams proposed removing the listeners one `setImmediate` later, or one process-wide registration. Layering rejected the delay as a narrower window and required a process-wide listener with a live-run count that, with no run, re-raises the signal. **Taken: the process-wide listener with a count**, from layering. With no live run and another listener present, it returns and lets that listener act; with no other listener it exits `128 + n` rather than re-raising, so the regression test can read 143 as proof that the handler ran (testability, safety O1).
- **Which callers are exposed.** Layering found that the worker loop's `onStop` (`worker-loop.ts:2013`) adds its own listeners and does not lose the stop. Seams stated that none of the five callers registers its own SIGTERM handler. The moderator read `worker-loop.ts:2013-2019` and `:2508`: `onStop` adds `once` listeners on the process. **Taken: layering.** The other four callers' host processes are unchecked; slice 1's PR lists them.
- **The sibling tests.** Layering, testability and seams said the siblings need no change. Safety found their `exit` waits unbounded, so a surviving wrapper fails them only by vitest's timeout. **Taken: safety**, for the bound and the message only.
- **The reproduction.** Testability and safety asked for the `pgrep` stub on `PATH`; layering and seams asked for a forced signal order against the adapter. The plan's load loop had no support. **Taken: both**, one per slice. The forced order uses a state (`ps` reads the prompt as `Z`) rather than a sleep.
- **Teardown and arithmetic.** Only safety asked for a teardown by recorded pid, `TEST_TIMEOUT_MS` arithmetic, and `docker run --init`. Only seams asked to reuse `readyOf`. Only testability asked for the `setImmediate` yield and the verdict arms. **Taken: all**, in slice 2 or the Constraints.
- **Counts.** 1 of 100 (layering, partial), 1 of 300 (safety, CI runs), 1 of 40 failed runs (testability), 1 of 94 completed `ci.yml` runs (seams). The denominators differ and the figures do not conflict. The plan uses seams' 1 of 94 as the baseline.

## Shared blind spots

- **Nobody measured the order of the two signals in a real group stop.** Layering and seams forced the order; testability reasoned it from Linux's delivery rule. Node's own threads, and a wrapper that does not get the CPU, could change the order in which the signal pipe receives them; no juror tested that. The lost-signal cause on CI is an inference from timings, and the plan says so.
- **Every juror ran on an idle or local machine.** The CI case ran under `--coverage` on a shared runner. A slow `pgrep` there is reasoned from a stub, and nobody timed `pgrep` on a GitHub runner.
- **The four other `boundedRunProcess` callers are unread.** `review.ts:573`, `agent-run-for.ts:83`, `auto-fixer.ts:617` and `repair-start-world.ts:47` run in hosts whose listeners no juror checked. A host without a listener has lost stops in production since the adapter shipped, and nobody counted that.
- **`plot-dispatch.sh --stop` sends one SIGTERM and never checks the result** (safety). In production that makes this test the only guard against a survivor. The plan records it as a follow-up and not a slice.

## Outside the plan

Two processes from `.worktrees/free-b71b8ae4` were alive on the operator's machine: pid 75870 (`bounded-run-group-standin.mjs`, ppid 1, out file `/tmp/pgid-test/out.log`) and pid 75927 (`bounded-run-prompt.mjs`, its own group and session), both started 2026-10-23 11:24:39. Safety and testability saw them, and neither touched them. The operator removes them.

## Outcome

The plan is amended from this panel and records `- **Rounds:** 1`. `Type` is `bug`. Its slices are `bug/a-stop-that-lands-with-the-child-s-exit-still-stops` and `bug/the-group-stop-test-tells-a-slow-stop-from-a-survivor`, which waits on the first.
