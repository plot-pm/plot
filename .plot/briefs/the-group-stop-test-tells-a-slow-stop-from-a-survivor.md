## Implementation brief — the-bounded-run-group-stop-test (wave Group-stop wait)

- **Plan (canonical):** `docs/plans/2026-11-01-the-bounded-run-group-stop-test.md` on main
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #3019 merged
- **Branch:** `bug/the-group-stop-test-tells-a-slow-stop-from-a-survivor` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

This branch waits on `bug/a-stop-that-lands-with-the-child-s-exit-still-stops`
(Late signal), which has already merged to main (#3023). Nothing waits on this
branch.

### What to build

`packages/domain/test/bounded-run-group-stop.test.ts` currently reads one of
its three `exit`-event waits (the main group-stop test, `:120-123` for its
ready-wait) with no bound at all, and polls the other two trees
(`waitForExit`, pid-based) with a fixed 5 s bound whose failure message says
`survived the group stop` — which is true for a caller that really ignored the
signal, but also for a caller that is still inside a slow `killTreeSync`
(`pgrep` taking long with no timeout) when the deadline hits. CI hit exactly
this ambiguity on 2026-11-01: the wrapper assertion failed first, so Vitest
never ran the prompt/grandchild assertions, and the run's own log cannot say
whether those two were alive or not.

The fix is not a longer bound — the plan's Constraints rule that out
explicitly, because a longer bound just hides the same defect on a slower
machine. Instead the test needs to **tell the two causes apart and name
which one happened**: a wrapper that exits late (slow `pgrep`, harmless) vs. a
wrapper whose `exit` event never fires at all (the defect, now fixed in slice
1, but the test must still name it if it recurs).

### The decisions the plan settles — do not re-derive them

**The wrapper's exit is read from the `exit` event, never from
`waitForExit`/`kill(pid,0)` polling.** The zombie-read-as-alive cause was
investigated and refuted (Design › Causes measured, item 3): `waitForExit`
polls on the same event loop that reaps the wrapper, so a zombie cannot
survive 5 s of polling — it can only be misread across a single synchronous
stall at the exact deadline. The fix for *that* narrow window is one
`setImmediate` turn yielded after the bound expires, before deciding — not a
switch to pid-polling for the wrapper. `waitForExit` stays correct for the
prompt and the grandchild (they are not this run's direct child, so there is
no `exit` event to listen for on them).

**Two named timers, not one, and neither may grow to make a case pass.**
`GROUP_STOP_BOUND_MS` is the real bound every `exit` wait races against (plan
says every wait — including the `--exit-normally` test and the three
signal-to-caller tests, which today have no bound on their `exit` waits at
all). `LATE_EXIT_GRACE_MS` is a second, separate window entered ONLY once
`GROUP_STOP_BOUND_MS` has already expired with no `exit` event — and it exists
purely to produce a better message, not to let a slow case pass that would
otherwise fail. If the wrapper exits with code 143 inside the grace: message
reads as a slow stop, names the elapsed ms. If it never exits: message names
`boundedRun` as the defect, plus `ps -o stat=` and child pids. If it exits via
`signal: 'SIGTERM', code: null`: message says the handler never ran. Verify
your version by mutation per the plan: removing the `setImmediate` yield, or
switching the wrapper check to `kill -0`, must fail the stall row; forcing the
survival readings to report code 143 must make that row read as a slow stop
(not a survival) — showing the row is actually exercising the distinction and
not just checking for truthiness.

**`TEST_TIMEOUT_MS` is derived, not picked.** Plan's Constraints give the
formula explicitly: readiness bound (10 s) + `GROUP_STOP_BOUND_MS` +
`LATE_EXIT_GRACE_MS` + 5 s headroom. With both named timers at 5 s this is
25 000 ms — compute it from the two constants in code rather than hardcoding
25000, so a later change to either constant can't silently leave the test
timing out inside its own bound.

**One verdict helper, unit-tested from fixed readings — not three near-copies
of the same `if`/`else` inline.** The plan asks for "a verdict helper [that]
turns the readings into the message," with the readings being: the wrapper's
exit code and signal, elapsed ms, and whether the prompt/grandchild are
alive. Write it as a small pure function so its branches (slow-stop-in-grace /
never-exited / signalled-but-handler-didn't-run) can be driven directly in a
unit test with made-up readings, rather than only reachable by reproducing
timing in an integration run.

**`readyOf` absorbs all four inline ready-waits, including its own
early-exit reject.** The plan names four near-identical copies of "wait for
`READY <pid> <pid>` on stdout, reject if the stand-in exits first": the
existing standalone `readyOf` helper (currently missing the early-exit
reject, used only by the signal-to-caller loop at the bottom of the file) and
three more inline copies — the main group-stop test (`:106-123` in the current
numbering), the `--exit-normally` test, and the bound-fires test. Add the
reject-on-early-exit behavior to the one `readyOf` and have all four call
sites use it, so no fifth near-copy appears later. (Line numbers above are
from this read of the branch; re-check them against your checkout before
editing, since slice 1's merge may have shifted nothing in this file but
confirm rather than assume.)

**Deterministic reproduction is a `pgrep` stub on `PATH`, not a sleep loop or
CPU hog.** Constraints explicitly ban sleeps/busy-loops of a set length as the
*forcing mechanism* for signal ordering (that's `--late-signal`'s job, already
in the stand-in fixture, forcing by polling `ps -o stat=` for `Z` — reuse it,
don't re-derive it). But the **slow-stop** reproduction is different: it's a
`pgrep` binary, first on a `PATH` built inside the test's own
`mkdtempSync` scratch directory, that sleeps a configured amount then execs
the real `pgrep` resolved from the original `PATH`. Pass that `PATH` to the
stand-in via a new `env` option on `spawnStandin` (today `spawnStandin` takes
only `args`; add `env` as a second parameter, merged over
`process.env`). Two cases: a stub that sleeps 1 s must still pass (inside
`GROUP_STOP_BOUND_MS`, wrapper exits 143); a stub that sleeps past bound +
grace must produce the slow-stop message naming the elapsed ms, not a
"survived" message — and must reproduce byte-for-byte the CI assertion text
if you deliberately sleep past the whole window, proving the fixture
reproduces the exact failure mode. No change to `killTreeSync` itself —
that's explicitly left out of this plan as its own follow-up issue.

**`afterEach` kills the wrapper's group, then the recorded `promptPid` and
`grandchildPid` by pid directly** — not only the group — "so a prompt that
`boundedRun` detached into its own group does not outlive the test." Signal
each only while it's still plausibly alive: the wrapper's `exit` event hasn't
fired, or the recorded pid is alive. This guards against a leaked process
tree surviving a test failure and interfering with a later test's pid
reporting.

**No production code changes, no changeset.** This slice touches only
`packages/domain/test/bounded-run-group-stop.test.ts` and
`packages/domain/test/fixtures/bounded-run-group-standin.mjs`. Slice 1 (now
merged) already fixed the real lost-signal defect in
`bounded-run-process.ts`; this slice's job is purely to make the test's
*message* trustworthy for whatever fails next, and to bound every wait that
today has none.

### Done when

The plan's `## Done when` table is the specification — six rows run against
`packages/domain/test/bounded-run-group-stop.test.ts` via
`pnpm --filter @plot-pm/domain exec vitest run <file>`, plus one manual
teardown-leak row recorded in the PR body (no automated assertion for it: run
the suite, then `ps` for leaked stand-in/prompt/grandchild processes).

Two rows are easy to satisfy wrongly — watch for the mutation checks the plan
gives, which exist specifically to prove the row tests something real:

- Remove the `setImmediate` yield after the bound (or switch the wrapper
  check to `kill -0`) → the stall-at-deadline row must start failing.
- Force the survival readings to report `code: 143` → the survival row must
  now read as a *slow stop*, not a *survival* — if it still reads "survived"
  with code 143 present, the verdict helper isn't actually using the exit
  code to distinguish the two cases.

Plus the repo's standing gates: run
`node skills/plot/scripts/board/plot-local-checks.mjs` before each push and
run what it prints — it resolves which suites and `scripts/check-*.sh` gates
apply to the files this branch touches. List no full suite here; the
`CI suites` config key runs the rest in CI, and a failure there becomes a
correction, not a silent gap.

`scripts/check-shell-lines.sh` does not apply — this slice touches no `.sh`
file.

### Bookkeeping

Open the PR through the controller once there is a first real commit:

```bash
../plot/scripts/plot-open-pr.sh          # current branch, ready
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

It reads the plan, takes the wave heading ("Group-stop wait") as the PR
title, and puts the plan + this brief in the body. Do not run `gh pr create`
directly. Push the first real commit as soon as it exists — don't batch the
whole slice into one late push.

Once the PR exists, append `→ #<number>` to this branch's line under
`## Slices › Group-stop wait` in the plan file, on main.

### Scope guard

This branch owns exactly two files:

- `packages/domain/test/bounded-run-group-stop.test.ts`
- `packages/domain/test/fixtures/bounded-run-group-standin.mjs`

The sibling branch `bug/a-stop-that-lands-with-the-child-s-exit-still-stops`
(Late signal wave) owned `packages/domain/src/adapters/bounded-run/bounded-run-process.ts`,
`packages/domain/src/ports/bounded-run.ts`,
`packages/domain/test/bounded-run-late-signal.test.ts`, and the
`--late-signal`/`--own-listener` modes on the same stand-in fixture this
branch also touches — that branch is already merged (PR #3023, commit
`5ce7d31ba`), so its production fix is live on main and this branch builds on
top of it rather than racing it. The plan notes the two slices "share no file"
with issue #3008's slices.

If you find something the plan did not anticipate — e.g. the `--late-signal`
mode's existing polling loop in the stand-in interacting oddly with a new
`pgrep`-stub `PATH` override — report it rather than improvising outside
scope.
