## Implementation brief — flaky-process-timing-tests

- **Plan (canonical):** [docs/plans/2026-10-17-flaky-process-timing-tests.md](../../docs/plans/2026-10-17-flaky-process-timing-tests.md) on `main`
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1981 merged
- **Branch:** `infra/flaky-process-timing-tests` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review app, required on `main`)

One slice, no wave order. It touches test files only.

### What to build

Five open flaky-test reports in #1850 race a child process against a timer or a pid file. Each turns `main` red under load. Fix each in its own commit, with a stress run that fails without the fix.

- **#1544:** the temp-path kill test keeps a 2 s margin under its grace period. Files: `test/reconcile/temp-paths-gate.test.mjs`, `packages/domain/test/run-script.test.ts` (`killGroup(leader, 2_000)` near `:266`; the comment at `:226` already notes `gone()` polls 10 s after the 2 s grace).
- **#1594:** the KILL-after-TERM test waits for TERM to arrive. Bound the loop or race it with a timer (L1).
- **#1676:** the process-group stop test reads `child.pid` before the pid is written. Wait for the whole pid line and write the pid through a temporary file, then `mv`.
- **#1678:** `packages/domain/test/old-label-migration.test.ts` times out its 1 s unload bound. Raise the bound, or make the stub answer "gone" on the first poll.
- **#1704:** `packages/board/test/unit/continue-route.test.ts`, "increments relaunches across TWO relaunches" (`:463`). The cause is unknown.

The plan is canonical. This brief is orientation.

### Settled decisions — do not re-derive them

- **Wait on the event, not on a margin.** A fixed margin passes on an idle machine and fails on a loaded one. Wait for the pid line, the delivered signal or the first poll.
- **A later green run is no evidence.** Each fix needs a stated cause and a test that fails without the fix. Reproduce under load in a Linux container with `--cpus=4`.
- **#1704 may already be fixed.** `fb75fdd31` (#1802, "Board tests wait for their children before teardown") added `settle(wt)` to this very test (`:475`, `:199`). The issue verdict dates from `c40ac9e96`. Run the test under load on current `main` first. If it no longer fails, record that in the PR body and change nothing.
- **No source change.** If #1544 shows the grace period itself is too tight in production code, report it as a finding for its own plan. Do not edit `run-script.ts` here.
- **Atomic pid files.** Write to a temporary name, then `mv`. A reader then never sees a partial line.
- **Absent is not false.** A missing pid file means the child has not started. It does not mean the child is gone.
- **Arrow functions.** Any function you write or rewrite is an arrow, including in test files.
- **Clean up by exact name.** Remove temp entries by the path `mkdtempSync` returned, never by glob. `test:contracts` and `test:board` fail on a leaked entry.

### Done when

The plan's slice line is the specification: five tests fixed, one commit per issue, each with a stress run that fails without the fix.

Assertions that exist because a naive implementation passes without them:

- Each fixed test passes N repeated runs under CPU load (`--cpus=4` container or a busy-loop neighbour), and the same N runs against the unfixed test fail at least once. Catches: a fix that only passes on an idle machine.
- A hung child fails the #1594 test within its bound. Catches: a loop with no upper bound that stalls the suite.
- #1678 asserts on the unload happening, not only on elapsed time. Catches: raising the bound until the test can no longer fail.

Plus: add a changeset if the repo requires one for test-only changes (check `docs/definition-of-done.md`; description first, `bumps:` block last). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite locally and do not run `test:e2e`. Run only the test names you touch: a whole-file `node --test` can stall.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should add no shell. Do not commit a rebuilt board bundle (`scripts/check-no-bundle-diff.sh`).

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

Owned: `test/reconcile/temp-paths-gate.test.mjs`, `packages/domain/test/run-script.test.ts`, `packages/domain/test/old-label-migration.test.ts`, `packages/board/test/unit/continue-route.test.ts`, the test that reads a process-group stop pid (locate it from #1676), the KILL-after-TERM test (locate it from #1594), and their helpers.

No other slice of this plan is in flight. Other briefs on `main` touch the reaper and desk markers; stay out of `packages/board/src/server/entry/reap.ts`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
