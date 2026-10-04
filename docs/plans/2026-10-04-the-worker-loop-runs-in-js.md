# The worker loop runs in JS

> An agent's loop is one long-running JS process that asks a domain workflow what to do next; `plot-worker-loop.sh` keeps only its name, as a launcher.

## Status

- **State:** Draft
- **Type:** infra
- **Issue:** #1246, #1255, #1199
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 2

## Changelog

- An agent whose prompt ends with uncommitted or unpushed work ends its loop with the reason `holding-work`, and the board names a person for the desk. It no longer goes free on that work (#1246).
- A CI wait settles on the checks for the branch's current head when that head contains the agent's commit. When it does not, the wait ends and the log names the branch that moved (#1199).
- An agent's loop can run as one JS process for the agent's whole life, from `board/plot-worker-loop.mjs`, behind the `Worker loop` key. `plot-worker-loop.sh` stays as the launcher that adopting repositories name in `Worker command`.
- In the JS loop, the CI wait reads the build pipeline's runs for the branch's current head, through the build connector. A continued or corrected desk waits the same way as a dispatched one (#1255).
- A running JS loop restarts itself on a newer, loadable bundle in this repository's main checkout, at a point where it holds no work. It keeps its pid and its `Worker bound`.
- The loop's decisions are covered by the domain's 100% coverage gate. Before, no coverage tool measured them.
- The JS loop becomes the default, and then the shell loop, `plot-build-monitor.sh` and the BuildMonitor process are removed. The JS loop writes the build findings file that the board reads.

<!-- Board impact: no change to the plan format, the template or the docs/plans layout. The board reads the same manifests, logs and findings files. Until slice 7 the BuildMonitor writes .plot-worker.monitor.build.jsonl in both modes; from slice 7 the JS loop writes it in the same shape, so findings.ts:42 reads it unchanged. buildMonitorPid (schema.ts:3451, manifest-stamp.ts, registry.ts) reads empty after slice 7, which removes the field and its readers together. Slice 4 adds the bundle board/plot-worker-loop.mjs, declared in packages/board/build.mjs and built on main. -->

## Motivation

Measured on `main` on 2026-10-04:
- `skills/plot/scripts/plot-worker-loop.sh` holds 891 non-comment lines (3,137 with comments) in 52 functions.
- It sources four helpers: `plot-agent-manifest.sh` (94), `plot-worker-state.sh` (530), `plot-transcript-quiet.sh` (39) and `plot-tmp.sh` (87).
- It starts seven bundles: `plot-checkout-yield`, `plot-checks-verdict`, `plot-claim-answer`, `plot-empty-claim`, `plot-prompt-exit`, `plot-prompt` and `plot-slice-spend`.
- Its CI wait reads findings from `plot-build-monitor.sh` (162), a separate process that `plot-dispatch.sh` starts.
- `git grep -l plot-worker-loop -- test` lists 30 test files, 5 of them under `test/e2e`. `workerloop.test.mjs` alone takes 141 s.

`the-shell-shrinks-into-the-domain` names this script as the first follow-on plan, because the shell ratchet bites here first: the loop grew 287 lines in the three days to 2026-10-03, and every open PR that grew the shell that day edited it. The cost rule in `docs/shell-and-domain.md` is the reason it stayed shell. The loop runs once per agent per pass, so each decision it asks costs a `node` start, and the declared duplicates exist to avoid that. `the-worker-loop-asks-the-domain` (2026-09-07) decided "not a rewrite of the loop" for the same reason. A long-running process removes that per-pass start, so the reason no longer holds once the loop is JS.

**On 2026-10-03 and 2026-10-04, five failures came from the loop and the processes around it:**

1. An agent ended its prompt turn while it waited on a background job. The loop found the desk held by uncommitted work, cut a new desk (`plot-worker-loop.sh:2980-3000`) and went on with 14 files left behind (#1246). It happened twice: `the-queue-reads-the-scans-order` and `the-parser-reads-every-wait`.
2. A continued agent had no BuildMonitor, so its CI wait expired after 1,800 s with "no CI answer" while CI had failed (#1255, PR #1249).
3. A dispatched agent's BuildMonitor reported the first failure and missed the run after the correction. The loop let go after 3,600 s and correction 2 never ran (#1255, PR #1269).
4. An agent stopped on a `PLOT-BLOCKED` marker, its loop ended on the wait bound, and the board read exit 124 as a crash (#1250).
5. The board process ran for a day and a half on the code it loaded at start, with no reload, and kept a repair that #1263 had retired. A long-running loop has the same exposure, so this plan adds the fix together with the process.

On 2026-10-04 the cost juror also found 8 monitor processes and 2 loops with parent pid 1, alive for 2 to 3 days, from desks that no longer existed. The dispatch wrapper starts the monitors as background jobs and nothing stops them when the wrapper ends.

Each of these is a decision taken in shell, or across processes that share a file, that no unit test reaches. No coverage tool measures the shell, so nobody can see which of the loop's branches its test files miss.

## Design

### Approach

**The loop asks a domain workflow, in the estate's existing shape.** `packages/domain/src/workflows/agent-loop.ts` exports `agentLoop(readings) -> Decision | Refusal`, the form `workflows/decision.ts` fixes for every workflow. It carries no state between passes. Each pass, the loop derives where the agent stands from the readings: the manifest's assignment, the desk's `resetRefusals`, the prompt's exit, the idle reading and the build runs for the branch's head. This is the property `workflows/supervise.ts` keeps, so that `kill -9` costs one pass. A `Decision` holds ordered `Write` values. The loop uses the existing kinds `blocked-marker`, `commit`, `push`, `worker-signal` and `manifest-clear`, and adds `claim-push`, `desk-reset`, `prompt-run`, `loop-end`, `worker-finding` and `build-finding`. `agentLoop` never persists a state. A test asserts that nothing writes one, as `transitions/agent.ts` states for `AgentState`.

**The loop ends with the reasons the estate already has, plus three.** `EndingReasonSchema` (`entities/ending.ts:76-83`) holds `bound`, `quiet`, `unreadable`, `spent`, `unstarted`, `limited` and `unregistered`. The loop uses each of them as the shell loop does. It adds `holding-work` (slice 1), `blocked` and `checks-unanswered` (slice 2), and `ending.test.ts` grows with them. No watcher produces any of the three. The agent's own loop observes the desk and the build and stops, so `endingIsAttributable` (`transitions/agent.ts:401-415`) admits actor `agent` for them, beside `unstarted`, `limited` and `unregistered`. The refusal's sentence names the six.

**The loop adds no state vocabulary.** The table below gives each situation the decision, the ending and the exit code. The last column is what `agentState` (`rules/agent-state.ts:141-152`) and `deskState` (`rules/desk-lifecycle.ts`) derive afterwards. A unit test builds the readings for every row and asserts both columns through the two rules themselves. A row the rules answer differently stops the branch.

| Readings | Decision | Ending, exit | `agentState` / `deskState` after |
|---|---|---|---|
| no assignment, inside `Worker bound` | wait one pass | none | `running` / none |
| no assignment, `Worker bound` reached | `loop-end` | `bound`, 124 (as today) | `failed` / none |
| manifest gone (`loopRegistration` answers `gone`) | `loop-end` | `unregistered`, 124 (as today) | `failed` / none |
| an assignment | `claim-push`; a refusal carries `claimAnswer` | none | `running` / `working` |
| prompt running, `idleNow` answers idle | `worker-finding`, then `loop-end` | `quiet`, 124 (as today) | per desk, as today |
| prompt running, idle reading unavailable past the floor | `worker-finding`, then `loop-end` | `unreadable` or `bound`, 124 (as today) | per desk, as today |
| prompt exit `unstarted` | `loop-end` after the retries the shell loop makes | `unstarted`, 1 (as today) | `failed` / per desk |
| prompt exit `wait` (`promptExit`: a usage limit with a known reset) | wait until the reset, inside `Worker bound` | none | `running` / `working` |
| prompt exit `end-limited` | `loop-end` | `limited`, 1 (as today) | `failed` / per desk |
| prompt exit `ran`, a `PLOT-BLOCKED` marker | `loop-end` | `blocked`, 0 | `waiting` / `refused-with-work` or `refused-empty`, by what the marker records |
| prompt exit `ran`, no marker, `resetRefusals` names `uncommitted-changes` or `unpushed-commits` | `loop-end` | `holding-work`, 0 | `stalled` / `holding-work` |
| prompt exit `ran`, work pushed, a PR open | wait for checks | none | `running` / `working` |
| checks pass | `desk-reset`, then free | none | `running` / none, once the reset removed the claim |
| checks fail, correction budget left | `prompt-run` with the correction | none | `running` / `working` |
| checks fail, budget spent | `blocked-marker` naming the PR and each correction, then `loop-end` | `blocked`, 0 | `waiting` / `refused-with-work` |
| no check answer by `Checks wait`, or the head no longer contains the agent's commit | `loop-end` | `checks-unanswered`, 0 | per desk |

**A loop that holds work or is blocked ends, and the desk carries what is left.** `deskState` reads `working` for any desk with a live worker (`desk-lifecycle.ts:158`), so a loop that stayed alive in either state would hide the person that `deskLifecycle` names. The loop therefore ends, records the reason, and exits 0. `agentState` then reads the desk through `taskState`: `waiting` for a marker and `stalled` for unlanded work. `/api/continue` starts the next loop on a blocked desk as it does today (`continue.ts:333`). A `holding-work` desk has no marker, so `/api/continue` refuses it (`continue.ts:446`). Its exit is the one `deskLifecycle` already names: a person decides whether to push the work or let it go. Exit 0 with a marker reads `waiting`, not the exit-124 crash of #1250.

**The marker that a spent budget writes records the work.** The loop writes `PLOT-BLOCKED.md` naming the PR and each correction, so `markerRecordsWork` holds and the desk reads `refused-with-work`. It never reads `refused-empty`, which reaps the desk. The table test asserts it.

**`Worker bound` holds in every state.** Every waiting row is inside the bound. A restarted process keeps the original start time, so a restart cannot extend the bound (Manifesto principle 13).

**The idle watch stays.** An agent that has gone quiet has failed, not finished (principle 13). Each pass the JS loop asks `idleNow` (`rules/sample.ts`, paired with `plot_worker_idle_now` by `corpus/sample.corpus.test.ts`). It writes the result to `.plot-worker.monitor.worker.jsonl` in the WorkerMonitor shape, and ends with `quiet` or `unreadable` as the shell loop does (`plot-worker-loop.sh:2616`, `:2629`). The transcript reading that `plot-transcript-quiet.sh` supplies moves into an adapter in slice 4.

**Two correction budgets stay apart, and they are declared.** The loop counts corrections on a live desk (`correctionAttempts` in the manifest). The supervisor counts relaunches of a dead worker (`rules/supervision.ts:203`, `MAX_ATTEMPTS`). They count different events. A test asserts that a correction does not use a relaunch attempt, and that a relaunch does not use a correction.

**The JS loop's CI wait reads the build connector for the branch's current head** (#1255, #1199). The head SHA comes from the `refs` port: the branch's remote tip after a fetch. The runs come from `BuildPort.runForSha(branch, sha)` (`ports/build.ts`), which has adapters for GitHub Actions, Jenkins, none and a fixture. A Bitbucket-plus-Jenkins repository therefore waits through its own connector, as `the-build-pipeline-is-its-own-connector` decided. The wait settles on that head only when the head contains the agent's last pushed commit. That is an ancestry reading declared `plot-ancestry: evidence`, and the workflow decides from it. A head that does not contain the commit (a force-push) ends the wait with `checks-unanswered`, so the wait never settles on someone else's build. A connector that cannot answer reads `unknown`, never "no CI answer".

**Two checks rules exist during the transition, and both are declared.** `rules/checks-verdict.ts` keeps its BuildMonitor-findings input, because the shell loop calls it through `plot-checks-verdict.mjs` (`plot-worker-loop.sh:1751`) until slice 7. Slice 2 adds `checksFromRuns` beside it, over build runs. Slice 7 removes the findings form and its bundle. `rules/checks-reading.ts`, the board's rule over host readings, does not change.

**The CI wait is a declared exception to "A Decision Reads The Index".** The index holds no non-terminal answer that the loop could trust, because a check result for an open PR goes stale in either direction. The JS loop asks `BuildPort` at most once per 60 s per waiting agent. The build connector's rate budget pays for these calls, and the loop records each one there. Until slice 7 the BuildMonitor also polls in `js` mode, so a waiting agent costs about 180 build calls an hour instead of 120. At 8 agents that is 1,440 an hour, inside GitHub's 5,000 REST limit. The loop never writes the PR index; `fleet.ts` stays its one writer.

**One writer for the build findings file at a time.** Until slice 7 the BuildMonitor writes `.plot-worker.monitor.build.jsonl` in both modes, and the JS loop reads `BuildPort` for its own decision and writes nothing there. Slice 7 removes the monitor and its start in `plot-dispatch.sh`, and the JS loop then writes each answer to that file in the BuildMonitor shape. The board's reader (`findings.ts:42`) does not change.

**The prompt is the project's.** The loop runs the prompt that the dispatch skill declares: `.plot/worker-prompt.sh` when the project has one, and otherwise the shipped prompt (`plot-dispatch/SKILL.md:204`). Plot names no harness (Manifesto principle 5).

**The loop's writes go through ports.** The existing adapters cover the loop's reads. They cover none of its writes, so a slice adds them before the process exists:

| Write | Port | Starting point |
|---|---|---|
| claim push, desk reset, commit, push | `refs` (new operations) | the shell loop's `reset_desk` and claim push |
| a prompt run under a bound, and its process-group kill | `processes` (new operation `runBounded`) | `adapters/run-script.ts:58-66`, which already spawns `detached: true` and kills the group with `process.kill(-pid, 'SIGKILL')` |
| manifest write | a domain port over `manifest-stamp.ts` | `packages/board/src/server/manifest-stamp.ts` |
| `.plot-worker.ending.json`, `PLOT-BLOCKED.md`, the worker and build findings lines | `plan-store` or a new `desk` port | the shell loop's writers |

The spawn ratchet (`ci.yml`, *One place reaches a process*) does not grow, because every new spawn sits inside `adapters/`.

**The process owns its children.** The JS loop runs every child in its own process group and kills that group on every exit path. It starts no sidecar. The dispatch wrapper still starts `plot-agent-monitor.sh` (`plot-dispatch.sh:1485`), and until slice 7 the BuildMonitor. So this plan stops orphaned loops and, from slice 7, orphaned build monitors. An agent monitor can still outlive its wrapper, and that stays a dispatch defect outside this plan.

**The launcher starts no Node in `shell` mode.** From slice 4 the first lines of `plot-worker-loop.sh` read `Worker loop` through `plot-config.sh`. On `js` they `exec node` the bundle; on `shell` the script continues into its own body. The default path for an adopting repository therefore runs no Node and needs no Node feature. The key read is the one decision a launcher makes, and slice 7 removes it with the key. With `js` and no bundle, the launcher exits 2 with the message form `the-shell-shrinks-into-the-domain` set (`plot-release-gate.sh:30-33`). It never falls back silently (`docs/shell-and-domain.md:30`).

**Restart on new code.** The launcher pins the bundle path when it starts the JS loop. The path is the bundle in this repository's main checkout, never the desk's copy. A desk follows each slice branch, and a branch carries the bundle of the main it was cut from, so a hash of the desk's bundle would restart the loop into older code. Nothing fast-forwards the main checkout, so the loop checks the direction itself. At each point where it holds no work, it restarts only when all four conditions hold:
- The main checkout is on the default branch.
- Its bundle paths are clean (`git status --porcelain -- skills/plot/scripts/board/`).
- Its `HEAD` contains the commit the loop loaded from. This ancestry reading is declared `plot-ancestry: prefilter`: a wrong answer only skips a restart, and the next pass asks again.
- The pinned bundle's content hash differs from the loaded one.

Before it restarts, the loop proves that the new bundle loads: it runs `node <bundle> --self-check` as a child and requires exit 0 within 10 s. A bundle that fails the check is logged once and not used, so a broken bundle stops no loop. On success the loop calls `process.execve` with the same arguments and `PLOT_LOOP_STARTED` set to its original start time. `process.execve` is the only restart that keeps the pid, and the dispatch wrapper's `wait` and the manifest's `pid` depend on that pid. It exists from Node 22.15 and is experimental. The cost jurors measured that it keeps the pid on v24.4.1 and that it is absent on v20.19.4. On a Node without it, the JS loop runs and never restarts, and it logs that once. The same check restarts the loop when its resident memory passes 300 MB while it holds no work.

**Restart scope.** The restart fires when the operator updates this repository's main checkout. The number of restarts follows those updates, not the merge count. In an adopting repository, a plugin upgrade installs a new versioned directory and leaves the old bundle unchanged. There the loop runs the old code until the supervisor relaunches it, and the Changelog says "this repository's main checkout" for that reason.

**Costs, measured 2026-10-04.**
- **Memory:** about +50 to 75 MB per agent in `js` mode. A bash loop holds 2 to 5 MB, a long-running Node process with the adapter estate holds 58 to 81 MB, and removing the two monitors saves about 10 MB. That is 5 to 10% of the `claude` process each loop runs. `shell` mode costs nothing new.
- **CPU:** negligible. A restart is one Node start and one self-check, tens of milliseconds each.
- **Build calls:** about 180 an hour per waiting agent from slice 4 to slice 7, then 60 (see the index exception above).
- **CI:** from slice 4 to slice 7, a matrix leg runs the contract test files that drive the loop a second time with `Worker loop: js`. The e2e files stay on `shell`, because `validate` already takes 19 min 24 s (run 37208059832). Slice 4 lists the files in its PR with the command it used. The window lasts at least the slice-6 sample of 20 slices, about one week at the current rate.
- **Shell:** slice 7 removes about 1,120 lines. The figure is 891 + 162 + 39 + 28: the loop's own lines, the build monitor, the transcript reader, and three manifest functions.

**Coverage.** Every row of the table above is a decision in `packages/domain/src/workflows/`, so the domain's 100% lines, branches, functions and statements gate (`packages/domain/vitest.config.ts`) covers it. The entry `packages/board/src/server/entry/worker-loop.ts` decides nothing: each branch in it is either an adapter call or `agentLoop`'s answer. Slice 4 adds a coverage threshold for that file. It is the first gated file in the board package. The five failures in Motivation become table cases in the workflow's unit test.

### Slices

**Slice 1: the shell loop holds unlanded work** (#1246, #1199). This slice ships behaviour into every repository before any JS loop exists:
- After a prompt exits `ran` with no marker, the shell loop asks `desk_reset_refusal` about its own desk (`plot-worker-loop.sh:738`), the shell side of `resetRefusals` that `corpus/desk-reset.corpus.test.ts` pairs. On `uncommitted-changes` or `unpushed-commits` it writes the ending `holding-work`, actor `agent`, and exits 0. It does not hop to a new desk.
- `EndingReasonSchema` gains `holding-work`, and `endingIsAttributable` admits actor `agent` for it.
- `checksVerdict`'s readings gain the branch's remote tip and whether the tip contains the desk's `HEAD`. The shell loop takes that reading with one `git merge-base --is-ancestor`, declared `plot-ancestry: evidence`, and the rule decides. A containing tip settles the wait on the tip's result. A tip that does not contain the commit ends the wait, and the log names the branch that moved. That is the end of the wait that #1199 asks for. The settle on a containing tip goes further than the issue, and the slice's PR says so. A case for each answer is added to `test/reconcile/checks-wait.test.mjs`.
- **Shell ratchet.** The slice adds no net shell lines. The new lines are paid for by the hop's held-desk arm (`plot-worker-loop.sh:2990-3000`). That arm now meets only a `blocked-marker` desk, so the `uncommitted-changes` and `unpushed-commits` arms of `desk_hold_reason` become unreachable and go. The PR states the count.

**Slice 2: the loop's workflow.** `agentLoop` in `packages/domain/src/workflows/agent-loop.ts`, with:
- the table above
- the new `Write` kinds
- the endings `blocked` and `checks-unanswered`, and their admission in `endingIsAttributable`
- `checksFromRuns`, beside the unchanged `checksVerdict`
- the table test through `agentState` and `deskState`, the marker test, and the budget-separation test
- the five failures as table cases

If `scripts/check-state-declarations.sh` asks for a `transitions/` rule for any new enum, the slice adds it. No caller yet. The slice is done when the domain coverage gate passes over the new file.

**Slice 3: the loop's writes go through ports.** The new port operations and adapters in the table above. The slice decides the signal behaviour before the process slice starts:
- `runBounded` kills the process group on the bound, on `SIGTERM` and on the loop's exit.
- CI tests it on Linux, including under `systemd` with `KillMode=process` (#1148).
- Every CI job runs on `ubuntu-latest`, so the PR records a local macOS run of the same test with the command and its output.

**Slice 4: the loop runs in one process.** `packages/board/src/server/entry/worker-loop.ts`, bundled to `skills/plot/scripts/board/plot-worker-loop.mjs`.
- **The launcher.** The `Worker loop` key read and `exec` at the top of `plot-worker-loop.sh`, at most 4 lines, default `shell`.
- **Shell ratchet.** The PR removes at least as many shell lines as the launcher adds, and it names each one. The body has no shared bundle-resolution preamble, so the lines come from the body's dead or duplicated code.
- **No bundle.** Exit 2 as above.
- **Manifest.** The loop records `loop: js` or `loop: shell` in the manifest.
- **Transcript reading.** The reading `plot-transcript-quiet.sh` supplies moves into an adapter, for the JS idle watch.
- **Coverage.** A coverage threshold for the entry file.
- **Tests.** The contract changes that this plan makes on purpose are rewritten, and each rewrite is named in the PR:
  - The 7 source-text assertions in 4 files (`workerloop.test.mjs:513,1269,1544`, `deskreset.test.mjs:362,385`, `refused-slice-record.test.mjs:36`, `checks-wait.test.mjs:163`) become behaviour tests.
  - The `js` leg of the files that write or read a BuildMonitor line takes a `BuildPort` fixture. `git grep -l -iE 'buildmonitor|build-monitor' -- test` lists 10 files; the PR names the ones that drive the loop.
  - Any other failure against `js` names a behaviour the plan did not list. It is reported and never rewritten to pass.
- **Baseline.** The PR counts the shell loop's listed failures (slice 6) over the 7 days before it merges, from `.plot-worker.log` lines and the issues filed. It records the count and the slices it read.

**Slice 5: the loop restarts on new code.**
- The pinned main-checkout bundle path.
- The four restart conditions and the `--self-check` load test.
- `process.execve` with `PLOT_LOOP_STARTED`, and the logged no-restart path on a Node without it.
- The memory ceiling.
- Tests:
  - a restart keeps the pid and does not extend `Worker bound`;
  - a bundle that fails the self-check stops no loop;
  - a checkout that moved backwards or is dirty triggers no restart.

**Slice 6: JS is the default loop.** `Worker loop` is one key per repository, so this repository runs no `shell` slices once it is set to `js`. The comparison is therefore against the baseline that slice 4 recorded. The default flips to `js` when the fleet has run at least 20 slices on `js`, and both conditions hold:
- the `js` loop's listed failures per slice are no more than the baseline's;
- the `js` loop has none of the first or fourth kind.

The manifest's `loop:` line shows which loop ran a slice. These count as loop-caused failures:
1. a desk that ended free with unpushed or uncommitted work;
2. a CI wait that ended unanswered while the build connector had an answer;
3. a loop exit with no recorded reason;
4. a loop process that outlives its desk.

The slice names the slices it counted, the failures of each kind, and the baseline.

**Slice 7: the shell loop goes.** `plot-worker-loop.sh` keeps only the `exec` of the JS entry. The `Worker loop` key and its read are removed, with a note in `skills/plot-dispatch/SKILL.md` for adopting repositories. The JS loop starts writing the build findings file. Removed, by name:
- the shell body of `plot-worker-loop.sh` (891 lines)
- `plot-transcript-quiet.sh` (39 lines). Its reading moved to an adapter in slice 4, and the loop is its only shell caller.
- `plot-build-monitor.sh` (162 lines) and every reference to it:
  - its start in `plot-dispatch.sh` and its line in `plot-monitor-subject.sh`
  - its entries in `packages/board/package.json` and `.gitignore`
  - its kind in `entities/finding.ts` and its rows in `corpus/desk-manifest.corpus.test.ts`
  - `buildMonitorPid` in `schema.ts`, `manifest-stamp.ts` and `registry.ts`, with the two unit tests that name it
- `manifest_count`, `raise_manifest_count` and `manifest_resume_id` in `plot-agent-manifest.sh` (28 lines)
- the findings form of `rules/checks-verdict.ts` and `plot-checks-verdict.mjs`
- `corpus/desk-reset.corpus.test.ts`, which pairs a loop-only duplicate, and the loop's half of `corpus/agent-state.corpus.test.ts`

`plot-worker-state.sh` stays whole, `plot_worker_idle_now` included. It has 15 other shell callers and two domain adapters, and `plot_worker_idle_now` is paired by `corpus/sample.corpus.test.ts` and tested by `workerstate-idle.test.mjs` and `worker-monitor-samples.test.mjs`. The shell ratchet falls by about 1,120 lines.

**When each fix reaches whom.** Slice 1 fixes #1246 and #1199 in every repository. #1255 stays open in this repository until the fleet runs on `js` after slice 4, and in adopting repositories until slice 6 flips the default. Until then they keep the BuildMonitor wait.

**What does not change.**
- `Worker command` keeps naming `plot-worker-loop.sh`, so no adopting repository edits its config. `plot-dispatch --start` refuses any other name.
- The manifests, logs and findings files the board reads keep their names and formats.
- The `PLOT-BLOCKED` and `PLOT-CORRECTION` files keep their names and formats.
- `plot-agent-monitor.sh` stays, and so does its start in `plot-dispatch.sh`.

### Open Questions

- [ ] Where does the agent's turn-ending rule live? #1246 has two halves. One: the loop must not go free on unlanded work (slice 1 of this plan). Two: the worker prompt must say that a turn ends only when work is pushed or blocked. This plan takes the first half. The second may be its own plan.
- [ ] One process per agent, or one process per machine? `plot-registryd` already runs one long-lived Node process per machine, and it could run every agent's loop. That would save the +50 to 75 MB per agent. The operator chose one process per agent on 2026-10-04. Slice 6's window can measure the memory before slice 7 removes the shell loop.
- [x] Process groups and signals. — *answered round 1: slice 3 decides them before the process slice, starting from `run-script.ts`; round 2: Linux in CI, macOS recorded in the PR*
- [x] Does `plot-agent-monitor.sh` move into the process? — *answered round 1: no; round 2: `plot-dispatch.sh:1485` starts it, so it stays with dispatch*

## Slices

### The shell loop holds unlanded work

- `infra/the-shell-loop-holds-unlanded-work` — the shell loop ends with `holding-work` when `desk_reset_refusal` holds its own desk for unlanded work, and the CI wait settles on a branch tip that contains the agent's commit; no net shell growth <!-- builds: the holding-work ending in the shell loop -->

### The loop has a workflow

- `infra/the-loop-has-a-workflow` — `agentLoop(readings) -> Decision | Refusal` in `packages/domain/src/workflows/agent-loop.ts`, its table and the tests through `agentState` and `deskState`, the new `Write` kinds and endings, and `checksFromRuns` <!-- builds: agentLoop, a domain workflow -->

### The loop writes through ports

- `infra/the-loop-writes-through-ports` — port operations and adapters for claim push, desk reset, a bounded prompt run with its process-group kill, the manifest, the ending file, the marker and the findings lines <!-- builds: runBounded and the loop's write ports -->

### The loop runs in one process

- `infra/the-loop-runs-in-one-process` — `board/plot-worker-loop.mjs` runs `agentLoop` behind `Worker loop: js`, the launcher reads the key and `exec`s it, the loop's contract tests run against both values, and the shell baseline is recorded <!-- builds: plot-worker-loop.mjs, a long-running loop entry -->

### The loop restarts on new code

- `infra/the-loop-restarts-on-new-code` — the loop restarts with `process.execve` on a newer main-checkout bundle that passes its self-check, or past its memory ceiling, keeping its pid and its `Worker bound` <!-- builds: the loop's self-restart -->

### JS is the default loop

- `infra/js-is-the-default-loop` — after 20 `js` slices at or under the shell baseline's failure rate, `Worker loop` defaults to `js` <!-- builds: the js default for Worker loop -->

### The shell loop goes

- `infra/the-shell-loop-goes` — the shell body, `plot-transcript-quiet.sh`, `plot-build-monitor.sh` with every reference to it, three manifest functions, the findings form of `checksVerdict` and the `desk-reset` corpus test are removed <!-- builds: plot-worker-loop.sh as a launcher only -->

## Notes

- 2026-10-04, direction from jwloka: the loop runs as one long-running process; Type infra; reviewed in-session; own branches. Follows `the-shell-shrinks-into-the-domain`, which names this script as its first follow-on plan.
- 2026-10-04, measurement: code lines with `grep -vcE '^[[:space:]]*(#|$)'`; functions with `^[a-z_]+\(\) *\{`; bundles and sourced helpers read from the script's text. Memory, CI timings and `process.execve` measured by the cost jurors of rounds 1 and 2.
- 2026-10-04, round 1: four jurors (estate, contradiction, deliverable, cost), unanimous `amend`. Moderation in `.plot/panels/2026-10-04-the-worker-loop-runs-in-js/round1.md`.
- 2026-10-04, round 2: the same four lenses, unanimous `amend`. Moderation in `round2.md` in the same directory.
- Related open issues this plan does not claim: #1250 (the board labels a blocked loop's exit 124 as a crash), #1186 (a hand-over restarts the idle reading), #1169 (a free agent runs a handed slice without its charter). The exit-0 `blocked` ending gives #1250 its fix once slice 4 runs, and it may close with that slice.
