---
"plot": patch
---

board: the killed-search test stops racing the clock

`markerIn`'s timeout assertion — *a search killed by its budget answers `""`
rather than rejecting* — reached that error path by giving a real `git grep` a
**1 ms budget** and expecting the kill to win. Three runs under
`--fileParallelism` went **pass, fail, pass**: on a machine busy enough, grep
sometimes finished first and returned the marker it was supposed to be killed
before finding. The serial default was not preventing that race, only keeping
the machine quiet enough that it usually resolved the same way.

**The file count never controlled the outcome.** The previous round of this bug
was fixed by raising the repo from two files to 2,000, with a comment claiming
the kill was then "deterministic rather than likely". Measured 2026-08-20
against that exact setup:

| repo | budget | who won |
|---|---|---|
| 2,000 files | 1 ms | the kill — assertion passes |
| 2,000 files | 50 ms | the kill — assertion passes |
| 2,000 files | 400 ms | **`git grep` — assertion fails** |
| **no filler at all** | 1 ms | the kill — assertion passes |

A bare process launch already exceeds a millisecond, so the 2,000 files were not
what made the test pass — spawn latency against the budget was, and neither is a
property of the module under test. The 400 ms row is the same race the CI
failure was, reached by moving the other variable.

`markerIn` now takes its search runner as a third parameter defaulting to
`execFile`, and the suite injects a runner that reports a kill the way `execFile`
does. The assertion is about the handling, so it holds with the repo reduced to
**one file and no filler**: if it ever depended on search duration again, the
absent 1,999 would be how it showed. Verified by raising the injected budget to
**60 s** — where the old test failed at 400 ms — with the assertions unchanged.

**One test became four, because the original conflated failures with different
causes.** Answering `""` and *not rejecting* are separate assertions: a rejection
inside `workerQuestions`' `Promise.all` loses every other branch's answer, not
just this one. `if (err && !stdout)` has a second half no kill test reaches — a
`grep -m1` that wrote its hit before the kill landed leaves an error **and**
usable output, and discarding it would turn a marker that was found into *reason
unavailable*. The fourth guards the seam itself: it asserts the caller's budget
still reaches the runner, without which breaking the timeout wiring is silent.

**The seam also made an existing test load-bearing.** Every killed-search test
injects its runner, so none would notice `markerIn` losing its `execFile`
default and spawning nothing. `finds a marker in a committed file` passes no
runner, so it is now the only proof that the seam has a production wiring — a
duty it did not have before, and its comment says so.

Each was checked against a deliberately broken implementation — wrong error-path
value (7 tests fail), budget not forwarded (**1** test fails, the one written for
it), default runner stubbed (4 fail).

Ten consecutive runs under `--fileParallelism` agree. This unblocks
`feature/unit-tests-run-in-parallel`, which the race would otherwise have made
intermittently red.
