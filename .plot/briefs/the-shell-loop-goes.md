## Implementation brief — the-worker-loop-runs-in-js (wave 6: The shell loop goes)

- **Plan (canonical):** `docs/plans/2026-10-04-the-worker-loop-runs-in-js.md` on `main`
- **Approved:** 2026-10-04, jwloka, in-session
- **Branch:** `infra/the-shell-loop-goes` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the last wave of its plan. Waves 1 to 5 are merged (#1279, #1282, #1292, #1314, #1330), and nothing waits on this one.

### What to build

`skills/plot/scripts/plot-worker-loop.sh` still holds the shell loop, 892 non-comment lines, behind a launcher that exits into `board/plot-worker-loop.mjs` unless `Worker loop` reads `shell`. Since #1330 the default is `js`, so the body runs only for a repository that names `shell` and for the tests that source it. Two processes the JS loop does not need still run beside every dispatched agent: `plot-dispatch.sh` starts `plot-build-monitor.sh` for each desk (`:1491`) and writes its pid as `buildMonitorPid` (`:1588`), in both loop modes. The change removes the shell body, the monitor and everything that exists only for them, and leaves `plot-worker-loop.sh` as a launcher that `exec`s the JS entry and decides nothing.

Measured on `main` at `94671a6e9`, 2026-10-07. The plan's removal list is the specification; this brief adds what the list leaves out.

**1. The JS loop must write the build findings before the monitor goes.** The board reads `.plot-worker.monitor.build.jsonl` (`MONITOR_LOGS` in `packages/board/src/server/findings.ts`) and shows `build failed`, `build passed`, `build needs approval` and `head moved` from it. Only `plot-build-monitor.sh` writes that file today. `git grep` finds no `build failed`, `build passed` or `head moved` in `worker-loop.ts`, `loop-writes.ts`, `agent-loop.ts` or `packages/domain/src/adapters`. Remove the monitor first and those four findings vanish from the board with no error. The JS loop's CI wait already reads the runs through the build connector (`checksFromRuns`); it publishes a finding in the same form (`FindingSchema`, monitor `BuildMonitor`, branch, evidence, `since`) at the moment each reading settles, and publishes `clear` when a finding stops holding. `findings.ts` and `currentFindings` stay unchanged.

**2. The monitor's tests are ported, not dropped.** `test/reconcile/buildmonitor.test.mjs` is the only place the four findings, `action_required` and the head-moved retraction are asserted. Port each case to a test of the JS writer against a `BuildPort` fixture, and say in the PR which case maps to which. A case that cannot be ported is a behaviour the plan did not list: report it.

**3. The pieces the plan lists, as `git grep` finds them today.** The plan's pathspec is `-- . ':!docs' ':!.plot' ':!CHANGELOG.md'`. Files it lists on the day, outside the generated bundles:

- shell: `plot-worker-loop.sh`, `plot-build-monitor.sh`, `plot-monitor-subject.sh` (its header names the monitor), `plot-agent-manifest.sh` (`manifest_count`, `raise_manifest_count`, `manifest_resume_id`), `plot-dispatch.sh` (monitor start and `buildMonitorPid`), `plot-transcript-quiet.sh`, and `plot_worker_idle_watch_pass`, `plot_worker_conversation_spoken` and `plot_worker_publish_finding` in `plot-worker-state.sh`;
- board: `schema.ts`, `continue.ts`, `manifest-stamp.ts`, `registry.ts`, `entry/checks-verdict.ts`, and `build.mjs`, `package.json`, `.gitignore`, `.gitattributes` and `contract/bundles.generated.ts` for the removed bundle and the two vendored scripts;
- domain: `adapters/desk-monitors/desk-monitors-shell.ts` and `ports/desk-monitors.ts` (the adapter starts the BuildMonitor and returns its pid), `entities/finding.ts` (its comment), `adapters/transcript/transcript-fs.ts` and `ports/transcript.ts` (comments naming the shell reader), `corpus/desk-manifest.corpus.test.ts`, `corpus/transcript.corpus.test.ts`, `corpus/production.ts`, `corpus/desk-reset.corpus.test.ts`;
- CI and tooling: `.github/workflows/ci.yml` (`PLOT_WORKER_LOOP_SOURCED`, `PLOT_TEST_WORKER_LOOP`, the `loop-js` job), `scripts/count-master-diagnosis.mjs`, `skills/plot/scripts/README.md`;
- tests: the 14 `test/reconcile` files and the `packages/board` and `packages/domain` unit tests that the grep finds, plus `test/reconcile/loop-switch.mjs` and `test/e2e/worker-monitor-samples.test.mjs`.

**4. Readers of the `Worker loop` key the plan does not list.** `packages/board/src/server/runner-gate.ts` reads the key (`:18`), `dispatch.ts:383` and `continue.ts:640` apply its refusal, and `packages/domain/src/rules/runner-choice.ts` words it. All of it answers one question: may `Agent runner: sdk` run under `Worker loop: shell`. With no shell loop the answer is always yes. Remove the shell arm and its tests (`runner-gate.test.ts`, `runner-choice.test.ts`, the dispatch and continue cases) together with the key, so the key is read nowhere, and name the removal in the PR. `skills/plot-dispatch/SKILL.md:207`, its README, `plot-config.sh:148`, and this repository's `## Plot Config` line `- **Worker loop:** js` in `CLAUDE.md` name the key too; `AGENTS.md` is generated from `CLAUDE.md` with `./scripts/check-agents-md.sh --write`.

### The decisions the plan settles — do not re-derive them

**Delete the shell loop; do not keep it behind a flag.** The key's whole purpose was to let one repository run `shell` while the JS loop earned its default. A repository that still names `shell` after this change gets the JS loop, and `plot-dispatch/SKILL.md` carries the note for it. A silent fallback to a body that no longer exists is how a fleet runs the wrong loop for a week, so the launcher's exit 2 on a missing bundle stays.

**The launcher keeps no key read.** After the change `plot-worker-loop.sh` resolves its bundle, exits 2 with the existing message when the bundle is missing, removes `$PLOT_TMP_REGISTRY` and `exec`s `node`. It keeps the `plot-tmp.sh` source for that registry line. Nothing in it tests `PLOT_WORKER_LOOP_SOURCED`; the variable goes with the body it guarded.

**The exit-to-`clear`/`gone` path in the dispatch wrapper stays.** Exit 0 is a `clear` line and a non-zero exit is `gone`; the board reads `gone` as "restart it". The `exit 124` and the blocked-ending exit 0 that the JS loop already produces depend on it.

**The rest of `plot-worker-state.sh` stays.** `plot_worker_idle_now` is called by other shell scripts and by domain adapters. `corpus/agent-state.corpus.test.ts` and `corpus/sample.corpus.test.ts` stay with it. Only the three functions the plan names go, and a corpus test whose shell half is removed (`transcript`, `desk-reset`) goes with that half, because the pair is what the corpus holds and a pair of one is not a disagreement.

**The tests that source the shell body go with the body.** Seven files set `PLOT_WORKER_LOOP_SOURCED` and call its functions: `checkout-yield`, `checks-wait`, `correction`, `deskreset`, `ending`, `marker-writer` and `prompt-resolution`. Each tests a shell function that no longer exists. Before deleting one, check that the JS loop has a test for the same decision (the ending vocabulary, the correction budget, the checkout yield, the prompt resolution), and name any decision with none in the PR. A decision with no JS test is a gap to report, never one to silence by deleting its only test.

**The remaining loop tests run on the JS loop only.** `test/reconcile/loop-switch.mjs`, `testWorkerLoop` and `workerLoopLine` go, and the helpers stop writing a `Worker loop` line. `workerloop.test.mjs` alone takes 141 s, and the contract step takes 408 to 502 s against a 720 s limit, with the loop's files already in it on `shell`. The `loop-js` job exists to run those same files on `js`; with one loop it runs them a second time. Remove the job, its `paths` filter and its derived file list, and state the contract step's duration from the PR's run in the PR body.

**A residue in the plan's grep is expected, and it is not a failure to hide.** The plan's pathspec excludes `CHANGELOG.md` at the repository root only. Today `packages/board/CHANGELOG.md` matches, and so do the generated bundles `board-server.mjs`, `plot-ask.mjs`, `plot-registryd.mjs` and `plot-checks-verdict.mjs`. The changelog is release history that changesets writes, and a PR may not commit a generated bundle (`scripts/check-no-bundle-diff.sh`). `plot-checks-verdict.mjs` leaves the generated set when its entry leaves `build.mjs`, so the PR deletes that file. For the other three, run `pnpm build:board` locally, confirm the grep no longer lists them, and restore the generated paths from the merge base before you push (Definition of Done › Resolving a board artifact conflict). Report the grep's remaining lines by name, each with its reason.

**Rules carried over unchanged.** Absent is not false: a missing findings file or a missing bundle means "not reported", never a changed ending. The loop's exit codes change nowhere. A function you write or rewrite is an arrow. Tests that spawn wait for the process to exit, not for a file. A desk holding unlanded work still ends `holding-work` with exit 0 (#1271); the JS loop already answers that, and a test names it.

### Done when

The plan's `git grep -l -e PLOT_WORKER_LOOP_SOURCED -e plot-build-monitor -e buildMonitorPid -e plot-transcript-quiet -e plot-checks-verdict -e manifest_resume_id -- . ':!docs' ':!.plot' ':!CHANGELOG.md'` lists no source, test, script or workflow file, with only the residue named above, and CI passes.

Assertions that exist because a naive implementation passes without them:

- **The board still shows a build finding.** A change that deletes the monitor and the shell body passes every other test. Assert that the JS loop's CI wait writes the failed, passed, needs-approval and head-moved findings and the `clear` that retracts one, and that `findingsFor` returns them for the desk. This catches the silent loss in point 1.
- **`buildMonitorPid` has no reader.** Dispatch writes no field, the manifest schema drops it, and `registry.ts`, `continue.ts` and `manifest-stamp.ts` neither read nor stamp it. A manifest on disk that still carries the field parses without error: an old desk must not refuse to load.
- **A dispatched desk starts the AgentMonitor and nothing else.** The `desk-monitors` adapter returns the agent monitor's pid only, and `/api/continue` starts the same one process.
- **No `Worker loop` reader remains.** `git grep "Worker loop"` outside `docs/`, `.plot/` and changelogs lists only the SKILL.md note.
- **The launcher starts the bundle.** A test runs `plot-worker-loop.sh` against a missing bundle and reads exit 2 with the message, and against a present bundle reads that `node` runs it.

Plus the repo's gates: a changeset with the description first and the `bumps:` block last (`'plot': minor` with `plot-dispatch: minor`, because the `Worker loop` key leaves the config contract; one with `'@plot-pm/board'` if the board package changes), `scripts/check-shell-lines.sh pr` (this change only removes shell), `scripts/check-no-bundle-diff.sh`, `scripts/check-bundle-attributes.sh`, `scripts/check-bundle-resolution.sh`, `scripts/check-helper-table.sh` and `./scripts/check-agents-md.sh`. The `scripts/README.md` rows for the removed scripts go with them.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally; `worker-monitor-samples.test.mjs` and the other e2e files that name the loop change by reading, and CI is the authority for them. Use Node 24 (`nvm use`), and run a failing `test/reconcile` file alone before believing it: those suites fail falsely under worktree contention.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Where a project board is configured, set the PR to "Ready" with `plot-update-board.sh`. The PR body names: the findings tests (point 1 and 2), the key readers removed (point 4), each shell-body test file deleted with the JS test that covers its decision or the gap, the `loop-js` removal with the contract step's duration, and the grep's residue.

### Scope guard

This branch owns the shell loop and its helpers, the monitor wiring, the `Worker loop` key and the tests that exercise them:

- `skills/plot/scripts/` (`plot-worker-loop.sh`, `plot-build-monitor.sh`, `plot-transcript-quiet.sh`, `plot-monitor-subject.sh`, `plot-agent-manifest.sh`, `plot-dispatch.sh`, `plot-worker-state.sh`, `plot-config.sh`, `README.md`), `skills/plot-dispatch/`
- `packages/board/` (`src/server/` entry, continue, registry, manifest-stamp, runner-gate, dispatch; `src/contract/schema.ts`; `build.mjs`, `package.json`, `.gitignore`; the JS loop's findings writer in `src/server/entry/`) and their tests
- `packages/domain/` (`adapters/desk-monitors`, `ports/desk-monitors.ts`, `rules/runner-choice.ts`, the comments in `entities/finding.ts` and `adapters/transcript`) and their tests, `corpus/`
- `test/reconcile/`, `test/e2e/` files that name the loop, `.github/workflows/ci.yml`, `.gitattributes`, `scripts/count-master-diagnosis.mjs`, `CLAUDE.md` and the generated `AGENTS.md`

Other branches in flight, checked 2026-10-07 on origin: `bug/board-roles-after-the-port` (#1333) changes `board-run.ts`, `entry/main.ts`, `agent-run-command.ts` and two tests, with no file in common with this list. `changeset-release/main` (#1278) is the release PR. Do not touch `rules/` or `workflows/` beyond `runner-choice.ts`: `agentLoop` and its rules already decide everything the shell body decided.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
