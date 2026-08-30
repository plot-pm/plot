---
'plot': patch
---

A wedged reconcile test names itself instead of consuming the whole CI job.

`test:reconcile` ran `node --test` over 41 files with **no timeout and no
concurrency bound**. `node --test` defaults to an infinite per-test timeout, so
one wedged test held the step until the job's `timeout-minutes: 25` ceiling
killed it.

**What that looks like is the problem.** The job reports `cancelled`, no step is
marked `failure`, `--log-failed` returns nothing, and `gh pr checks` renders it
as a bare red `fail`. The PR looks broken and the log says nothing about why.

**Measured 2026-08-30:** four PRs — #546, #547, #549 and a second run of #547 —
all cancelled at 25:14–25:17, every one wedged at *Reconcile contract tests*. On
healthy runs that same step takes **~2 minutes** and the whole job 12–14, against
the 25-minute ceiling. The step is not slow; it occasionally hangs. A `main` run
passed in 12 minutes while #547 hung concurrently, on the same code.

Two bounds, matching what `@plot-pm/board` already does:

- `--test-timeout=300000` — a hang becomes a named failure. Verified: a
  never-resolving test reports `test timed out after 2000ms` and the runner exits
  **1**, while a test declaring its own longer timeout keeps it. The largest
  explicit per-test timeout in this suite is 120 s, so no existing test is
  shortened.
- `--test-concurrency=4` — the board's suite has bounded this since it starved
  when files were added; this suite has 41 files spawning real repos and
  processes, and had no bound at all.

The slowest file, `fleet.test.mjs`, runs 128 tests in 194 s with zero cancelled
under the new default.

<!--
bumps:
  skills:
    plot: patch
-->
