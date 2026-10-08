## Implementation brief — the-fleet-loop-reads-its-runs-right (wave 4: A waiting run needs approval again)

- **Plan (canonical):** `docs/plans/2026-10-07-the-fleet-loop-reads-its-runs-right.md` on `main`
- **Approved:** 2026-10-07, jwloka, in-session
- **Branch:** `bug/a-waiting-run-needs-approval-again` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the last wave of four. Waves 1 (#1353), 2 (#1360) and 3 (#1365) are merged; nothing waits on this branch.

### What to build

The JS loop never shows "build needs approval". `readPass` returns `buildRun: checks === 'settled' ? run : null` (`packages/board/src/server/entry/worker-loop.ts:822`). A GitHub run that waits for approval has `status: waiting` and `conclusion: null`, so `checksFromRuns` answers `wait` and then `no-answer`, `buildRun` stays `null`, and the `waiting` arm of `buildFindingFor` (`packages/domain/src/rules/checks-verdict.ts:268`) is dead code (#1338). The caller at `worker-loop.ts:1451` reads `readings.buildRun` and publishes the finding through `desk.publishBuildFinding`.

Five changes, from the plan's slice 4:

1. **`buildRun` carries the run whenever the wait read one**, not only when the checks settle. The `waiting` finding must publish while the loop is still in `wait`. Check the other consumers of `buildRun` first (`git grep -n buildRun -- packages`): a non-settled run must not be read as a conclusion anywhere, and `checksPassed` and `correctionText` keep their `settled` guards.
2. **A test for `head moved`.** See the first decision below: the plan's wording and the code disagree, and the disagreement is yours to resolve in the code, not in the plan.
3. **Remove the stale comments** that name code #1337 deleted. The plan cites `plot-agent-manifest.sh:117-123`, but the lines moved: the stale text is now at `plot-agent-manifest.sh:118` and `:122` (`update_manifest_on_hop` in `plot-worker-loop.sh`, `assigned_branch` in `plot-worker-loop.sh`). Find the rest with `git grep -n "update_manifest_on_hop" -- skills`. Before you delete a reference, open the file it names: `plot-worker-loop.sh` still exists in `skills/plot/scripts/`, so only a reference to a function or file that is gone from it is stale. `manifest_resume_id` stays, because `session_handle` calls it.
4. **Remove the 9 always-skipped tests** in `test/reconcile/usage-limit.test.mjs` (`shellOnly(...)` at `:357`, `:407`, `:487`, `:524`, `:695`, `:728`, `:773`, `:821`, `:893`). Delete `shellOnly` (`:54`) and any helper only those tests use. Run `git grep -n shellOnly -- test` afterwards and expect nothing.
5. **`continue` stops the build monitor as well as the agent monitor.** `recordedMonitorPids` (`packages/board/src/server/continue.ts:545-552`) reads only `agentMonitorPid` from the manifest. A desk dispatched before #1337 also records `buildMonitorPid` for a running `plot-build-monitor.sh`, which still writes `.plot-worker.monitor.build.jsonl` beside the JS loop after a continue (issue #1338). Read both pids and pass both to `monitors.stop`. The monitor script no longer exists, so a stored pid may be dead or reused: reuse the stop path that exists (`desk-monitors-shell.ts:75`), and do not add a second kill.

### The decisions the plan settles — do not re-derive them

**`head moved` has no arm today, and the plan's wording asks for one.** The plan says "A test covers `head moved`" and its Done-when says "a run of another commit gives `head moved`". `buildFindingFor(run)` takes a run and no pushed sha, and `BuildFindingWord` (`checks-verdict.ts:228`) names three words, not four. `checksFromRuns` already reads a run whose sha is not `pushedSha` as no run (`checks-verdict.ts:215`), and the comment above `buildFindingFor` (`:240-247`) and `packages/domain/test/checks-from-runs.test.ts:206-209` both say the arm is excluded on purpose. `FindingNameSchema` (`packages/domain/src/entities/finding.ts`) already carries `head moved`, so the board can show it. Two honest ways to meet the Done-when: (a) give `buildFindingFor` the pushed sha and an arm for a run of another commit, or (b) publish `head moved` from the `tip-moved` verdict, which is the loop's own reading of "the remote tip is no longer the pushed commit". Pick the one the code supports, say which in the PR body, and update the comments and the test at `checks-from-runs.test.ts:206-209` that currently say the arm is absent. Do not leave the Done-when item unmet, and do not write a test that passes because the arm is unreachable.

**Do not re-add what the plan leaves out.** Issue #1338 also lists `timed_out` and `cancelled` mapping to `build failed`, and stale comments at `workerloop.test.mjs:485,1122` and `worker-loop.ts:974`. The plan's slice 4 names none of them. `buildFindingFor` is deliberately narrower than the shell on `build failed` (`checks-verdict.ts:249-257`), and wave 1 made a 0-step cancelled run a no-answer. Leave them. If you see one that blocks your change, report it.

**`buildRun` is a reading, not a verdict.** A non-null `buildRun` must not change what `agentLoop` decides. The decision reads `checks`, `checksPassed` and `correctionText`; `buildRun` feeds only the published finding. A change that makes a waiting run look settled hands the agent a correction for a run that has not started.

**Finding churn.** The loop publishes a finding only when the word changes (`lastBuildFinding`, `worker-loop.ts:1430-1475`). A run that waits for ten passes must write one `build needs approval` line, and a run that then starts must write `clear`. Assert both.

**Rules carried over unchanged.** Absent is not false: a `null` run and a run with no status are not a waiting run. Read the exit code, not the emptiness. A function you write or rewrite is an arrow. TSDoc states what an export does and how it fails; the reasoning goes in the commit message. `packages/domain/**` follows the Wave/Slice vocabulary in `docs/stories/the-master-agent-holds-the-fleet/`.

### Done when

The plan's `## Done when` item for this slice is the specification: a run with `status: waiting` gives the finding `build needs approval`; a run of another commit gives `head moved`. Assertions that exist because a naive implementation passes without them:

- **Drive it through `readPass` or the loop, not only through `buildFindingFor`.** `packages/domain/test/checks-from-runs.test.ts:243` already asserts `buildFindingFor({ status: 'waiting' })` and passes on `main` today; that is how the defect survived. The failing test must go through `worker-loop-run.test.ts` (or `worker-loop.test.ts`) with a build port that answers a waiting run, and assert the line the desk port received. Run it on `origin/main` first and watch it fail.
- **One line per change of word.** Several passes over the same waiting run publish once; the run starting publishes `clear`.
- **A waiting run spends no correction and ends no slice.** The decision on that pass is the same as for a pending run.
- **The generated bundles.** `skills/plot/scripts/board/board-server.mjs` and `plot-worker-loop.mjs` are generated. `pnpm build:board` rebuilds them for local tests only. Do not commit the rebuild (`scripts/check-no-bundle-diff.sh`).

Plus the repo's gates: a `'@plot-pm/board'` changeset and a `'plot': patch` (the manifest comments and the reconcile test ship), description first and the `bumps:` block last, with the `plan:` line inside the block. Run `scripts/check-changeset-packages.sh`. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base: this slice only removes comment lines from `plot-agent-manifest.sh`, so it stays under the base. The gate stores no number and has no override.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Use Node 24 (`nvm use`). Do not run board tests while an operator's board is open on this machine.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Where a project board is configured, set the PR to "Ready" with `plot-update-board.sh`. The PR body names issue #1338 and says which of the two `head moved` readings the branch took.

### Scope guard

This branch owns:

- `packages/board/src/server/entry/worker-loop.ts`: `readPass`'s `buildRun`, and the finding publish at `:1430-1475` if the `head moved` reading needs it.
- `packages/domain/src/rules/checks-verdict.ts` and `packages/domain/test/checks-from-runs.test.ts`: `buildFindingFor`, `BuildFindingWord`, and the comments that describe the missing arm.
- `packages/board/src/server/continue.ts` (`recordedMonitorPids` and its caller) and its test under `packages/board/test/unit/`.
- `packages/board/test/unit/worker-loop-run.test.ts` and `worker-loop.test.ts`.
- `test/reconcile/usage-limit.test.mjs` and the stale comments in `skills/plot/scripts/plot-agent-manifest.sh`.

Not this branch's: the checks reading of an unacquired run (wave 1, merged), the dollar parser (wave 2, merged), the charter at take-up and `.plot-worker.continue.md` (wave 3, merged).

Other branches in flight on origin at dispatch: `bug/local-checks-find-tests-in-a-temp-worktree` only (checked with `git ls-remote --heads origin`). Plan `a-controller-owns-what-it-starts` was delivered at `3edddc0be`. `continue.ts` changed last in #1351 (`9c344e414`), already on `main`. Rebase before the PR.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
