# The worker loop runs in JS

> An agent's loop is one long-running JS process that asks a domain workflow what to do next; `plot-worker-loop.sh` keeps only its name, as a launcher.

## Status

- **State:** Approved
- **Type:** infra
- **Issue:** #1255, #1199
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 5
- **Approved:** 2026-10-04, jwloka, in-session
- **Started:** 2026-10-04, jwloka, `infra/the-loop-has-a-workflow`
- **Started:** 2026-10-05, jwloka, `infra/the-loop-writes-through-ports`
- **Started:** 2026-10-05, jwloka, `infra/the-loop-runs-in-one-process`
- **Started:** 2026-10-06, jwloka, `infra/the-loop-restarts-on-new-code`
- **Started:** 2026-10-06, jwloka, `infra/js-is-the-default-loop`

## Changelog

- In the JS loop, a CI wait ends when the branch's remote tip is no longer the commit the agent pushed, and the log names the branch that moved. It never settles on a build of someone else's commit (#1199).
- An agent's loop can run as one JS process for the agent's whole life, from `board/plot-worker-loop.mjs`, behind the `Worker loop` key. `plot-worker-loop.sh` stays as the launcher that adopting repositories name in `Worker command`.
- In the JS loop, the CI wait reads the build pipeline's runs for the agent's pushed commit, through the build connector. A continued or corrected desk waits the same way as a dispatched one (#1255).
- A running JS loop restarts itself on a newer, loadable bundle in this repository's main checkout, while it waits for work. It keeps its pid, and the restart does not extend the wait's `Worker bound`.
- The loop's decisions are covered by the domain's 100% coverage gate. Before, no coverage tool measured them.
- The JS loop becomes the default, and then the shell loop, `plot-build-monitor.sh` and the BuildMonitor process are removed. The JS loop writes the build findings file that the board reads.

<!-- Board impact: no change to the plan format, the template or the docs/plans layout. The board reads the same manifests, logs and findings files. Until slice 6 the BuildMonitor writes the build findings file in both modes; from slice 6 the JS loop writes it in the same shape, so the board's findings reader is unchanged. buildMonitorPid reads empty after slice 6, which removes the field and its readers together. Slice 3 adds the bundle board/plot-worker-loop.mjs, declared in packages/board/build.mjs and built on main. -->

## Motivation

Measured on `main` on 2026-10-04:
- `skills/plot/scripts/plot-worker-loop.sh` holds 891 non-comment lines (3,137 with comments) in 52 functions.
- It sources four helpers: `plot-agent-manifest.sh` (94), `plot-worker-state.sh` (530), `plot-transcript-quiet.sh` (39) and `plot-tmp.sh` (87).
- It starts seven bundles: `plot-checkout-yield`, `plot-checks-verdict`, `plot-claim-answer`, `plot-empty-claim`, `plot-prompt-exit`, `plot-prompt` and `plot-slice-spend`.
- Its CI wait reads findings from `plot-build-monitor.sh` (162), a separate process that `plot-dispatch.sh` starts.
- `git grep -l plot-worker-loop -- test` lists 30 test files, 5 of them under `test/e2e`. `workerloop.test.mjs` alone takes 141 s.

`the-shell-shrinks-into-the-domain` names this script as the first follow-on plan, because the shell ratchet bites here first: the loop grew 287 lines in the three days to 2026-10-03, and every open PR that grew the shell that day edited it. The cost rule in `docs/shell-and-domain.md` is the reason it stayed shell. The loop runs once per agent per pass, so each decision it asks costs a `node` start, and the declared duplicates exist to avoid that. `the-worker-loop-asks-the-domain` (2026-09-07) decided "not a rewrite of the loop" for the same reason. A long-running process removes that per-pass start, so the reason no longer holds once the loop is JS.

**On 2026-10-03 and 2026-10-04, five failures came from the loop and the processes around it:**

1. An agent ended its prompt turn while it waited on a background job. The loop found the desk held by uncommitted work, cut a new desk and went on with 14 files left behind (#1246). It happened twice: `the-queue-reads-the-scans-order` and `the-parser-reads-every-wait`.
2. A continued agent had no BuildMonitor, so its CI wait expired after 1,800 s with "no CI answer" while CI had failed (#1255, PR #1249).
3. A dispatched agent's BuildMonitor reported the first failure and missed the run after the correction. The loop let go after 3,600 s and correction 2 never ran (#1255, PR #1269).
4. An agent stopped on a `PLOT-BLOCKED` marker, its loop ended on the wait bound, and the board read exit 124 as a crash (#1250).
5. The board process ran for a day and a half on the code it loaded at start, with no reload, and kept a repair that #1263 had retired. A long-running loop has the same exposure, so this plan adds the fix together with the process.

On 2026-10-04 the cost jurors also found monitor processes and loops with parent pid 1, alive for 2 to 3 days, from desks that no longer existed: 8 monitors and 2 loops in round 1, and 4 more monitors from a deleted desk in round 4. The dispatch wrapper starts the monitors as background jobs and nothing stops them when the wrapper ends.

Each of these is a decision taken in shell, or across processes that share a file, that no unit test reaches. No coverage tool measures the shell, so nobody can see which of the loop's branches its test files miss.

## Design

**What this section holds.** It states the decisions an approver needs, and the rules and functions each decision rests on, by name. It holds no line numbers. Each slice's brief carries the line-level facts (call sites, write sites, test lines), and the implementer checks them against the code of that day. Four rounds found that a line-level claim in the plan goes stale between rounds, while a decision does not.

### Approach

**The loop asks a domain workflow, in the estate's existing shape.** `packages/domain/src/workflows/agent-loop.ts` exports `agentLoop(readings) -> Decision | Refusal`, the form `workflows/decision.ts` fixes for every workflow. It carries no state between passes. Each pass, the loop derives where the agent stands from the readings: the manifest's assignment, the desk's `resetRefusals`, the prompt's exit, the idle reading, the branch's remote tip and the build runs for the agent's pushed commit. This is the property `workflows/supervise.ts` keeps, so that `kill -9` costs one pass. `agentLoop` never persists a state. A test asserts that nothing writes one, as `transitions/agent.ts` states for `AgentState`.

**The loop reuses the write kinds that exist, and one applier carries them out.** A `Decision` holds ordered `Write` values from the one union in `workflows/decision.ts`. Where a kind exists for the write, the loop emits it: `blocked-marker` for a marker, `agent-resume` for a correction, `agent-attempt` for a start retry, `push` for the claim push and for pushed work, `commit` and `worker-signal`. A second kind for the same write is what `decision.ts` rules out. The loop adds kinds only for writes no kind covers: `desk-reset`, `assignment-clear`, `prompt-run` (the first run on a slice), `correction-count`, `declaration` (`ok` or `blocked`), `slice-spend`, `loop-end` (the ending, its `endings.jsonl` line, and the limited record where the ending is `limited`), `worker-finding` and `build-finding`. `assignment-clear` clears the manifest's `branch` field, as `clear_manifest_branch` does; `manifest-clear` deletes the manifest and is not used. The new kinds join the `Write` union. `perform-fs.ts`, the domain's sandbox performer, names each in its set of kinds it skips on purpose, because it throws on any kind it does not name. Slice 2 adds `performLoopWrites` in `packages/board/src/server/entry/loop-writes.ts`, beside the applier `registryd-main.ts` already holds. It carries out every kind the loop emits through a port call, and its `switch` ends in a `never` check, so a kind it does not handle fails `tsc`. `WorkflowName` gains `agent-loop`.

**The loop ends with the reasons the estate already has, plus two.** `EndingReasonSchema` holds `bound`, `quiet`, `unreadable`, `spent`, `unstarted`, `limited` and `unregistered`, and `the-shell-loop-holds-unlanded-work` adds `holding-work`. This plan adds `blocked` and `checks-unanswered` (slice 1). No watcher produces any of them. The agent's own loop observes the desk and the build and stops, so `endingIsAttributable` admits actor `agent` for them, beside `unstarted`, `limited` and `unregistered`. The doc comment on actor `agent` in `entities/ending.ts`, which `the-shell-loop-holds-unlanded-work` rewrites for `holding-work`, is extended to the two new endings. `bound` keeps its meaning: a watchdog cut a prompt short.

**Every ending that waits for a person also declares `blocked`.** `supervise` reads the declaration file (`.plot-worker.envelope.json`) and never the marker. It answers `needs-a-person` only for a declaration that says `blocked`. With no declaration it answers `correct`, and a correction is the wrong answer to a question the agent asked. So with every `blocked`, `unstarted`, `limited` and `checks-unanswered` ending, the loop also writes a `declaration` with `status: blocked`, naming the branch and the reason. `holding-work` writes none, by the decision `the-shell-loop-holds-unlanded-work` made: `supervise` answers `correct`, and the correction tells the agent to land its work. This plan changes no rule.

**The table.** Each row gives the readings, the decision, the ending and exit, and what the shell loop does today. The last column is what `supervise` answers for the dead worker afterwards: `leave` (the worker is alive), `needs-a-person`, `correct`, or `not asked` (no slice, or no manifest). Those are `supervise`'s own verdicts, and slice 1's test asserts each one through `supervise`. Where the desk goes is `deskLifecycle`'s answer, and this plan changes none of it. The test asserts `deskLifecycle`'s exit for each row over the desks the row can leave (clean or dirty; with or without a file-changing commit), and the brief lists them.

| Readings | Decision | Ending, exit | Today (shell loop) | `supervise` |
|---|---|---|---|---|
| no assignment, inside `Worker bound` | wait one pass | none | the same | leave |
| no assignment, `Worker bound` reached | end | none, 124; the log names the wait | the same | not asked (no slice) |
| manifest gone (`loopRegistration` answers `gone`) | `loop-end` | `unregistered`, 124 | the same | not asked (no manifest) |
| an assignment | `push` of the claim; a refusal carries `claimAnswer` | none | the same | leave |
| prompt running, `idleNow` answers idle | `worker-finding`, `loop-end` | `quiet`, 124 | the same | correct |
| prompt running, idle reading unavailable past the floor | `worker-finding`, `loop-end` | `unreadable` or `bound`, 124 | the same | correct |
| prompt exit `unstarted` | `agent-attempt` per retry, then `blocked-marker`, `declaration` blocked, `loop-end` | `unstarted`, 1 | the same marker, no declaration | needs-a-person |
| prompt exit `wait` (a usage limit with a known reset) | wait until the reset, inside `Worker bound` | none | the same | leave |
| prompt exit `end-limited` | `blocked-marker`, `declaration` blocked, `loop-end` | `limited`, 1 | the same marker, no declaration | needs-a-person |
| prompt exit `ran`, the agent wrote a `PLOT-BLOCKED` marker | `declaration` blocked, `loop-end` | `blocked`, 0 | goes free; the desk is left for the sweep | needs-a-person |
| prompt exit `ran`, no marker, `resetRefusals` names `uncommitted-changes` or `unpushed-commits` | `loop-end` | `holding-work`, 0 | the same, from `the-shell-loop-holds-unlanded-work` (#1246) | correct |
| prompt exit `ran`, work pushed, a PR open | wait for checks | none | the same, through the BuildMonitor | leave |
| checks pass | `declaration` ok, `slice-spend`, `assignment-clear`, then free | none | the same | leave |
| checks fail, correction budget left | `agent-resume` with the correction, `correction-count` | none | the same | leave |
| checks fail, budget spent | `blocked-marker` naming the PR and each correction, `declaration` blocked, `loop-end` | `blocked`, 0 | `unstarted`, 1, with the same marker | needs-a-person |
| no check answer by `Checks wait` | `declaration` blocked, `loop-end` | `checks-unanswered` (`no-answer`), 0 | lets go of the slice and goes free | needs-a-person |
| the remote tip is no longer the pushed commit | `declaration` blocked, `loop-end` | `checks-unanswered` (`tip-moved`), 0 | waits on the old commit until `Checks wait` | needs-a-person |
| the remote tip cannot be read | keep waiting, inside `Checks wait` | none | not read | leave |

**A marker on an empty desk is reaped, as today.** `deskState` reads a marker desk with no unlanded work and no file-changing commit as `refused-empty`, and `deskLifecycle` copies the marker's text to the refusals log and then reaps the desk. An `unstarted` or `limited` ending on a fresh desk is that case. The question survives in the log and in the `blocked` declaration that `supervise` answers with `needs-a-person`, and the claim ref still names the slice. `/api/continue` answers a marker desk that still exists. This plan does not change that rule.

The desk is reset at take-up, onto the branch the loop is handed, as today. The free wait comes before it. At take-up, a desk that `resetRefusals` names for `uncommitted-changes` or `unpushed-commits` ends the loop `holding-work` with actor `agent`: the loop writes no reset, no claim, no prompt and no declaration, and the ending's detail names what holds the desk. A desk that `resetRefusals` names only for `blocked-marker` holds an unanswered question: the loop ends `blocked` with actor `agent`, writes a `blocked` declaration so `supervise` answers needs-a-person, and writes no reset, no claim commit, no push and no prompt.

**Five rows change today's behaviour, and the slices say which.** The agent-written marker, the spent budget, the unanswered wait, the moved tip and the unreadable tip (slices 1 and 3). Four more add a `blocked` declaration where today the shell writes only the marker. Today the shell loop goes free after any CI-wait verdict and after an agent-written marker. The JS loop ends instead, so the slice stays with its desk. The exit codes change only where the table says so. The dispatch wrapper turns exit 0 into a `clear` line and a non-zero exit into `gone`, and the board's attention rule reads `gone` as "restart it". So an exit-0 `blocked` ending is what fixes #1250, and slice 6 keeps the wrapper's path when it removes the monitors.

**A loop that is blocked or holds work ends, and the desk carries what is left.** `deskState` reads `working` for any desk with a live worker, so a loop that stayed alive in either state would hide the person that `deskLifecycle` names. A spent budget follows at least one pushed correction, so `markerRecordsWork` holds through the file-changing commits, and that desk is never reaped as empty.

**`Worker bound` holds where it applies today.** It bounds each prompt run and each free wait, never the loop's whole life. Every waiting row is inside the bound. A restart happens only in a free wait, and it carries that wait's start time in `PLOT_WAIT_STARTED`, so a restart cannot extend the wait (Manifesto principle 13).

**The idle watch stays.** An agent that has gone quiet has failed, not finished (principle 13). Each pass the JS loop asks `idleNow` (`rules/sample.ts`, paired with `plot_worker_idle_now` by `corpus/sample.corpus.test.ts`). It writes the result in the WorkerMonitor shape and ends with `quiet` or `unreadable` as the shell loop does. Slice 3 moves the transcript reading that `plot-transcript-quiet.sh` supplies into an adapter.

**Three counts stay apart, and they are declared.** The loop counts corrections on a live desk (`correctionAttempts`, written by `correction-count`). The loop counts start retries for a prompt that exits `unstarted`, and each raises the manifest's `attempts` through `agent-attempt`, the kind the supervisor also writes, the counter the supervisor reads for relaunches (`MAX_ATTEMPTS` in `rules/supervision.ts`). That sharing is today's and stays. The supervisor counts relaunches in the same `attempts`. A test asserts that a correction raises no `attempts`, and that a relaunch or a start retry raises no `correctionAttempts`.

**The CI wait reads the build for the agent's pushed commit** (#1255, #1199). The commit is the desk's `HEAD` once pushed, the same commit the BuildMonitor reads. The runs come from `BuildPort.runForSha(branch, sha)` (`ports/build.ts`), which has adapters for GitHub Actions, Jenkins, none and a fixture. A Bitbucket-plus-Jenkins repository therefore waits through its own connector, as `the-build-pipeline-is-its-own-connector` decided. Each poll also reads the branch's remote tip through a new `refs` operation, `remoteTip(branch)`, over `git ls-remote` with a 10 s timeout. It is new because `refs.remoteHead` and `refs.branchTips` read local refs and see no other party's push. The answer has three values: the pushed commit, another commit, or `unknown`. Another commit ends the wait with `checks-unanswered`, reason `tip-moved`, and the log names the branch that moved. A wait that reaches `Checks wait` ends with reason `no-answer`. `unknown` keeps the wait going inside `Checks wait`, because a failure to observe is not evidence. The comparison is equality, not ancestry, so the wait settles only on a build of the agent's own commit and takes no `plot-ancestry` declaration. In #1199 a person pushed `0e64fafd` on top of the agent's `f743e573`; the wait ends there, and the build of `0e64fafd` is that person's. A connector that cannot answer reads `unknown`, never "no CI answer".

**Two checks rules exist during the transition, and both are declared.** `rules/checks-verdict.ts` keeps its BuildMonitor-findings input, because the shell loop calls it through `plot-checks-verdict.mjs` until slice 6. Slice 1 adds `checksFromRuns` beside it, over build runs. Slice 6 removes the findings form and its bundle. `rules/checks-reading.ts`, the board's rule over host readings, does not change.

**The CI wait is a declared exception to "A Decision Reads The Index".** The index holds no non-terminal answer that the loop could trust, because a check result or an open-PR state goes stale in either direction. The exception covers two readings. The PR-open reading is asked once per finished prompt, as today, through the host port. The build reading is asked at most once per 60 s per waiting agent, through `BuildPort`. The build connector's rate budget pays for those calls, and the loop records each one there. Until slice 6 the BuildMonitor also polls in `js` mode, so a waiting agent costs about 180 build calls an hour instead of 60. At 8 agents that is 1,440 an hour, inside GitHub's 5,000 REST limit. The tip reading is a git call and costs no host budget. The loop never writes the PR index; `fleet.ts` stays its one writer.

**One writer for the build findings file at a time.** Until slice 6 the BuildMonitor writes the build findings file in both modes, and the JS loop reads `BuildPort` for its own decision and writes nothing there. Slice 6 removes the monitor and its start in `plot-dispatch.sh`, and the JS loop then writes each answer to that file in the BuildMonitor shape. The board's reader does not change.

**The prompt is the project's.** The loop runs the prompt that the dispatch skill declares: `.plot/worker-prompt.sh` when the project has one, and otherwise the shipped prompt. Plot names no harness (Manifesto principle 5).

**The loop's reads and writes go through ports.** The constraints are the plan's. The operations, and the shell code each one replaces, are slice 2's brief.
- Every write the loop makes goes through an adapter port. The spawn ratchet (*One place reaches a process*) does not grow, because every new spawn sits inside `adapters/`.
- `processes` stays read-only, and gains a read of a process's descendants for the bound's kill. `performer` keeps its contract: it starts detached processes that outlive the caller.
- A new port, `boundedRun`, runs a child that the caller owns: the prompt, and the self-check before a restart. It is the opposite of `performer`, so it is its own port.
- A new port, `reexec`, replaces the running process (`process.execve`), with its adapter in `adapters/process-exec.ts`. Slice 4 adds it, with its one caller.
- Reads use the ports that exist where they can: `trees` for the main checkout's status and the worktree list, `refs.contains` for ancestry (its adapter already declares `plot-ancestry: evidence`), and `agents` for the manifest.
- A new `desk` port writes the desk's files: the ending and its `endings.jsonl` line, the marker, the declaration, the correction file, the limited record, the moved worker record and the findings lines.

**The prompt stays in the agent's process group.** `plot-dispatch.sh --stop` ends an agent by signalling its process group, because its wrapper, loop and `claude` share one group (#1084). `boundedRun` therefore starts the prompt without `detached`, so the group stop still reaches it. On the bound it signals the prompt's process and its descendants, read through `processes`. The JS loop starts no sidecar. The dispatch wrapper still starts `plot-agent-monitor.sh`, and until slice 6 the BuildMonitor. So this plan stops orphaned loops and prompts and, from slice 6, orphaned build monitors. An agent monitor can still outlive its wrapper, and that stays a dispatch defect outside this plan.

**The launcher starts no Node in `shell` mode.** From slice 3 the first lines of `plot-worker-loop.sh` read `Worker loop` through `plot-config.sh`. On `js` they `exec node` the bundle beside the script; on `shell` the script continues into its own body. The default path for an adopting repository therefore runs no Node and needs no Node feature. The key read is the one decision a launcher makes, and slice 6 removes it with the key. With `js` and no bundle, the launcher exits 2 with the message form `the-shell-shrinks-into-the-domain` set. It never falls back silently.

**Restart on new code.** In this repository `Worker command` is a relative path that the wrapper runs from the desk, so the launcher and the bundle it starts are the desk's copies. A desk carries the bundle of the main it was cut from, or of a slice branch. The loop resolves the main checkout as the first entry of the worktree list, through `trees`, and pins the bundle path there. It records the main checkout's `HEAD` at the moment it pins: that is the loaded commit. Squash-merge never puts a desk's commit on main, so the loaded commit is never the desk's.

The first check runs before the first pass. It asks only whether the main checkout is on the default branch with clean bundle paths, and whether the pinned bundle's content hash differs from the running one. A loop started from a desk's older bundle therefore moves to main's bundle at once.

Every later check runs while the loop waits for work, and it restarts only when all four conditions hold:
- The main checkout is on the default branch.
- Its bundle paths are clean.
- Its `HEAD` contains the loaded commit. This ancestry reading is declared `plot-ancestry: evidence`: a wrong "yes" starts a restart, and the restart rule decides from it.
- The pinned bundle's content hash differs from the loaded one.

Before any restart, the loop proves that the new bundle loads: it runs `node <bundle> --self-check` through `boundedRun` and requires exit 0 within 10 s. A bundle that fails the check is logged once and not used, so a broken bundle stops no loop. On success the loop calls `reexec` with the same arguments and `PLOT_WAIT_STARTED`. `process.execve` is the only restart that keeps the pid, and the dispatch wrapper's `wait` and the manifest's `pid` depend on that pid. It exists from Node 22.15 and is experimental. The cost jurors measured that it keeps the pid on v24.4.1 and that it is absent on v20.19.4. On a Node without it, the JS loop runs and never restarts, and it logs that once. The same check restarts the loop when its resident memory passes 300 MB while it waits for work.

**The restart is a domain rule.** `restartAnswer(readings)` in `packages/domain/src/rules/loop-restart.ts` decides from the readings above (first check or later, the four conditions, the hash, the resident memory, whether `process.execve` exists): `stay`, `restart`, or `stay-and-log` with the reason. The entry asks it and carries the answer out, and decides nothing. Motivation's failure 5, a process that runs old code, is that rule's test case.

**Restart scope.** The restart fires when the operator updates this repository's main checkout. The number of restarts follows those updates, not the merge count. In an adopting repository, a plugin upgrade installs a new versioned directory and leaves the old bundle unchanged. There the loop runs the old code until the supervisor relaunches it, and the Changelog says "this repository's main checkout" for that reason.

**Costs, measured 2026-10-04.**
- **Memory:** about +51 to 74 MB per agent in `js` mode. A bash loop holds 2 to 5 MB, a long-running Node process with the adapter estate holds 58 to 81 MB, and removing the build monitor saves about 6 MB; the agent monitor stays. That is 7 to 10% of the 743 MB `claude` process each loop runs. `shell` mode costs nothing new.
- **CPU:** negligible. A restart is one Node start and one self-check, tens of milliseconds each.
- **Build calls:** about 180 an hour per waiting agent from slice 3 to slice 6, then 60. The tip reading adds one `git ls-remote` per poll, about 0.4 s, bounded at 10 s.
- **CI:** from slice 3 to slice 6, a separate job `loop-js` runs the loop's tests with `Worker loop: js`, on `pull_request` only, with `timeout-minutes: 20`, in parallel with `validate`. The contract step already takes 408 to 502 s against its 720 s limit, so the loop's files do not join it. The `plot-pm` organisation runs at most 20 jobs at once, and over the 24 hours to 2026-10-04T20:45Z the peak was 21 concurrent jobs. Jobs from pushes to `main` queued up to 1,077 s; PR jobs queued at most 39 s. So `loop-js` takes a `paths` filter: it runs only on a PR that touches the loop, its workflow, its ports and adapters, or its test files. Slice 3's PR records the job's run time and its queue time.
- **Shell:** slice 6 removes about 1,100 lines: the loop's body, the build monitor, the transcript reader, and three manifest functions.

**Tests on `js`.** One switch decides the loop for a test run: the test helpers read `PLOT_TEST_WORKER_LOOP` and write `- **Worker loop:** <value>` into each sandbox repository's `## Plot Config`. `plot-config.sh` gains no override, because the switch lives only in the test helpers. `test/reconcile/` has no shared sandbox helper today, so slice 3 adds one, and the files that start a loop use it. Test files that source the shell body (`PLOT_WORKER_LOOP_SOURCED=1`) test shell functions, not the loop's behaviour. They stay out of `loop-js`, and slice 6 removes them with the body. Slice 3's brief lists both groups with the command that found them.

**Coverage.** Every row of the table is a decision in `packages/domain/src/workflows/`, so the domain's 100% lines, branches, functions and statements gate covers it. The entry `packages/board/src/server/entry/worker-loop.ts` decides nothing: each branch in it is either an adapter call or `agentLoop`'s answer. The board package has no coverage tool today, so slice 2 adds `@vitest/coverage-v8` to it, a coverage block over `loop-writes.ts`, and a CI step that runs it; slice 3 adds the entry file to the block. They are the first gated files in the board package. Motivation's failures 1 to 4 become table cases in the workflow's unit test, and failure 5 a case of `restartAnswer`.

**The baseline.** `plot-reap.sh` removes a desk's log and ending file with the desk, and each loop end overwrites the ending file, so no past window can be counted. From `the-shell-loop-holds-unlanded-work`, the shell's `write_ending` also appends each ending as one line to `.plot/state/endings.jsonl` in the main checkout, which the reaper does not touch. The JS loop appends to the same file through `loop-end`. The operator (jwloka) collects the rest daily, from that plan's merge to slice 3's merge, into `docs/notes/the-worker-loop-runs-in-js-baseline.md`: the issues filed, one reading of `ps -eo pid,ppid,rss,etime,command` for loop, monitor and prompt processes whose desk no longer exists, and from the same reading the resident size of each live loop, build monitor and `claude` process. A process older than the window is excluded. A daily reading misses an orphan that lives less than a day, so kinds 4 and 5 are a lower bound. A kind that no source shows is recorded as unmeasured, never as zero.

### Slices

**Slice 1: the loop's workflow.** `agentLoop` in `packages/domain/src/workflows/agent-loop.ts`, with:
- the table above
- the new `Write` kinds, and their names in `perform-fs.ts`'s skip set
- the `declaration` written with every ending that waits for a person
- the endings `blocked` and `checks-unanswered`, and their admission in `endingIsAttributable`
- `checksFromRuns`, beside the unchanged `checksVerdict`, with the three-valued tip reading
- the table test: `supervise`'s verdict for every row, and `deskLifecycle`'s exit for every desk a row can leave; the spent-budget desk test; and the three-count test
- failures 1 to 4 as table cases

If `scripts/check-state-declarations.sh` asks for a `transitions/` rule for any new enum, the slice adds it. No caller yet. The slice is done when the domain coverage gate passes over the new file.

**Slice 2: the loop's writes go through ports.**
- `performLoopWrites` in `packages/board/src/server/entry/loop-writes.ts`, with a `never`-checked `switch` over the kinds the loop emits.
- The `boundedRun` and `desk` ports and their adapters, `refs.remoteTip`, the descendants read on `processes`, and the new operations on `refs` and `agents`.
- `boundedRun` keeps the prompt in the caller's process group, and kills the prompt's process tree on the bound, on `SIGTERM` and on the caller's exit.
- A test starts a stand-in parent, a small Node script that calls `boundedRun`, and its prompt in one group, and proves that the group stop of `plot-dispatch.sh --stop` ends both (#1084).
- CI tests it on Linux, including under `systemd` with `KillMode=process` (#1148), in the step that already drives systemd. Every CI job runs on `ubuntu-latest`, so the PR records a local macOS run of the same test with the command and its output.
- `@vitest/coverage-v8` in the board package, gating `loop-writes.ts`.

The slice is done when every kind `agentLoop` emits has an arm in `performLoopWrites`, each arm has a test against a port fixture, the group-stop test passes on Linux, and the coverage gate passes over `loop-writes.ts`.

**Slice 3: the loop runs in one process.** `packages/board/src/server/entry/worker-loop.ts`, bundled to `skills/plot/scripts/board/plot-worker-loop.mjs`.
- **The launcher.** The `Worker loop` key read and `exec` at the top of `plot-worker-loop.sh`, at most 4 lines, default `shell`.
- **Shell ratchet.** The PR runs `scripts/check-shell-lines.sh pr` and removes at least as many shell lines as it adds anywhere, and it names each one.
- **No bundle.** Exit 2 as above.
- **Manifest.** The loop records `loop: js` or `loop: shell` in the manifest.
- **Transcript reading.** The reading `plot-transcript-quiet.sh` supplies moves into an adapter, for the JS idle watch.
- **Coverage.** The entry file joins the board's coverage block.
- **CI.** The `loop-js` job with its `paths` filter, the `PLOT_TEST_WORKER_LOOP` switch, and the shared sandbox helper in `test/reconcile/`.
- **Tests.** Each contract change this plan makes on purpose is rewritten and named in the PR: the source-text assertions over the loop become behaviour tests, and the files that read a BuildMonitor line take a `BuildPort` fixture on `js`. Any other failure against `js` names a behaviour the plan did not list. It is reported and never rewritten to pass.
- **Baseline.** The PR records the count from the baseline file, the days and the slices it read.
- **After merge.** The operator sets `- **Worker loop:** js` in this repository's `## Plot Config`, in its own commit. Slice 5's window starts at that commit.

**Slice 4: the loop restarts on new code.**
- `restartAnswer` in `rules/loop-restart.ts`, with failure 5 as its test case.
- The `reexec` port and its adapter.
- The main-checkout bundle path and the loaded commit, resolved through `trees`.
- The first check before the first pass, and the four conditions after it.
- The `--self-check` load test through `boundedRun`.
- `reexec` with `PLOT_WAIT_STARTED`, and the logged no-restart path on a Node without `process.execve`.
- The memory ceiling.
- Tests:
  - a restart keeps the pid and does not extend the free wait's `Worker bound`;
  - a bundle that fails the self-check stops no loop;
  - a checkout that moved backwards or is dirty triggers no restart;
  - a loop started from a claimed desk's bundle moves to the main checkout's bundle before its first pass, and restarts again after main moves.

**Slice 5: JS is the default loop.** `Worker loop` is one key per repository, so this repository runs no `shell` slices once it is set to `js`. The comparison is therefore against the baseline. The default flips to `js` when the fleet has run at least 20 slices on `js`, and both conditions hold:
- the `js` loop's listed failures per slice are no more than the baseline's;
- the `js` loop has none of the first, fourth or fifth kind.

The manifest's `loop:` line shows which loop ran a slice. These count as loop-caused failures:
1. a desk that ended free with unpushed or uncommitted work;
2. a CI wait that ended unanswered while the build connector had an answer;
3. a loop exit that held a slice and recorded no reason;
4. a loop process that outlives its desk;
5. a prompt process that outlives its loop.

Each kind has one source, the same on both sides where one exists:
- kind 1: the issues filed, and a desk the reaper reports as holding work with no ending in `endings.jsonl`;
- kind 2: on `js`, a `checks-unanswered` ending with reason `no-answer` whose commit `BuildPort` later answers with a conclusive run. The shell loop's expired wait writes no ending, so on `shell` the issues filed are the only source;
- kind 3: a `gone` or `clear` line from the dispatch wrapper for a branch with no matching line in `endings.jsonl`;
- kinds 4 and 5: the daily `ps` reading, a lower bound on both sides.

A kind whose two sides come from different sources is reported for each side and does not enter the per-slice comparison. The flip needs the `js` count of that kind named, and zero for kinds 1, 4 and 5. The slice names the slices it counted, the failures of each kind, and the baseline.

**Memory and tokens are measured on both sides.** They do not gate the flip. They are the record the open question on one process per agent or per machine needs, and the answer to whether the JS loop costs fewer tokens for more memory.
- **Tokens:** each slice's record in `slice-spend.jsonl`, which `record_slice_spend` and `workflows/slice-spend.ts` already write at the seal. The slice reports the median and the sum per slice of the four counters (input, output, cache creation, cache read) separately, because cache reads are about 99% of a naive total. Only a sealed slice has a record, on either side. A slice that ended by a bound, the idle watch or a `blocked` ending records nothing, so the count of those slices is reported beside the sums, never as zero tokens. Slices that ran a correction are reported apart, because a correction is where the two loops differ most (#1255).
- **Memory:** from the daily reading, the resident size per agent of the loop process, plus the build monitor on `shell` until slice 6. The `claude` process's size is reported for scale. A daily reading is a sample, so the slice reports the median and the largest reading per side.
- **Per machine:** the sum over live agents at each reading, beside `plot-registryd`'s own resident size. That is the figure a per-machine loop would replace.
- **Master side:** the tokens a master agent spends finding out what a loop did. The source is the master sessions' transcripts in the main checkout's Claude Code project directory, interactive sessions only (`entrypoint: cli`; Plot's own `claude -p` runs read `sdk-cli`). Transcripts on this machine go back to 2026-09-09, so the shell side is counted after the fact over the same days as the baseline. A tool call counts when it reads the loop's state the long way: the loop's shell sources (`plot-worker-loop.sh`, `plot-build-monitor.sh`, `plot-worker-state.sh`), a desk's `.plot-worker.*` files, the process table (`ps`, `pgrep`, `lsof`), or `git worktree list`. The brief fixes the pattern list, and one read-only script, `scripts/count-master-diagnosis.mjs`, applies it the same way to both windows. Per window, it reports the matching calls and the characters of their results, with a tokens estimate at 4 characters per token labelled as an estimate, per slice delivered in that window. What the operator asks varies between windows, so the figure is reported, not compared against a threshold, and a window with no master session reads as unmeasured, never as zero.

**Slice 6: the shell loop goes.** `plot-worker-loop.sh` keeps only the `exec` of the JS entry. The `Worker loop` key, its read and `PLOT_TEST_WORKER_LOOP` are removed, with a note in `skills/plot-dispatch/SKILL.md` for adopting repositories. The JS loop starts writing the build findings file. Removed: the shell body, `plot-transcript-quiet.sh`, `plot-build-monitor.sh` and its start in `plot-dispatch.sh`, the `buildMonitorPid` field and its readers, `manifest_count`, `raise_manifest_count` and `manifest_resume_id`, the findings form of `checksVerdict` and its bundle, `corpus/desk-reset.corpus.test.ts`, the test files that source the shell body, and the three functions of `plot-worker-state.sh` that only the loop calls (`plot_worker_idle_watch_pass`, `plot_worker_conversation_spoken` and `plot_worker_publish_finding`), two of which call `plot-transcript-quiet.sh`.

**Done when** `git grep -l -e PLOT_WORKER_LOOP_SOURCED -e plot-build-monitor -e buildMonitorPid -e plot-transcript-quiet -e plot-checks-verdict -e manifest_resume_id` lists no file outside `docs/`, `.plot/` and `CHANGELOG.md` (pathspec `-- . ':!docs' ':!.plot' ':!CHANGELOG.md'`), and CI passes. The brief lists the files that grep finds on the day.

The rest of `plot-worker-state.sh` stays, `plot_worker_idle_now` included, because other shell scripts and domain adapters call it. `corpus/agent-state.corpus.test.ts` and `corpus/sample.corpus.test.ts` stay with it. The dispatch wrapper's exit-to-`clear`/`gone` path stays.

**When each fix reaches whom.** `the-shell-loop-holds-unlanded-work` fixes #1246 in every repository, before this plan's first slice. #1199 and #1255 stay open in this repository until the fleet runs on `js` after slice 3, and in adopting repositories until slice 5 flips the default. Until then they keep the BuildMonitor wait.

**What does not change.**
- `Worker command` keeps naming `plot-worker-loop.sh`, so no adopting repository edits its config. `plot-dispatch --start` refuses any other name.
- The manifests, logs and findings files the board reads keep their names and formats.
- The `PLOT-BLOCKED` and `PLOT-CORRECTION` files keep their names and formats.
- `plot-agent-monitor.sh` stays, and so does its start in `plot-dispatch.sh`.
- `taskState`, `deskState`, `deskLifecycle` and `supervise` keep their rules.

### Open Questions

- [ ] One process per agent, or one process per machine? `plot-registryd` already runs one long-lived Node process per machine (64 MB after 2 days), and it could run every agent's loop. That would save the +50 to 75 MB per agent. The operator chose one process per agent on 2026-10-04. Slice 5 measures memory per agent and tokens per slice on both sides, and the answer is due before slice 6 removes the shell loop.
- [ ] Does `taskState`'s PR-first order hide a blocked agent? A desk with a PR and a marker reads `finished` on the agent side and `refused-with-work` on the desk side. This plan changes neither rule, and slice 1's test asserts both.
- [x] Does the shell loop's `holding-work` fix ship as its own plan? — *answered round 4: yes, as `the-shell-loop-holds-unlanded-work` (jwloka, 2026-10-04); this plan's first slice waits on its branch*
- [x] Process groups and signals. — *answered round 1: slice 2 decides them before the process slice; round 2: Linux in CI, macOS recorded in the PR; round 3: the prompt stays in the agent's group, so the #1084 group stop reaches it; round 4: `boundedRun` is its own port, apart from `performer`*
- [x] Does `plot-agent-monitor.sh` move into the process? — *answered round 1: no; round 2: dispatch starts it, so it stays with dispatch*

## Slices

### The loop has a workflow

- `infra/the-loop-has-a-workflow` — `agentLoop(readings) -> Decision | Refusal` in `packages/domain/src/workflows/agent-loop.ts`, its table and the tests through `agentState`, `deskState`, `deskLifecycle` and `supervise`, the loop's `Write` kinds and endings, and `checksFromRuns` → #1279 <!-- builds: agentLoop, a domain workflow --> <!-- waits: infra/the-shell-loop-holds-unlanded-work -->

### The loop writes through ports

- `infra/the-loop-writes-through-ports` — `performLoopWrites`, the `boundedRun` and `desk` ports, `refs.remoteTip`, and a bounded prompt run in the agent's process group → #1282 <!-- builds: performLoopWrites and the loop's ports -->

### The loop runs in one process

- `infra/the-loop-runs-in-one-process` — `board/plot-worker-loop.mjs` runs `agentLoop` behind `Worker loop: js`, the launcher reads the key and `exec`s it, and the `loop-js` CI job runs the loop's tests on `js` → #1292 <!-- builds: plot-worker-loop.mjs, a long-running loop entry -->

### The loop restarts on new code

- `infra/the-loop-restarts-on-new-code` — `restartAnswer` and the `reexec` port; the loop restarts on a newer main-checkout bundle that passes its self-check, or past its memory ceiling, keeping its pid and its free wait's `Worker bound` → #1314 <!-- builds: the loop's self-restart -->

### JS is the default loop

- `infra/js-is-the-default-loop` — after 20 `js` slices at or under the shell baseline's failure rate, `Worker loop` defaults to `js` → #1330 <!-- builds: the js default for Worker loop -->

### The shell loop goes

- `infra/the-shell-loop-goes` — the shell body, `plot-transcript-quiet.sh`, `plot-build-monitor.sh`, `buildMonitorPid`, three manifest functions, the findings form of `checksVerdict` and the tests that source the shell body are removed, checked by one `git grep` <!-- builds: plot-worker-loop.sh as a launcher only -->

## Notes

- 2026-10-04, direction from jwloka: the loop runs as one long-running process; Type infra; reviewed in-session; own branches. Follows `the-shell-shrinks-into-the-domain`, which names this script as its first follow-on plan.
- 2026-10-04, measurement: code lines with `grep -vcE '^[[:space:]]*(#|$)'`; functions with `^[a-z_]+\(\) *\{`; bundles and sourced helpers read from the script's text. Memory, CI timings and `process.execve` measured by the cost jurors of rounds 1 to 5. The `gh api rate_limit` readings of rounds 2 to 4 read 0 used while the `X-RateLimit-Used` header read 335, so the plan states no measured REST headroom; slice 3's brief measures it from the header.
- 2026-10-04, round 1: four jurors (estate, contradiction, deliverable, cost), unanimous `amend`. Moderation in `.plot/panels/2026-10-04-the-worker-loop-runs-in-js/round1.md`.
- 2026-10-04, round 2: the same four lenses, unanimous `amend`. Moderation in `round2.md` in the same directory.
- 2026-10-04, round 3: the same four lenses, unanimous `amend`. Moderation in `round3.md` in the same directory.
- 2026-10-04, round 4: the same four lenses, unanimous `amend`. The amendment moved the line-level facts out of Design and into the slices' briefs. Moderation in `round4.md` in the same directory.
- 2026-10-04, round 5: the same four lenses, unanimous `amend`, on the plan after the split. Moderation in `round5.md` in the same directory.
- 2026-10-04, after round 4, direction from jwloka: the former slice 1 (the shell loop's `holding-work` ending, #1246) split out as `the-shell-loop-holds-unlanded-work`. The remaining slices are numbered 1 to 6.
- Related open issues this plan does not claim: #1250 (the board labels a blocked loop's exit 124 as a crash), #1186 (a hand-over restarts the idle reading), #1169 (a free agent runs a handed slice without its charter). The exit-0 `blocked` ending gives #1250 its fix once slice 3 runs, and it may close with that slice.
- 2026-10-07, direction from jwloka: slice 5 (#1330) merged before the fleet had run 20 slices on `js`. The 20-slice condition held the only two plans in flight, so no slice ran and the count could not grow. The comparison against `docs/notes/the-worker-loop-runs-in-js-baseline.md` continues on the slices that run after the merge; a loop-caused failure of the first, fourth or fifth kind reverts the default.
