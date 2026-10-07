## Implementation brief — the-worker-loop-runs-in-js (wave 6: The shell loop goes)

- **Plan (canonical):** `docs/plans/2026-10-04-the-worker-loop-runs-in-js.md` on `main`
- **Approved:** 2026-10-04, jwloka, in-session
- **Branch:** `infra/the-shell-loop-goes` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention. The PR is reviewed as code, and CI is the authority for e2e.

Waves 1 to 5 merged (#1279, #1282, #1292, #1314, #1330). This is the last wave: nothing waits on it, and it waits on nothing in the plan. Read **The gate** before writing code, because wave 5 merged on a condition that the plan's Notes line of 2026-10-07 changes.

### What to build

`plot-worker-loop.sh` is 3,228 lines today (891 without comments). After this branch it holds the launcher only: it resolves the JS bundle `board/plot-worker-loop.mjs` and `exec`s it, and decides nothing. The `Worker loop` key stops existing. The JS loop takes over the one write the shell body still owns through the BuildMonitor, the build findings file the board reads.

Removed, per the plan's slice 6:

- the shell body of `plot-worker-loop.sh`, and the `Worker loop` read in its first lines
- `plot-transcript-quiet.sh` (172 lines with comments)
- `plot-build-monitor.sh` (482 lines with comments) and its start in `plot-dispatch.sh`
- the `buildMonitorPid` field and every reader of it
- `manifest_count`, `raise_manifest_count` and `manifest_resume_id` in `plot-agent-manifest.sh`
- the findings form of `checksVerdict` and its bundle `board/plot-checks-verdict.mjs`, with `packages/board/src/server/entry/checks-verdict.ts`
- `packages/domain/corpus/desk-reset.corpus.test.ts`
- the test files that source the shell body (`PLOT_WORKER_LOOP_SOURCED=1`)
- `PLOT_TEST_WORKER_LOOP` and `test/reconcile/loop-switch.mjs`: with one loop, the switch has nothing to select
- `plot_worker_idle_watch_pass`, `plot_worker_conversation_spoken` and `plot_worker_publish_finding` in `plot-worker-state.sh`, the loop's own callers only; two of them call `plot-transcript-quiet.sh`

Kept, and the plan says so: `plot-worker-state.sh`'s other functions, `plot_worker_idle_now` included, because other scripts and domain adapters call them; `corpus/agent-state.corpus.test.ts` and `corpus/sample.corpus.test.ts`; `plot-agent-monitor.sh` and its start in `plot-dispatch.sh`; the dispatch wrapper's exit-to-`clear`/`gone` path; `Worker command` naming `plot-worker-loop.sh`, so no adopting repository edits its config.

**The file list is the one the plan's grep gives, on 2026-10-07.** Check it against the code of the day:

```bash
git grep -l -e PLOT_WORKER_LOOP_SOURCED -e plot-build-monitor -e buildMonitorPid -e plot-transcript-quiet -e plot-checks-verdict -e manifest_resume_id -- . ':!docs' ':!.plot' ':!CHANGELOG.md'
```

It lists 46 files: `.gitattributes`, `.github/workflows/ci.yml`, `packages/board/.gitignore`, `build.mjs`, `package.json`, `src/contract/bundles.generated.ts`, `src/contract/schema.ts`, `src/server/{continue,manifest-stamp,registry}.ts`, `src/server/entry/checks-verdict.ts`, three board unit tests (`continue-route`, `manifest-stamp`, `registry`), `packages/domain/corpus/{desk-manifest.corpus.test.ts,production.ts,transcript.corpus.test.ts}`, `packages/domain/src/adapters/desk-monitors/desk-monitors-shell.ts`, `adapters/transcript/transcript-fs.ts`, `entities/finding.ts`, `ports/{desk-monitors,transcript}.ts`, `packages/domain/test/desk-monitors-shell.test.ts`, `scripts/count-master-diagnosis.mjs`, `skills/plot/scripts/README.md`, the generated bundles `board/{board-server,plot-ask,plot-checks-verdict,plot-registryd}.mjs`, `plot-agent-manifest.sh`, `plot-build-monitor.sh`, `plot-dispatch.sh`, `plot-monitor-subject.sh`, `plot-worker-loop.sh`, and 14 files in `test/reconcile/` (`buildmonitor`, `checkout-yield`, `checks-wait`, `correction`, `deskreset`, `dispatch`, `ending`, `free-window`, `marker-writer`, `prompt-resolution`, `usage-limit`, `workeridle`, `workerloop`, `workerstate-idle`). The generated `board/*.mjs` bundles are not edited by hand: `main` rebuilds them, and a PR's diff carries no generated bundle (`scripts/check-no-bundle-diff.sh`).

The grep sets the finish line and is wider than the removal: several hits are a mention in a doc comment or a retained test that needs one sentence changed, not a deletion. A hit in `scripts/count-master-diagnosis.mjs` is the wave 5 counting script, which names the removed shell files as its pattern list: **keep the patterns**, because the script counts a past window where those files existed, and move its mention out of the grep's reach only if the plan's `Done when` forces it, saying so in the PR.

The `Worker loop` key has more readers than the grep above finds. Find them with:

```bash
git grep -l -e 'Worker loop' -e PLOT_TEST_WORKER_LOOP -e manifest_count -e raise_manifest_count -e plot_worker_idle_watch_pass -e plot_worker_conversation_spoken -e plot_worker_publish_finding -- . ':!docs' ':!.plot' ':!CHANGELOG.md'
```

Beyond the shell files it lists `packages/board/src/server/{runner-gate,dispatch,board,continue}.ts`, `entry/worker-loop.ts`, `packages/domain/src/rules/runner-choice.ts`, `adapters/agents/agents-fs.ts`, `skills/plot-dispatch/{SKILL,README}.md`, `skills/plot/scripts/plot-config.sh`, the `Worker loop` line in `CLAUDE.md` and its mirror `AGENTS.md`, and `.github/workflows/ci.yml`. Wave 5 made `js` the default in `runner-gate.ts` and `runnerChoice`; here the key goes, so the gate reads no key and `runnerChoice` loses its `workerLoop` input and the `sdk-needs-js-loop` refusal that existed only to stop `sdk` under `shell`. Change the rule and its unit test together, and never leave the board gate and the domain rule disagreeing. The manifest's `loop:` line stays: it describes a loop that already ran, and an absent field still reads as `shell` for a manifest written before this change.

### The gate — do not re-derive it

**Slice 5 did not clear its own 20-slice count.** The plan's Notes of 2026-10-07 record it: #1330 merged before the fleet had run 20 slices on `js`, because the only two plans in flight held the count still. The comparison against `docs/notes/the-worker-loop-runs-in-js-baseline.md` (present on `main` today) continues on the slices that run after the merge. **A loop-caused failure of kind 1, 4 or 5 reverts the default.** Kind 1 is a desk that ended free with unpushed or uncommitted work. Kind 4 is a loop process that outlives its desk. Kind 5 is a prompt process that outlives its loop.

Removing the shell loop removes the revert path. So before the first commit of this branch:

1. Read the baseline note and count the slices that ran on `js` since #1330 (`bbfa4f2a1`). Name that count and each failure of kinds 1, 4 and 5 in the PR. A kind with no source is **unmeasured**, never zero.
2. If a failure of kind 1, 4 or 5 is on record, or if you cannot read the count, **stop and write a `PLOT-BLOCKED` marker**. Do not remove the shell loop: the plan's own Notes say that finding reverts the default, and this branch is what makes a revert impossible.
3. The plan's Open Questions still holds an unchecked item that wave 6 depends on: *one process per agent or per machine*, whose answer is "due before slice 6 removes the shell loop". The operator chose one process per agent on 2026-10-04. Check whether the PR for wave 5 or the baseline note records the measured memory and tokens. If neither does, report it in the PR as an open input rather than inventing the number.

Do not lower a threshold, widen what counts as `js`, or flip a key to make a count look reached.

### Settled decisions — do not re-derive them

- **The launcher keeps `Worker command`'s name and nothing else.** Adopting repositories name `plot-worker-loop.sh`, and `plot-dispatch --start` refuses any other name. So the file stays, as an `exec`. Deleting it is the change that breaks every adopting repository, which is why the plan says "keeps only the `exec`", not "goes". With no bundle beside it the launcher exits 2 with the message form `the-shell-shrinks-into-the-domain` set, and never falls back silently. Wave 3 built that path; keep its test.
- **One writer for the build findings file.** While the BuildMonitor existed it wrote the file in both modes and the JS loop wrote none. From this slice the JS loop writes each build answer in the BuildMonitor's shape, and `plot-build-monitor.sh` is gone, so there is still exactly one writer. The board's findings reader does not change. A test that reads the file after a `BuildPort` answer, byte for byte against a stored BuildMonitor fixture, catches a changed shape.
- **`buildMonitorPid` is removed with its readers, and reads empty in the interim.** The field is in the manifest's schema (`contract/schema.ts`), the board's registry and its stamp (`registry.ts`, `manifest-stamp.ts`), the continue route and `desk-manifest.corpus.test.ts`. A manifest written before this change may still carry it. The reader must ignore an unknown field, not refuse the manifest: a refusal here reads as a stale desk and the supervisor reaps it.
- **The exit-0 `blocked` path stays.** The dispatch wrapper turns exit 0 into a `clear` line and a non-zero exit into `gone`, and the board's attention rule reads `gone` as "restart it". The plan keeps the wrapper's path when it removes the monitors, and this is what fixes #1250. Do not touch the wrapper's exit handling.
- **The test files that source the shell body test shell functions, not behaviour.** They go with the body. Those that start a loop and do not source it (`loop-prompt-launch.test.mjs` and others) stay, lose their `loop-switch.mjs` import, and now run the JS loop unconditionally. A test that passed only because the shell loop was the default fixture is the failure to look for: name every file whose assertion you changed, and why.
- **The `loop-js` CI job from wave 3 existed for the transition** and is the one `.github/workflows/ci.yml` hit. With one loop its tests belong to the normal job set. Decide it from the job's measured run time in wave 3's PR, not from preference: the contract step already takes 408 to 502 s against its 720 s limit, so folding the files into it needs the measurement first. If the job stays, drop only its `Worker loop: js` setup.
- **Rules carried over unchanged.** An empty reading is not zero. A claim ref pushed by a loop belongs to the loop that pushed it. `plot-ancestry` kinds are declared at each ancestry call. A new shell line pays for itself: `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. This branch removes about 1,100 lines of shell and adds none, so it passes with room; the launcher you keep must not grow past what it is today.

### Done when

The plan's slice 6 is the specification: the grep above lists no file outside `docs/`, `.plot/` and `CHANGELOG.md`, and CI passes. The assertions that exist because a naive implementation would pass without them:

- **The launcher test with the bundle missing.** Exit 2, naming the bundle. A naive deletion of the body leaves a launcher that starts `node` on nothing.
- **A dispatch end-to-end through the wrapper on a branch that ends `blocked` (exit 0).** It must still write a `clear` line, not `gone`, so #1250 stays fixed once the BuildMonitor is gone.
- **A manifest carrying `buildMonitorPid`** is read without refusal after the field's removal.
- **The build findings file test** above: its shape equals the BuildMonitor's, and the board's reader reads it unchanged.
- **`runnerChoice` and `runner-gate.ts` agree** with no `Worker loop` key anywhere, and `sdk` is no longer refused for a missing key.
- **The corpus tests that stay** (`agent-state`, `sample`) still pass, because `plot_worker_idle_now` stays.

Plus: add a changeset (description first, `bumps:` block last, `plan:` line inside the block, `./scripts/check-changeset-packages.sh` to check it). `skills/plot-dispatch/SKILL.md` gets a note for adopting repositories: the `Worker loop` key is ignored from this version, and a repository that still sets `shell` runs the JS loop. Bump the skill by changeset, not by hand. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `test:e2e` locally. `scripts/check-shell-lines.sh` is among the gates; here it only shrinks.

**On a conflict in `board-server.mjs`, `plot-registryd.mjs` or `plot-ask.mjs`,** restore the generated paths from the merge base against `origin/main` with the command the gate prints. Do not commit a rebuild.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Open the PR with `plot-open-pr.sh` (`--draft` while the work moves); never with `gh pr create`.

### Scope guard

This branch owns the shell loop's files above, the `Worker loop` key's readers, the `buildMonitorPid` field's readers, and the tests that source the shell body. It owns no change to `taskState`, `deskState`, `deskLifecycle`, `supervise` or the `agentLoop` table: the plan says they keep their rules. A change you think they need is a finding, not a fix here.

In flight on 2026-10-07: PR #1333 (`bug/board-roles-after-the-port`, board role classification and `plot-ask`). It touches the board's server code and may collide in `packages/board/src/server/` and the `plot-ask.mjs` bundle; the bundle collision resolves by the generated-path rule above. No other plan holds a branch that touches the loop. An untracked `PLOT-BLOCKED.md` sits in the main checkout's root from an earlier worker (a missing-write-permission note); it belongs to no desk of this branch, so ignore it and never commit it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
