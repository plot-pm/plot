# Juror verdict: tests

Lens: the proof. Does the plan's test fail on today's code on macOS and on Linux CI, does a stub prove anything about the real pipe, and what acceptance per slice catches a regression.

Position: amend

## Summary

The plan's central testing premise is false. It says Linux writes to a pipe synchronously, so "no test sees the truncation" on CI. I ran the reference fix's test logic in a Linux container (`node:24`, v24.21.0, kernel 6.12.54-linuxkit): the old ending truncates on Linux too, but as a race at 200 KB and deterministically at 1 MB. The repository also has a macOS CI job (`ci.yml:243-244`, `macos-shell-contract`, `runs-on: macos-latest`), so "CI runs on Linux" is only partly true. The plan's proposed proof, "one test that drives an entry through an asynchronous stdout stub", proves less than a cheaper, deterministic alternative: a preload probe that flags `process.exit` after any stdout write, run against the built bundles. The fix itself is right. The acceptance and the gate need to change before approval.

## 1. The problem (tests view)

- **Ran:** on macOS, `node -e "process.stdout.write('x'.repeat(1e6)); process.exit(10)" | wc -c` prints `65536`. With `process.exitCode = 10` instead it prints `1000000`.
- **Ran:** the same in `docker run node:24`: `exit` delivers `65536` to `wc -c`, and `exitCode` delivers `1000000`. `process.stdout.writableLength` reads `1000000` right after the write on Linux, so the write is queued, not synchronous.
- **Ran:** truncation rate under `spawnSync` (the reader the reference test uses), 30 runs per size:

| platform | 201,043 B | 1,000,000 B | 4,000,000 B |
|---|---|---|---|
| darwin (this Mac) | 30/30 cut | 30/30 cut | 30/30 cut |
| linux (Docker, default CPUs) | 19/30 cut | 30/30 cut | 30/30 cut |
| linux (Docker, `--cpus=1`) | 25/30 cut | 30/30 cut | 30/30 cut |

- So the Motivation sentence "Node writes to a pipe asynchronously on macOS and synchronously on Linux" is wrong as measured, and "CI runs on Linux ... so no test sees the truncation" is wrong twice: Linux sees it, and a macOS job exists. The defect is cross-platform. Caveat: I ran Linux in Docker Desktop's linuxkit VM, not on a GitHub `ubuntu-latest` runner. The behaviour comes from libuv's queued pipe write, which does not depend on the kernel build, but the plan should state where it measured.
- **Read:** 66 `process.exit(` lines in 59 files under `packages/*/src/server/entry/` on `origin/main` (ran a grep). The plan says 60 board lines plus 6 fleet files; the totals match.

## 2. The reference test from `da194bcaf`

- **Read:** `packages/board/test/unit/listing-walk-entry.test.ts` bundles `listing-walk.ts` with esbuild, pipes about 200 KB (50 rows of 4 KB) through `spawnSync`, and asserts exit 10 and the exact byte count.
- **Ran:** I took the shipped bundle `skills/plot/scripts/board/plot-listing-walk.mjs`, made an "old" copy by turning `process.exitCode=N(...)` back into `process.exit(N(...))`, and drove both with the test's exact input.
  - macOS: old `65536 of 201043` FAIL, new PASS, 3 of 3 runs.
  - Linux: old PASS, FAIL (`146176 of 201043`), PASS over 3 runs; new PASS 3 of 3.
- **Verdict on that test:** it is a correct regression test on macOS and a **flaky** one on Linux. At 200 KB it fails the old code on Linux in roughly two runs of three. A flaky-red test against old code is acceptable as a regression guard (it never flakes on the fixed code), but it is not a reliable "fails on today's code" proof, and at 1 MB it would be deterministic on both platforms. If the plan keeps real-pipe tests, raise the payload to at least 1 MB.

## 3. The plan's proposed test: an asynchronous stdout stub

- "Replace `process.stdout.write` with an asynchronous stub and assert the entry ends without `process.exit`" has three problems.
  - **Read:** every entry runs its main block only when `import.meta.url` equals `argv[1]` (`listing-walk.ts:76`, `transition.ts:347`, `local-checks.ts:205-209`). An in-process vitest import never reaches the ending. The test must spawn the entry, so a stub has to be injected into a child process anyway.
  - A stub proves nothing about the real pipe. It asserts that the code does not call `process.exit`, which is a text property. Once that is the assertion, the stub adds nothing: the probe below asserts the same thing on the real built bundle with the real stdout.
  - "One test that drives an entry" covers one of 59 files. The defect is per-entry, and the fix touches every entry. One test proves the pattern, not the slice.
- **Ran, a better mechanism:** a 6-line preload passed with `node --import probe.mjs <bundle>`. It wraps `process.stdout.write` to record that a write happened, and wraps `process.exit` to exit 99 with `exit-after-stdout` on stderr when a write came first. Against the listing-walk pair with a one-row input (a few bytes of output):
  - darwin: old `status 99 exit-after-stdout pending=0`, new `status 10`.
  - linux: old `status 99 exit-after-stdout pending=0`, new `status 10`.
- That is deterministic on both platforms, needs no large payload, and runs against the shipped bundle rather than a source transform. It also sees an exit inside a helper the entry calls, which the plan's own Open Question says a grep cannot.

## 4. Safety, as a test must catch it

- **Read:** some `process.exit` calls are control flow, not endings. `local-checks.ts:217` is `if (args.length === 0) process.exit(await run(...))`, followed by the `--files` branch and then `process.exit(EXIT.usage)` at `:222`. A mechanical swap to `process.exitCode = ...` at `:217` falls through, prints the usage line to stderr and ends with `EXIT.usage`. `transition.ts:352` (`--check-slices`) has the same shape and would fall through into `run(...)` at `:368`, writing a second answer. `review-bypass.ts:148` and `plan-for-branch.ts:47` are early refusals.
- The plan's rule "where the entry has nothing left to run" covers this in prose. A test must hold it: each entry's acceptance must assert the exit code and the exact stdout of every branch it touches, not only byte count. The reference test asserts the code (`toBe(ANSWERED)`) and that is the part to copy.
- A hang (a handle that keeps the loop alive once `process.exit` is gone) shows up in a spawned test only as a timeout. The probe harness should run each bundle with `spawnSync(..., { timeout })` and fail on `signal === 'SIGTERM'`, so a hang is a named failure and not a stalled suite. `worker-loop.ts:2598` and `desk-loop.ts:86` are long-running loops and are the likeliest to hold handles; I did not trace their handles.

## 5. The gate (slice 2)

- A shell grep cannot tell a stdout-then-exit from an early refusal or a control-flow exit (section 4), and cannot follow an exit inside a called helper. The plan already names that weakness as an Open Question.
- A grep gate also adds shipped-adjacent shell under `scripts/`. `scripts/check-*.sh` are repo gates, not shipped shell, so `check-shell-lines.sh` likely does not count them (I did not run it), but the CLAUDE.md direction ("Reduce shell, grow the domain") still argues against a new grep where a test does better.
- **Recommendation:** replace the `check-entry-exit.sh` slice with a test: one vitest file that, for every bundle under `skills/plot/scripts/board/` built from an `entry/` file, runs it under the probe with a fixture that reaches its answer path, and fails on `exit-after-stdout` or on a timeout. A new entry with no fixture fails the test by name (enumerate the entry directory and require a fixture per file), which is the ratchet the plan wants without an allow-list. Early refusals that write nothing to stdout pass the probe untouched, so no allow-list is needed for them.
- Where fixtures are expensive, the probe can also ride the existing process-level tests: 20 test files already spawn entries or bundles (ran a grep: e.g. `pr-state-entry.test.ts`, `merge-entry.test.ts`, `dispatch-command.test.ts`, `worker-loop-bundle.test.mjs`). Setting `NODE_OPTIONS=--import <probe>` in their spawn env turns every existing entry test into a drain check at no new fixture cost.

## 6. Slices against Changelog and acceptance

- **Entries slice.** Observable result: yes, a large answer arrives whole. Acceptance as written ("one test with an asynchronous stdout stub") is not checkable per entry and does not touch the real pipe. Amend to: (a) the probe harness over every entry bundle, red on today's code on both macOS and Linux (I ran it red on both for listing-walk); (b) one real-pipe test at 1 MB or more for the entries a shell caller parses, deterministic on both platforms per the table above; (c) exit code and stdout asserted for each branch that held a control-flow `process.exit`.
- **Gate slice.** As written it ships a grep that the plan itself doubts. Amend to fold the gate into the entries slice as the probe test above, or drop slice 2. If a second slice survives, its acceptance must name a mutation: re-introduce `process.exit` after a write in one entry and show the gate fails, per the repo's "mutation-test a gate before believing its tests" practice.
- **Motivation text.** Correct "synchronous on Linux" and "CI runs on Linux". Name the macOS CI job and decide whether the real-pipe test runs there.

## Named amendments

1. Replace the Linux-is-synchronous claim with the measurement: Linux truncates too (racy at 200 KB, 30/30 at 1 MB in Docker `node:24`); note `ci.yml:244` runs a macOS job.
2. Replace "one test through an asynchronous stdout stub" with a preload probe (`node --import`) over every entry bundle that fails on `process.exit` after any stdout write and on a timeout. Require a fixture per entry file so a new entry cannot skip it.
3. Raise any real-pipe test payload to at least 1 MB so it fails the old code deterministically on Linux as well as macOS.
4. Require each touched control-flow exit (`local-checks.ts:214-222`, `transition.ts:352/364/368`, `review-bypass.ts:148-152`, `plan-for-branch.ts:47-50`) to keep its exit code and stdout, asserted by test.
5. Drop the `scripts/check-entry-exit.sh` grep gate in favour of the probe test, or give it a mutation-test acceptance.
