---
'plot': patch
---

A wedged CI run says what it was holding.

`test:reconcile` cancels at the job ceiling in **10 of 16 observed runs**,
reporting nothing: no step marked `failure`, `--log-failed` empty, and no
summary. The same commit passes **912/912 locally in ~7 minutes**, so the cause
is not in the assertions — and eight explanations have been eliminated by
measurement (the branch under test, `/tmp` pollution, leaked processes, a
too-short timeout, the server-starting tests, cross-file `pgrep` collisions,
contention between runs, runner slowness).

What every investigation lacked was evidence from **inside** a failing run.
Three changes supply it:

- **`--test-reporter=tap`** — node's default reporter buffers, so a killed job
  takes its output with it. TAP streams, so the last `# Subtest:` line before
  the silence NAMES what was running.
- **`timeout-minutes: 12`** on the step — a ceiling under the job's 25, so a
  wedge fails in half the time and leaves the diagnostic step something to run.
- **a `if: failure()` witness** — the process tree, any `.plot-worker*.log`
  written in the last 30 minutes, and the leftover fixture directories.

The reporter flag lives in the **script**, not in the workflow's `run:`.
`pnpm run test:reconcile -- --test-reporter=tap` appends the flag AFTER the
test glob, where node reads it as a script argument and ignores it — verified
by running it and seeing no TAP output. That version would have looked
instrumented and produced nothing.

This changes no assertion and fixes no test. It makes the next failure legible.

<!--
bumps:
  skills:
    plot: patch
-->
