---
"@plot-pm/board": patch
---

plot-worker-state: a PR outranks a non-zero exit, about the TASK only

Measured 2026-08-24 on `bug/the-agents-tab-filters-on-membership`: a worker was
killed (SIGTERM, exit 143) **after** its work was complete and pushed, with PR
#393 open. The row rendered `worker crashed · someone is on it` and could never
stop saying it — nothing about that branch would ever change a recorded exit
code, so the row was frozen on a claim that was already false when written.

**The exit code and the row answer different questions.** The code says how the
PROCESS ended; "someone is on it" is a claim about the WORK. Those come apart
exactly when a finished worker is killed, and `has_pr` was consulted only in the
`0)` arm — every other code returned `failed` without ever asking whether the
branch had shipped. The comment above that arm explains why exit 0 was the one
refined ("the blurred one"), and it is right about the process; the gap is that
one caller renders a task claim from a process verdict.

**The failure is not hidden.** With no PR fact this stays `failed` — calling a
genuine crash finished is the mistake in the other direction, and it is the one
this must never make. A PR is the single fact that licenses the upgrade, because
a PR means the work reached a reviewer. The exit code is still reported in the
third field, so a reader can still see the worker was killed; only the state
word changes.

The test asserts both directions from one fixture: `exit 143` with no PR fact is
still `failed`, an explicit "no" is still `failed`, and only `pr` reads
`finished` — plus that 143 survives in the triple. It calls the classifier
directly rather than through a consumer, because the table test drives the scan
with `--offline` and plot-dispatch off disk, so neither can ever supply `pr`.

<!--
bumps:
  skills:
    plot: patch
-->
