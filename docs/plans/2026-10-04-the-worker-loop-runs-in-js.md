# The worker loop runs in JS

> An agent's loop is one long-running JS process that asks a domain workflow what to do next; `plot-worker-loop.sh` keeps only its name, as a launcher.

## Status

- **State:** Draft
- **Type:** infra
- **Issue:** #1246, #1255, #1199
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- An agent whose prompt ends with uncommitted or unpushed work ends its loop with the reason recorded, and the board names a person for the desk. It no longer goes free on that work (#1246).
- A CI wait settles on the checks for its branch's current head when someone pushes on top of the agent's commit (#1199).
- An agent's loop runs as one JS process for the agent's whole life, from `board/plot-worker-loop.mjs`. `plot-worker-loop.sh` stays as the launcher that adopting repositories name in `Worker command`.
- The CI wait reads the build pipeline's runs for the branch's current head, through the build connector. A continued or corrected desk waits the same way as a dispatched one (#1255).
- A running loop restarts itself on a newer bundle in this repository's main checkout, at a point where it holds no work. It keeps its pid and its `Worker bound`.
- The loop's decisions are covered by the domain's 100% coverage gate. Before, no coverage tool measured them.
- `plot-build-monitor.sh` and `plot-transcript-quiet.sh` are removed, and the BuildMonitor process no longer starts. The JS loop writes the build findings file that the board reads.

<!-- Board impact: no change to the plan format, the template or the docs/plans layout. The board reads the same manifests, logs and findings files. The JS loop writes .plot-worker.monitor.build.jsonl in the BuildMonitor shape, so findings.ts:42 and attention.ts:167 read it unchanged. buildMonitorPid in the board schema (schema.ts:3451) reads empty for a JS loop; the last slice removes the field and its renderer together. The last slice also adds the bundle board/plot-worker-loop.mjs, declared in packages/board/build.mjs and built on main. -->

## Motivation

Measured on `main` on 2026-10-04:
- `skills/plot/scripts/plot-worker-loop.sh` holds 891 non-comment lines (3,137 with comments) in 52 functions.
- It sources four helpers: `plot-agent-manifest.sh` (94), `plot-worker-state.sh` (530), `plot-transcript-quiet.sh` (39) and `plot-tmp.sh` (87).
- It starts seven bundles: `plot-checkout-yield`, `plot-checks-verdict`, `plot-claim-answer`, `plot-empty-claim`, `plot-prompt-exit`, `plot-prompt` and `plot-slice-spend`.
- Its CI wait reads findings from `plot-build-monitor.sh` (162), a separate process that `plot-dispatch.sh` starts.
- 30 test files name the loop, and 22 of them drive it in code. `workerloop.test.mjs` alone takes 141 s.

`the-shell-shrinks-into-the-domain` names this script as the first follow-on plan, because the shell ratchet bites here first: the loop grew 287 lines in the three days to 2026-10-03, and every open PR that grew the shell that day edited it. The cost rule in `docs/shell-and-domain.md` is the reason it stayed shell. The loop runs once per agent per pass, so each decision it asks costs a `node` start, and the declared duplicates exist to avoid that. `the-worker-loop-asks-the-domain` (2026-09-07) decided "not a rewrite of the loop" for the same reason. A long-running process removes that per-pass start, so the reason no longer holds once the loop is JS.

**On 2026-10-03 and 2026-10-04, five failures came from the loop and the processes around it:**

1. An agent ended its prompt turn while it waited on a background job. The loop went free with 14 uncommitted files on the desk (#1246). It happened twice: `the-queue-reads-the-scans-order` and `the-parser-reads-every-wait`.
2. A continued agent had no BuildMonitor, so its CI wait expired after 1,800 s with "no CI answer" while CI had failed (#1255, PR #1249).
3. A dispatched agent's BuildMonitor reported the first failure and missed the run after the correction. The loop let go after 3,600 s and correction 2 never ran (#1255, PR #1269).
4. An agent stopped on a `PLOT-BLOCKED` marker, its loop ended on the wait bound, and the board read exit 124 as a crash (#1250).
5. The board process ran for a day and a half on the code it loaded at start, with no reload, and kept a repair that #1263 had retired. A long-running loop has the same exposure, so this plan adds the fix together with the process.

On 2026-10-04 the cost juror also found 8 monitor processes and 2 loops with parent pid 1, alive for 2 to 3 days, from desks that no longer existed. The dispatch wrapper starts the monitors as background jobs and nothing stops them when the wrapper ends.

Each of these is a decision taken in shell, or across processes that share a file, that no unit test reaches. No coverage tool measures the shell, so nobody can see which of the loop's branches the 22 driving test files miss.

## Design

### Approach

**The loop asks a domain workflow, in the estate's existing shape.** `packages/domain/src/workflows/agent-loop.ts` exports `agentLoop(readings) -> Decision | Refusal`, the form `workflows/decision.ts` fixes for every workflow. It carries no state between passes. Each pass, the loop derives where the agent stands from the readings: the manifest's assignment, the desk's `deskState`, the prompt's exit and the build runs for the branch's head. This is the property `workflows/supervise.ts` keeps, so that `kill -9` costs one pass. A `Decision` holds ordered `Write` values. The loop uses the existing kinds `blocked-marker`, `commit`, `push`, `worker-signal` and `manifest-clear`, and adds the kinds it needs: `claim-push`, `desk-reset`, `prompt-run`, `loop-end` and `build-finding`. `agentLoop` never persists a state. A test asserts that nothing writes one, as `transitions/agent.ts` states for `AgentState`.

**The loop uses the words the estate already has.** It adds no third state vocabulary. The table below maps each situation to the `AgentState` the board derives (`transitions/agent.ts`) and the `DeskState` (`rules/desk-lifecycle.ts`), and a unit test asserts every row:

| Readings | Decision | `AgentState` / `DeskState` after |
|---|---|---|
| no assignment, inside `Worker bound` | wait one pass | `running` / none |
| no assignment, `Worker bound` reached | `loop-end`, reason `bound` | `ended` / none |
| manifest gone (`loopRegistration` answers `gone`) | `loop-end`, reason `deregistered` | `ended` / none |
| an assignment | `claim-push`; a refusal carries `claimAnswer` | `running` / `working` |
| prompt exit `wait` (`promptExit`: a usage limit with a known reset) | wait until the reset, inside `Worker bound` | `running` / `working` |
| prompt exit `end-limited` | `loop-end`, reason `limited` | `ended` / per desk |
| prompt exit `ran`, a `PLOT-BLOCKED` marker | `loop-end`, reason `blocked` | `waiting` / `blocked` |
| prompt exit `ran`, uncommitted or unpushed work, no marker (`checkoutYield` keeps it) | `loop-end`, reason `holding-work` | `stalled` / `holding-work` |
| prompt exit `ran`, work pushed, a PR open | wait for checks | `running` / `working` |
| checks pass | `desk-reset`, then free | `running` / none |
| checks fail, correction budget left | `prompt-run` with the correction | `running` / `working` |
| checks fail, budget spent | `blocked-marker`, then `loop-end`, reason `blocked` | `waiting` / `blocked` |
| checks give no answer by `Checks wait` | `loop-end`, reason `checks-unanswered` | `ended` / per desk |

**A loop that holds work or is blocked ends, and the desk carries what is left.** `deskState` reads `working` for any desk with a live worker (`desk-lifecycle.ts:158`), so a loop that stayed alive in `holding-work` would hide the person that `deskLifecycle` names. `/api/continue` starts a new loop on the desk (`continue.ts:333`) and refuses where two loops could share it, so a live loop in `blocked` would collide with the continue route. The loop therefore ends on both, writes the reason to `.plot-worker.ending.json`, and exits 0. `deskLifecycle` then names the person, and `/api/continue` starts the next loop as it does today. A recorded reason replaces exit 124, which is how the board reads a blocked loop as a crash (#1250).

**`Worker bound` holds in every state.** Every waiting row is inside the bound. A restarted process keeps the original start time (item "Restart" below), so a restart cannot extend the bound (Manifesto principle 13).

**Two correction budgets stay apart, and they are declared.** The loop counts corrections on a live desk (`correctionAttempts` in the manifest). The supervisor counts relaunches of a dead worker (`rules/supervision.ts:203`, `MAX_ATTEMPTS`). They count different events. A test asserts that a correction does not use a relaunch attempt, and that a relaunch does not use a correction.

**The CI wait reads the build connector for the branch's current head** (#1255, #1199). The head SHA comes from the `refs` port: the branch's remote tip after a fetch. The runs come from `BuildPort.runForSha(branch, sha)` (`ports/build.ts`), which has adapters for GitHub Actions, Jenkins, none and a fixture. A Bitbucket-plus-Jenkins repository therefore waits through its own connector, as `the-build-pipeline-is-its-own-connector` decided. The rule `rules/checks-verdict.ts` takes build runs as its readings instead of BuildMonitor findings. `rules/checks-reading.ts`, the board's rule over host readings, does not change. A connector that cannot answer reads `unknown`, never "no CI answer".

**The CI wait is a declared exception to "A Decision Reads The Index".** The index never holds a non-terminal answer that the loop could trust, because a check result for an open PR goes stale in either direction. The loop asks `BuildPort` at most once per 60 s per waiting agent. The build connector's rate budget pays for these calls, and the loop records each one there. The loop never writes the PR index; `fleet.ts` stays its one writer.

**The loop writes the build findings file.** Each CI-wait answer is also written as one line of `.plot-worker.monitor.build.jsonl` in the shape `plot-build-monitor.sh` writes today. The board's readers (`findings.ts:42`, `attention.ts:167`) and the attention rows therefore keep working, and the separate monitor process can go.

**The prompt is the project's.** The loop runs the prompt that the dispatch skill declares: `.plot/worker-prompt.sh` when the project has one, and otherwise the shipped prompt (`plot-dispatch/SKILL.md:204`). Plot names no harness (Manifesto principle 5).

**The loop's writes go through ports.** The existing adapters cover the loop's reads. They cover none of its writes, so a slice adds them before the process exists:

| Write | Port | Starting point |
|---|---|---|
| claim push, desk reset, commit, push | `refs` (new operations) | the shell loop's `reset_desk` and claim push |
| a prompt run under a bound, and its process-group kill | `processes` (new operation `runBounded`) | `adapters/run-script.ts:58-66`, which already spawns `detached: true` and kills the group with `process.kill(-pid, 'SIGKILL')` |
| manifest write | a domain port over `manifest-stamp.ts` | `packages/board/src/server/manifest-stamp.ts` |
| `.plot-worker.ending.json`, `PLOT-BLOCKED.md`, the build findings line | `plan-store` or a new `desk` port | the shell loop's writers |

The spawn ratchet (`ci.yml`, *One place reaches a process*) does not grow, because every new spawn sits inside `adapters/`.

**The process owns its children.** The loop runs every child in its own process group and kills that group on every exit path. It starts no sidecar monitor. The orphans in Motivation cannot come from a JS loop.

**Restart on new code.** The launcher pins the bundle path when it starts the loop. The path is the bundle in this repository's main checkout, never the desk's copy. A desk follows each slice branch, and a branch carries the bundle of the main it was cut from, so a hash of the desk's bundle would restart the loop into older code. It would also let a slice of this plan run its own unreviewed loop. The main checkout only moves forward. At each point where the loop holds no work (no assignment, after a pass), it compares the pinned bundle's content hash with the hash it loaded. On a difference it writes one log line and calls `process.execve` with the same arguments and `PLOT_LOOP_STARTED` set to its original start time. `process.execve` is the only restart that keeps the pid, and the dispatch wrapper's `wait` and the manifest's `pid` depend on that pid. A spawn-and-exit restart would make the wrapper record exit 0 and "the worker is finished". `process.execve` is experimental since Node 23.11. The cost juror measured it on v24.4.1: the pid stayed the same. The repository pins Node 24 (`engines`). The same check restarts the loop when its resident memory passes 300 MB while it holds no work, so a loop that lives for days cannot grow without bound.

**Restart scope.** The restart fires in this repository, where the main checkout's bundle changes on every merge. In an adopting repository, a plugin upgrade installs a new versioned directory and leaves the old bundle unchanged. There the loop runs the old code until the supervisor relaunches it. This plan does not change that, and the Changelog says "in this repository's main checkout" for that reason.

**Costs, measured 2026-10-04.**
- **Memory:** about +50 to 75 MB per agent. A bash loop holds 2 to 5 MB, a long-running Node process with the adapter estate holds 58 to 81 MB, and removing the two monitors saves about 10 MB. That is 5 to 10% of the `claude` process each loop runs.
- **CPU:** negligible. A restart is one Node start of tens of milliseconds, about ten times a day at the current merge rate.
- **CI:** the 22 driving test files run twice while both loops exist, which adds minutes to every PR in that window (`workerloop.test.mjs` alone takes 141 s).
- **Shell:** the last slice removes about 1,124 lines.

**Coverage.** Every row of the table above is a decision in `packages/domain/src/workflows/`, so the domain's 100% lines, branches, functions and statements gate (`packages/domain/vitest.config.ts`) covers it. The entry `packages/board/src/server/entry/worker-loop.ts` decides nothing: each branch in it is either an adapter call or `agentLoop`'s answer. The process slice adds a coverage threshold for that file. It is the first gated file in the board package. The five failures in Motivation become table cases in the workflow's unit test.

### Slices

**Slice 1: the shell loop holds unlanded work** (#1246, #1199). This slice ships behaviour into every repository before any JS loop exists, through the bundle seam the shell loop already uses:
- The shell loop's go-free path asks `promptExit` through `plot-prompt-exit.mjs` (`plot-worker-loop.sh:1439`), as it does today. On `ran` it asks `checkoutYield` through `plot-checkout-yield.mjs`.
- When `checkoutYield` keeps the checkout for `uncommitted-changes` or `unpushed-commits` and no marker exists, the loop writes the reason `holding-work` to `.plot-worker.ending.json` and ends. It does not go free.
- `rules/checks-verdict.ts` settles on a result for the branch's current remote tip when that tip descends from the desk's `HEAD` (#1199). A case is added to `test/reconcile/checks-wait.test.mjs`.
- The slice changes no net shell lines, or removes some. It replaces the loop's own go-free test with the bundle answer.

**Slice 2: the loop's workflow.** `agentLoop` in `packages/domain/src/workflows/agent-loop.ts`, with:
- the table above
- the new `Write` kinds
- the mapping test against `AgentState` and `DeskState`
- the budget-separation test
- the five failures as table cases

`checksVerdict` takes build runs. If `scripts/check-state-declarations.sh` asks for a `transitions/` rule for any new enum, the slice adds it. No caller yet. The slice is done when the domain coverage gate passes over the new file.

**Slice 3: the loop's writes go through ports.** The new port operations and adapters in the table above. The slice decides the signal behaviour before the process slice starts:
- `runBounded` kills the process group on the bound, on `SIGTERM` and on the loop's exit.
- It is tested on macOS and Linux, and under `systemd` with `KillMode=process` (#1148).

**Slice 4: the loop runs in one process.** `packages/board/src/server/entry/worker-loop.ts`, bundled to `skills/plot/scripts/board/plot-worker-loop.mjs`.
- **The launcher.** The current loop body moves whole to `plot-worker-loop-shell.sh`. `plot-worker-loop.sh` becomes the launcher, which `exec`s the JS entry.
- **Mode.** The entry reads `Worker loop: shell | js`, default `shell`, and `exec`s the shell body when the value is `shell`. The key read lives in JS, so the launcher decides nothing.
- **Shell ratchet.** The launcher's lines are paid for by lines removed from the moved body. That is the body's own bundle-resolution and refusal preamble, which the entry now does for both modes. The slice states the net count in its PR.
- **No bundle.** When the bundle is absent, the launcher exits 2 with the message form `the-shell-shrinks-into-the-domain` set (`plot-release-gate.sh:30-33`). It never falls back silently (`docs/shell-and-domain.md:30`).
- **Manifest.** The loop records `loop: js` or `loop: shell` in the manifest.
- **Coverage.** A coverage threshold for the entry file.
- **Tests.** A CI matrix leg sets `Worker loop: js` for the 22 driving test files. The contracts that this plan changes on purpose are rewritten, and each rewrite is named in the PR:
  - The 7 source-text assertions in 4 files (`workerloop.test.mjs:513,1269,1544`, `deskreset.test.mjs:362,385`, `refused-slice-record.test.mjs:36`, `checks-wait.test.mjs:163`) become behaviour tests.
  - The 8 files that feed BuildMonitor findings take a `BuildPort` fixture instead.
  - Any other failure against `js` names a behaviour the plan did not list. It is reported and never rewritten to pass.

**Slice 5: the loop restarts on new code.**
- The pinned main-checkout bundle path.
- The hash check at no-work points.
- `process.execve` with `PLOT_LOOP_STARTED`.
- The memory ceiling.
- A test that a restart keeps the pid and does not extend `Worker bound`.

**Slice 6: JS is the default loop.** The default flips to `js` when both conditions hold over the same window:
- the fleet has run at least 20 slices on `js`;
- the `js` loop has no more listed failures than the `shell` loop.

The manifest's `loop:` line shows which loop ran a slice. These count as loop-caused failures:
- a desk that ended free with unpushed or uncommitted work;
- a CI wait that ended unanswered while the build connector had an answer;
- a loop exit with no recorded reason;
- a loop process that outlives its desk.

The slice names the slices it counted and the failures of each loop.

**Slice 7: the shell loop goes.** The launcher keeps `exec`ing the JS entry. The `Worker loop` key is removed, with a note in `skills/plot-dispatch/SKILL.md` for adopting repositories. Removed, by name:
- `plot-worker-loop-shell.sh` (the loop's 891 lines)
- `plot-transcript-quiet.sh` (39; the loop is its only caller)
- `plot-build-monitor.sh` (162), its start in `plot-dispatch.sh`, its line in `plot-monitor-subject.sh`, and `buildMonitorPid` in the board schema with its renderer
- `manifest_count`, `raise_manifest_count` and `manifest_resume_id` in `plot-agent-manifest.sh`
- `plot_worker_idle_now` in `plot-worker-state.sh`
- `corpus/desk-reset.corpus.test.ts`, which pairs a loop-only duplicate
- the loop's half of `corpus/agent-state.corpus.test.ts`

The rest of `plot-worker-state.sh` stays, because 15 other scripts and two domain adapters call it. The shell ratchet falls by about 1,124 lines.

**Until slices 1, 4 and 6 land.** Slice 1 fixes #1246 and #1199 in every repository. #1255 stays open in this repository until slice 4 runs the fleet on `js`, and in adopting repositories until slice 6 flips the default. Until then they keep the BuildMonitor wait.

**What does not change.**
- `Worker command` keeps naming `plot-worker-loop.sh`, so no adopting repository edits its config. `plot-dispatch --start` refuses any other name.
- The manifests, logs and findings files the board reads keep their names and formats.
- The `PLOT-BLOCKED` and `PLOT-CORRECTION` files keep their names and formats.
- `plot-agent-monitor.sh` stays. The board reads the findings it writes, and slice 7 checks whether anything but the loop starts it.

### Open Questions

- [ ] Where does the agent's turn-ending rule live? #1246 has two halves. One: the loop must not go free on unlanded work (slice 1 of this plan). Two: the worker prompt must say that a turn ends only when work is pushed or blocked. This plan takes the first half. The second may be its own plan.
- [ ] One process per agent, or one process per machine? `plot-registryd` already runs one long-lived Node process per machine, and it could run every agent's loop. That would save the +50 to 75 MB per agent. The operator chose one process per agent on 2026-10-04. Slice 6's window can measure the memory before slice 7 removes the shell loop.
- [x] Process groups and signals. — *answered round 1: slice 3 decides them before the process slice, starting from `run-script.ts`, tested on macOS, Linux and under `KillMode=process`*
- [x] Does `plot-agent-monitor.sh` move into the process? — *answered round 1: no; the board reads its findings, and slice 7 checks its other starters*

## Slices

### The shell loop holds unlanded work

- `infra/the-shell-loop-holds-unlanded-work` — the shell loop ends with reason `holding-work` when `checkoutYield` keeps the desk for unlanded work, and the CI wait settles on the branch's current tip; no net shell growth <!-- builds: the holding-work end in the shell loop -->

### The loop has a workflow

- `infra/the-loop-has-a-workflow` — `agentLoop(readings) -> Decision | Refusal` in `packages/domain/src/workflows/agent-loop.ts`, its table, the new `Write` kinds, the state-mapping and budget tests, and `checksVerdict` over build runs <!-- builds: agentLoop, a domain workflow -->

### The loop writes through ports

- `infra/the-loop-writes-through-ports` — port operations and adapters for claim push, desk reset, a bounded prompt run with its process-group kill, the manifest, the ending file, the marker and the build finding <!-- builds: runBounded and the loop's write ports -->

### The loop runs in one process

- `infra/the-loop-runs-in-one-process` — `board/plot-worker-loop.mjs` runs `agentLoop` behind `Worker loop: js`, the launcher `exec`s it, the shell body moves to `plot-worker-loop-shell.sh`, and the 22 driving test files run against both values <!-- builds: plot-worker-loop.mjs, a long-running loop entry -->

### The loop restarts on new code

- `infra/the-loop-restarts-on-new-code` — the loop restarts with `process.execve` on a newer main-checkout bundle or past its memory ceiling, keeping its pid and its `Worker bound` <!-- builds: the loop's self-restart -->

### JS is the default loop

- `infra/js-is-the-default-loop` — after 20 `js` slices with no more listed failures than `shell` over the same window, `Worker loop` defaults to `js` <!-- builds: the js default for Worker loop -->

### The shell loop goes

- `infra/the-shell-loop-goes` — the shell body, `plot-transcript-quiet.sh`, `plot-build-monitor.sh`, the named loop-only helper functions, `buildMonitorPid` and the `desk-reset` corpus test are removed <!-- builds: plot-worker-loop.sh as a launcher only -->

## Notes

- 2026-10-04, direction from jwloka: the loop runs as one long-running process; Type infra; reviewed in-session; own branches. Follows `the-shell-shrinks-into-the-domain`, which names this script as its first follow-on plan.
- 2026-10-04, measurement: code lines with `grep -vcE '^[[:space:]]*(#|$)'`; functions with `^[a-z_]+\(\) *\{`; bundles and sourced helpers read from the script's text. Memory, CI timings and `process.execve` measured by the round-1 cost juror.
- 2026-10-04, round 1: four jurors (estate, contradiction, deliverable, cost), unanimous `amend`. Moderation in `.plot/panels/2026-10-04-the-worker-loop-runs-in-js/round1.md`.
- Related open issues this plan does not claim: #1250 (the board labels a blocked loop's exit 124 as a crash), #1186 (a hand-over restarts the idle reading), #1169 (a free agent runs a handed slice without its charter). The recorded `loop-end` reasons give #1250 its fix once slice 4 runs, and it may close with that slice.
