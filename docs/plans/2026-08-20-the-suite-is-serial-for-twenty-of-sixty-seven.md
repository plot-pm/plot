# The suite is serial for twenty of sixty-seven files

> `pnpm run test:board` takes ~8 minutes and every rebase pays it again. Measured
> 2026-08-20: the 47 unit files run **43 s serially and 25 s in parallel**, and
> they are serial only because they share a config with the 20 browser files that
> genuinely need it. Turning parallelism on exposed a test that was never
> deterministic — the serial default was hiding a race, not preventing one.

## Status

- **Phase:** Draft
- **Type:** infra
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka

## Problem

Eight PRs merged on 2026-08-20 cost eight full suite runs, because each merge
makes the next branch's rebase necessary and each rebase invites another run. The
suite is the dominant cost of landing anything.

### Where the time is

| | measured |
|---|---|
| full `test:board` | ~8 min |
| 47 unit files, serial (today) | **43 s** |
| the same 47, `--fileParallelism` | **25 s** (−42 %) |
| vitest's own accounting, parallel | `tests 69.78s` inside `Duration 24.47s` |
| 20 browser files | the remainder, and genuinely serial |

`vitest.config.ts:16` sets `fileParallelism: false` for **all 67 files**, and the
comment states the reason honestly: *"The UI layer boots a server and launches
Chromium — generous timeouts, and no cross-file parallelism so server spawns
don't contend."*

That reason is real and it applies to 20 files. The other 47 spawn no server and
launch no browser; they wait on a constraint that is not about them.

### Turning it on found a race the serial default was hiding

Three parallel runs: **pass, fail, pass.** The failure, every time it appears, is
the same test:

    test/unit/worker-question.test.ts
      markerIn — reading the tree, and failing to
        › returns "" rather than rejecting when the search times out

It asserts that a search killed by its budget answers with the stated unknown. It
does so by giving `markerIn` a **1 ms budget** over a 2,000-file repo and
expecting the kill to win.

The test's own comment records the previous round of this bug:

> *"A two-file repo with a 1 ms budget passed on macOS and **FAILED on CI**, where
> `git grep` finished inside the millisecond and returned the marker it was
> supposed to be killed before finding — the test raced the thing it was
> asserting. Enough files that no runner finishes them in 1 ms makes the kill
> **deterministic rather than likely**."*

Two thousand files makes the race *less likely*, not impossible — and the comment
says as much in its own last three words. Under parallel load the machine is busy
enough that `git grep` sometimes still finishes first.

**A 1 ms budget against a real process launch is a race in every direction.** The
serial default did not make the test correct; it made the machine quiet enough
that the race usually resolved the same way.

## Design

### Two changes, and they are independent

**1. Split parallelism by directory.** Unit files run in parallel; browser files
stay serial for the reason the comment gives. Vitest expresses this with
workspace projects, so each keeps its own `fileParallelism` rather than the whole
suite taking the stricter of the two.

**2. Make the timeout test deterministic instead of probable.** What the test
means to assert is *a killed search answers `""` rather than rejecting* — that is
a property of the error path, not of the clock. Options, in order of preference:

- **Inject the kill.** Have `markerIn` take its search as a seam a test can make
  fail, so the assertion is about the handling and not the timing.
- **Make the search unfinishable rather than slow** — a FIFO or a directory the
  search blocks on. No file count to tune, so no runner can outrun it.
- Raise the file count again. **Declined**: it is the change that has already
  been made once, and it moved the failure from CI to parallel-local rather than
  removing it.

The choice needs a look at `markerIn`'s signature; the plan records the
preference and leaves the seam's shape to the branch.

### What this does not change

- **The browser files stay serial.** The Chromium contention the comment names is
  real and unmeasured here; nothing in this plan claims otherwise.
- **`testTimeout: 30_000`** stays. A browser test that boots a server needs it,
  and a unit file that needs 30 s is a separate finding.
- **No test is deleted or skipped.** The flaky one is repaired, not removed: what
  it asserts — a timeout answers with the stated unknown — is the
  `an-outage-is-not-an-answer` rule at the smallest scale.

### The other three levers are procedure, not code

Recorded so the measurement is not lost, but they need no branch:

1. **An artifact-only conflict does not need the full suite.** The rebuild's
   determinism plus CI's no-diff gate is the proof; a local 8-minute run adds
   nothing. Used on #287: touched files only, 259 tests, under 2 minutes.
2. **Rebase every green branch against one main, then merge in sequence** —
   rather than merge, discover the next is dirty, rebase, run, merge.
3. **Ask the board, not the scan.** `curl localhost:7777/api/board` answers
   instantly what `plot-fleet-scan.sh` takes 91–131 s to re-derive.

### Open Points

- [ ] Does any unit file actually depend on serial execution for a legitimate
      reason? Three runs found exactly one failure and it is a race, but three
      runs is not proof of absence.

## Branches

### Fix the race first
- `bug/the-timeout-test-does-not-race-the-clock` — the killed-search assertion stops depending on a 1 ms budget beating a process launch. Tests: a killed search answers `""` and does not reject; the assertion holds with the file count reduced to nothing, proving it no longer depends on search duration; it holds under `--fileParallelism`; ten consecutive runs agree.

### Then split
- `feature/unit-tests-run-in-parallel` — vitest projects separate the 47 unit files from the 20 browser files, so each carries the parallelism it needs. Tests: the browser project still runs serially; the unit project runs in parallel; the whole suite passes ten consecutive times; the suite's wall-clock is recorded in the PR so the next reader knows what it bought.

## Notes

Found by asking why landing eight PRs took a day. The parallel measurement was
taken to size a speed-up and returned a correctness finding instead — the more
useful of the two.

The flaky test is a small instance of a pattern this estate keeps producing: the
author saw the race, fixed it by making it improbable, and wrote *"deterministic
rather than likely"* while shipping the likely one. The word was already the
right one; only the mechanism fell short of it.
