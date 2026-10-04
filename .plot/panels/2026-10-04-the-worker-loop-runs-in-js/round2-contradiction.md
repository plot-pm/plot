# Round 2 — Contradiction

Position: amend

## What I read

- Read in full: `docs/plans/2026-10-04-the-worker-loop-runs-in-js.md` at `c390671e6`, `round1.md` and `round1-contradiction.md`.
- Read in part: `packages/domain/src/entities/ending.ts` (`EndingReasonSchema`), `transitions/agent.ts:331-420` (`endingIsAttributable`), `rules/agent-state.ts:95-145`, `rules/task.ts:87-93`, `rules/desk-lifecycle.ts:150-165`, `rules/checks-verdict.ts:1-60`, `rules/supervision.ts:198-206`, `ports/build.ts`, `adapters/run-script.ts:55-68`, `workflows/decision.ts` (`kind:` lines), `packages/board/src/server/continue.ts:328-345`, `packages/board/src/server/findings.ts:40-44`, `packages/board/build.mjs:1240-1295`, `packages/domain/vitest.config.ts`, `skills/plot/MANIFESTO.md` principle 13, `docs/shell-and-domain.md:28-31`, `skills/plot-dispatch/SKILL.md:202-206`, `skills/plot/scripts/plot-release-gate.sh:29-34`.
- Ran: `command grep -n "write_ending \|exit 124\|exit [0-9]" plot-worker-loop.sh` (the six ending reasons the shell writes today and their exit codes); `git grep -n "ending.json" -- packages` (no board reader); `git grep -l plot-transcript-quiet -- skills packages test`; `command grep -n "monitor.worker.jsonl" skills/plot/scripts/*.sh`; `gh issue view 1199`.
- Not read: `plot-dispatch.sh`. A Bash grep naming it was refused by the controller gate (#1245), so the working directory of `Worker command` is unverified here.

## Round-1 findings, answered or not

1. CI through the host port: answered. Design reads `BuildPort.runForSha` with the head from the `refs` port (plan line 79). `ports/build.ts:105` declares `runForSha`.
2. The index: answered. The plan declares the CI wait an exception, states 60 s per waiting agent, and says the loop never writes the index (line 81). This matches CLAUDE.md "Only a terminal answer is read from the index".
3. `blocked` against `/api/continue`: answered. The loop ends on `blocked` (line 73), and `continue.ts:333-342` then starts the one new loop.
4. Loop states against the Agent's eight: answered in form by the mapping table and its test. The table's `ended` cells do not hold, see new finding 3.
5. `holding-work` against `deskLifecycle`: answered. The loop ends, so `deskState` no longer reads `working` (`desk-lifecycle.ts:158`).
6. Missing `wait` and `gone` rows: answered (lines 61 and 63). Other existing endings are now missing, see new finding 2.
7. Two correction budgets: answered and declared (line 77).
8. `Decision | Refusal` shape: answered (line 53). The existing `Write` kinds the plan names all exist in `decision.ts`.
9. `Worker bound` in every state: answered (line 75, `PLOT_LOOP_STARTED`).
10. The project's prompt and the restart scope: answered (lines 85, 102).

## What must change

1. **Design › "The loop uses the words the estate already has", against `entities/ending.ts` and `endingIsAttributable` (new).** The ending vocabulary already exists in the domain: `EndingReasonSchema` holds `bound`, `quiet`, `unreadable`, `spent`, `unstarted`, `limited`, `unregistered` (`entities/ending.ts:76-83`). The plan names none of it. It renames `unregistered` to `deregistered`, and adds `blocked`, `holding-work` and `checks-unanswered` without saying the enum grows. `endingIsAttributable` (`transitions/agent.ts:401-415`) refuses an ending with actor `agent` unless the reason is `unstarted`, `limited` or `unregistered`, on the settled reading that "the agent's process only runs the exit" and a watcher ends it. Slice 1's shell write of `holding-work` and every new JS `loop-end` reason are the agent's own process deciding to stop. The plan must name `EndingReasonSchema`, keep `unregistered`, state the actor each new reason records, and amend `endingIsAttributable` in the slice that adds the reasons, or say why the rule no longer applies once the loop is the watcher.

2. **Design › the decision table, against Manifesto principle 13 and the loop's idle watch (new).** The shell loop runs an idle watch during the prompt through `plot_worker_idle_watch_pass` (`plot-worker-loop.sh:2091`), writes `.plot-worker.monitor.worker.jsonl` (`:2063`), and ends the worker with reason `quiet` (`:2616`) or `unreadable` (`:2629`). `build.mjs:1281-1290` ships `plot-transcript-quiet.sh` for that watch. Principle 13 is "An agent that has gone quiet has failed, not finished". The table has no idle row, the `Write` list has no worker finding, and slice 7 removes `plot-transcript-quiet.sh` and `plot_worker_idle_now`. The JS loop therefore drops quiet detection and the worker findings file, which contradicts "the manifests, logs and findings files the board reads keep their names and formats" (line 179). The table also lacks the `unstarted` ending (`:2761`, `:2852`), although slice 6 counts "a loop exit with no recorded reason" as a failure. The plan must add rows for `quiet`, `unreadable` and `unstarted`, a `Write` kind for the worker finding, and say which domain rule the idle watch asks, or state that it drops the watch and why principle 13 still holds.

3. **Design › the table's `AgentState` column, against `rules/agent-state.ts` (new).** `agentState` maps exit 0 to `taskState` and a non-zero exit with no PR to `failed` (`agent-state.ts:141-143`). `ended` comes only from a stale pid or an unreadable or absent exit. The table gives `ended` for `bound`, `deregistered`, `limited` and `checks-unanswered`, and states an exit code only for `blocked` and `holding-work` (exit 0, line 73). The shell exits 124 on `bound` and 1 on `limited` today, which read `failed`. With exit 0 a clean desk reads `finished`. No exit code gives `ended`, and no slice changes `agentState`. The unit test the plan promises over "every row" fails as written. The plan must state each row's exit code and correct the column, or name the change to `agentState`.

4. **Slice 1 › "settles on a result for the branch's current remote tip when that tip descends from the desk's `HEAD`", against `scripts/check-ancestry-decisions.sh` (new).** The descent test is an ancestry call, and CLAUDE.md "One Answer To Did This Land" requires every ancestry call to declare `prefilter` or `evidence` within five lines. The settled verdict leads to `desk-reset` (table line 68), which is destructive. The slice must name the declaration kind and what decides. Design's CI wait (line 79) reads "the branch's current head" without the descent condition, so slice 2's `checksVerdict` must keep it, or a force-push replacing the agent's commit settles the wait on someone else's build.

## What holds

- The Motivation counts hold, as in round 1: 891 code lines, 3,137 lines, 52 functions, the four helpers and the seven bundles.
- Every existing `Write` kind the plan reuses exists in `workflows/decision.ts` (`blocked-marker` :309, `manifest-clear` :320, `commit` :346, `push` :355, `worker-signal` :212).
- The cited lines hold: `desk-lifecycle.ts:158` (`workerAlive` returns `working`), `continue.ts:333` (spawns a new worker), `run-script.ts:58-66` (`killGroup` with `process.kill(-pid, 'SIGKILL')`), `supervision.ts:203` (`MAX_ATTEMPTS`), `plot-worker-loop.sh:1439` (`plot-prompt-exit.mjs`), `plot-dispatch/SKILL.md:204` (the loop runs `.plot/worker-prompt.sh`), `plot-release-gate.sh:30-33` (exit 2 with the build command), `findings.ts:42` (`.plot-worker.monitor.build.jsonl`), `schema.ts:3451` (`buildMonitorPid`).
- The 100% domain coverage gate exists (`packages/domain/vitest.config.ts:70-71`), and the board package has no coverage threshold today, so "the first gated file in the board package" holds.
- Ending on `blocked` with exit 0 gives `taskState` → `waiting` (`task.ts:89`), which fixes #1250's crash reading for that path without any reader of `.plot-worker.ending.json`. No board code reads that file today (`git grep` over `packages`), so the line "the recorded `loop-end` reasons give #1250 its fix" rests on the exit code and not on the reason.
- The CI-wait exception agrees with "A Decision Reads The Index": the index holds no trustworthy non-terminal check answer, and `fleet.ts` stays its one writer.
- Keeping `Worker command` on `plot-worker-loop.sh` and making the `.sh` a launcher follows `docs/shell-and-domain.md` ("a command is a JS entry point").
