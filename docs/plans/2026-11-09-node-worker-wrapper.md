# The worker wrapper is a node bundle

> The inline `exec nohup sh -c '…'` wrapper in `start_worker` becomes a node bundle, `plot-worker-wrapper.mjs`, started through the `Detached` port's `detachedNode` adapter. It writes the same exit records, pid files, manifest stamp and `WorkerMonitor` line as today. Every launch, the dispatcher's and the continue and restart paths', runs through it.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** desk-probes-and-liveness
- **Issue:** #3170
- **Story:** nothing-changed-nothing-runs
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-09, jwloka, plan-PR #3308 merged

## Changelog

- A dispatched agent now starts under a node wrapper instead of an inline shell script. The files the wrapper leaves in the desk (`.plot-worker.exit`, `.plot-worker.pid`, `.plot-worker.pid.startedAt`, `.plot-worker.wrapper.pid`, the manifest stamp and the worker finding line) keep their names and content. Continue and restart start the agent through the same wrapper.

Board impact: none on the page. `skills/plot/scripts/plot-dispatch.sh` (a helper script) changes in `start_worker`: about 40 lines of inline `sh` and `awk` go, and one bundle call replaces them. A new bundle `skills/plot/scripts/board/plot-worker-wrapper.mjs` is declared in `packages/board/build.mjs` beside `plot-worker-loop.mjs`. The plan format, the template and the `docs/plans` layout do not change.

## Motivation

The story's Phase 6 needs a wrapper that can hold a liveness token: a descriptor the agent inherits, opened before the agent starts and closed by the wrapper after (story, *Worker liveness*; Decisions 2026-11-05: "The worker wrapper moves from `sh` to a node bundle first"). The wrapper today is one `sh -c` string at `skills/plot/scripts/plot-dispatch.sh:1510`, inside the `( set -m; cd "$wt" && … )` subshell that starts at `:1489`. It:

- writes its own pid to `.plot-worker.wrapper.pid` and reads its own start with `ps -o lstart=`;
- starts the AgentMonitor (`plot-agent-monitor.sh`) when `PLOT_AGENT_MONITOR` is set;
- starts the agent as `( $cmd ) &`, ignores `SIGTERM` after the agent exists, and writes `.plot-worker.pid` and `.plot-worker.pid.startedAt` (a second `ps -o lstart=`);
- stamps the manifest with an inline `awk` program (`:1510-1545`; the wrapper ends at `:1546`), the second implementation of `stampManifest` (`packages/fleet/src/shared/manifest-stamp.ts:118`), held equal by `packages/fleet/test/unit/manifest-stamp-parity.test.ts`;
- `wait`s on the agent, sources `plot-monitor-subject.sh` for `plot_watched_desk`, appends one `WorkerMonitor` line (`gone` for a non-zero exit, `clear` for 0) to `.plot-worker.monitor.worker.jsonl`, and writes the code to `.plot-worker.exit`.

macOS `sh` has no `flock` and cannot listen on a socket, and adding a token contract to this string would grow the shell that `scripts/check-shell-lines.sh` ratchets.

A second launch path exists. `/api/continue`, restart and the registry tick's fresh session start the agent with `reporterShell` (`packages/fleet/src/shared/continuation.ts:860`, called at `:1378`), a different `sh -c` string. It already holds a FIFO, `.plot-worker.reporter.fifo` (`:832`), in the agent subshell and reads it to end-of-file to learn that the agent ended. Two wrappers with two contracts is what `stampManifest`'s own header calls the drift risk; this plan leaves one.

## Design

This plan depends on `process-census-gate` (delivered). `liveness-token` depends on all three slices of this plan. This plan shares `continuation.ts` with `liveness-token` and no file with `desk-probes-in-domain`, `refs-from-files`, `one-cat-file-batch`, `github-reads-in-process` or `sprint-prs-run-ci`.

**Census rows.** S1–S6 and P1–P4 run with workers already started (`packages/fleet/test/census/stub-worker.ts`), so no existing row measures a launch. This plan moves none of them and must not raise any: the wrapper runs once per launch, which the story counts as a trigger. Per launch the `sh` wrapper starts `ps` ×2, `awk`, `mv`, `date`, `dirname` and the sourced `plot-monitor-subject.sh`; the node wrapper starts `node`, `sh -c "$cmd"` for the agent and `ps` ×2 until `liveness-token` replaces the start-time reads.

**A new row D1: one dispatch.** This plan adds census row `D1: one dispatch` in `census-rows.ts`: the `execve` count of one `start_worker` launch of a stub agent, from the dispatch call to the agent's start. The Bundle slice measures D1 on the merge base's `sh` wrapper and states the figure in its PR. The Dispatch slice measures it on the node wrapper, records that figure, and from then on the gate holds D1 at or below it, as it holds S4–S6 against the merge base. `liveness-token` then changes the launch under a row that already exists.

### Approach

**The bundle.** `packages/fleet/src/server/entry/worker-wrapper.ts` builds to `skills/plot/scripts/board/plot-worker-wrapper.mjs`. It reads the environment `start_worker` sets today (`PLOT_EXIT_FILE`, `PLOT_PID_FILE`, `PLOT_PID_STARTED_FILE`, `PLOT_WRAPPER_PID_FILE`, `PLOT_MANIFEST_FILE`, `PLOT_STAMP_STARTED`, `PLOT_AGENT_MONITOR`, `PLOT_SCRIPT_DIR`, `PLOT_BRANCH`, `PLOT_WORKTREE`) and takes the `Worker command` as its one argument. In order:

1. Write `process.pid` to `PLOT_WRAPPER_PID_FILE`.
2. Start the AgentMonitor through `deskMonitorsShell` (`packages/domain/src/adapters/desk-monitors/desk-monitors-shell.ts`) when the variable is set, as the `sh` wrapper does.
3. Start the agent with `spawn('sh', ['-c', cmd], { stdio: 'inherit' })` in the wrapper's own process group, with `PATH` prefixed by `PLOT_SCRIPT_DIR`.
4. Install a `SIGTERM` handler that does nothing. A node handler is not inherited by a child, so the agent and the monitor keep the default action, which is what the `sh` wrapper's ordering of `trap "" TERM` after `agent=$!` achieves.
5. Write `.plot-worker.pid` and `.plot-worker.pid.startedAt`, and stamp the manifest with `writeManifestStamp` (`manifest-stamp.ts:306`). `wrapperPidStartedAt` and `pidStartedAt` stay `ps -o lstart=` text, because `plot_pid_is_current` compares that text: the wrapper reads them with two `ps` per launch, under `LC_ALL=C`, until `liveness-token` removes the need. The wrapper could compute its own start without `ps` (`Date.now() - process.uptime() * 1000`), but not the agent's.
6. On the agent's `exit`, resolve the watched desk with `watchedDesk` (`packages/domain/src/rules/desk-manifest.ts:209`), append the `WorkerMonitor` line with the same field order, and write the exit code. A signal death writes `128 + signal number`, the code `wait` reports in `sh`.

Each step that reaches a file goes through an existing port or a new `WorkerRecords` port with a file adapter in `packages/domain/src/adapters/worker-records/`; the rule that maps an exit to `gone` or `clear` is `workerEnding(code)` in `packages/domain/src/rules/worker-ending.ts`.

**The agent tree.** The `sh` wrapper starts the agent as a subshell `( $cmd )`, a forked `sh`; the node wrapper spawns `sh -c "$cmd"`, also an `sh`. `plot_worker_agent_alive`'s subtree walk (`plot-worker-state.sh:1002`) reads both trees alike, and slice 1's test asserts that on Linux and on macOS.

**The launch.** `start_worker` keeps its environment block and replaces the `exec nohup sh -c '…'` at `plot-dispatch.sh:1510` with `node "$script_dir/board/plot-worker-start.mjs" "$cmd"`. That entry (`packages/fleet/src/server/entry/worker-start.ts`) starts `plot-worker-wrapper.mjs` with `detachedNode().node(...)` (`packages/domain/src/adapters/detached/detached-node.ts:10`) and exits. `detached: true` makes the wrapper a session and group leader, so the wrapper's pid is its group id, as `set -m` makes it today, and `--stop`'s group signal reaches the wrapper and the agent and no sibling desk. The `( set -m; … )` subshell goes. `Detached.node` takes no environment; the wrapper inherits the entry's environment, which is the one `start_worker` exported.

**A wrong Node major refuses at launch.** `plot-worker-start.mjs` compares the running Node major with the major `.nvmrc` pins, as `plot-worker-loop.sh` already does, before it starts the wrapper. On a mismatch it starts nothing, prints both majors, and exits non-zero, so `start_worker` reports the refusal and the dispatch fails at launch. A desk never starts under a wrapper that cannot write its exit record.

**The brief run stays.** `plot-dispatch.sh:843` starts the brief run (`plot-brief`) with a second `exec nohup sh -c`. It is not a worker and writes no exit record, so it keeps its `nohup`: "every launch" in this plan means every agent launch, not every detached start.

**Continue and restart.** `reporterShell` (`continuation.ts:860`) and its caller start `plot-worker-wrapper.mjs` the same way with the same environment. The reporter FIFO stays in this plan, now opened by the wrapper; `liveness-token` replaces it with the token.

### Open Questions

- [x] `wrapperPidStartedAt` and `pidStartedAt` are `ps -o lstart=` text today, and `plot_pid_is_current` compares that text. The wrapper can compute its own start without `ps` (`Date.now() - process.uptime() * 1000`, as `process-probe-system.ts` `self()` does), but not the agent's. This plan keeps two `ps` reads per launch and writes the same text. A person confirms; `liveness-token` removes the need. **Decided 2026-11-09, jwloka: confirmed. Two `ps` per launch for the `lstart` text until `liveness-token`.**
- [x] The `sh` wrapper starts the agent as a subshell `( $cmd )`, so the agent's pid is a forked `sh`. The node wrapper spawns `sh -c "$cmd"`, also an `sh`. A person confirms that `plot_worker_agent_alive`'s subtree walk (`plot-worker-state.sh:1002`) reads both trees alike; slice 1's test asserts it on Linux and macOS. **Decided 2026-11-09, jwloka: confirmed. `sh -c` and `( )` agents read alike, tested on Linux and macOS.**
- [x] `plot-dispatch.sh:843` starts the brief run with a second `exec nohup sh -c` (`plot-brief`). It is not a worker and writes no exit record. This plan leaves it. A person confirms that "every dispatch" means every agent launch, not every detached start. **Decided 2026-11-09, jwloka: confirmed. The brief run's `nohup` stays.**
- [x] No census row measures a launch. A person decides whether this plan adds one (`D1: one dispatch`, measured, then held), or whether `liveness-token` adds it when the token changes the launch. **Decided 2026-11-09, jwloka: this plan adds census row `D1: one dispatch`, measured, then held.**
- [x] The wrapper runs under the Node major `.nvmrc` pins. `plot-worker-loop.sh` already refuses a different major. A person confirms that a desk started on a machine with a different `node` on `PATH` refuses at launch rather than writing no exit record. **Decided 2026-11-09, jwloka: confirmed. A wrong Node major refuses at launch.**

## Done when

| Claim | Check | Slice |
|---|---|---|
| The node wrapper writes the same records | contract test with a stub agent: exit 0, exit 3, `SIGKILL` (137) and `SIGTERM` to the agent each leave byte-identical `.plot-worker.exit`, `.plot-worker.pid`, `.plot-worker.wrapper.pid` and `.plot-worker.monitor.worker.jsonl` (timestamps masked) to the `sh` wrapper's | Bundle |
| The manifest stamp has one implementation | the wrapper calls `writeManifestStamp`; `manifest-stamp-parity.test.ts` is deleted with the `awk` program in the same PR | Dispatch |
| A group stop keeps the exit record | `SIGTERM` to the wrapper's group: the agent ends, the wrapper writes `143` and the `gone` line, as `test/e2e/monitors-attached.test.mjs` asserts today | Bundle |
| The wrapper leads its own group | after launch, `ps -o pgid=` of the wrapper and the agent equals the wrapper's pid; a stop of one desk leaves a second desk's agent alive | Dispatch |
| Every dispatch runs through it | `grep -n "nohup sh -c" skills/plot/scripts/plot-dispatch.sh` finds only the brief run at `:843`; a dispatch test reads `plot-worker-wrapper.mjs` in the wrapper's command line | Dispatch |
| Continue and restart run through it | `reporterShell` is gone; a continue test and a restart test read `plot-worker-wrapper.mjs` in the wrapper's command line and the same records | Continue |
| The agent tree reads alike | a test on Linux and on macOS: `plot_worker_agent_alive` answers `present` for an agent under the `sh` wrapper's `( $cmd )` and under the node wrapper's `sh -c "$cmd"` | Bundle |
| The start time is locale-proof | a launch under `LANG=de_CH.UTF-8` writes `pidStartedAt` and `wrapperPidStartedAt` in the C locale's `lstart` form | Bundle |
| A wrong Node major refuses at launch | a dispatch with a stub `node` of another major: `plot-worker-start.mjs` starts no wrapper, prints both majors and exits non-zero, and `start_worker` reports the refusal | Dispatch |
| One dispatch is measured and held | census row D1: the Bundle slice's PR states D1 on the merge base; the Dispatch slice records the node wrapper's figure, and the gate fails a later change that raises it | Dispatch |
| The shell shrinks | `scripts/check-shell-lines.sh pr` passes and reads a lower count on the Dispatch slice | Dispatch |
| No census row rises | census S4, S5 and S6 stay within the gate's tolerance on every fixture | every slice |

## Slices

### Bundle

- `feature/node-worker-wrapper-bundle` — `worker-wrapper.ts` and the `plot-worker-wrapper.mjs` bundle; `workerEnding` in `rules/worker-ending.ts`; the `WorkerRecords` port and file adapter; the record-parity contract test against the `sh` wrapper; the agent-tree test on Linux and macOS; D1 measured on the merge base <!-- builds: plot-worker-wrapper.mjs, the worker wrapper as a node bundle -->

### Dispatch

- `feature/node-worker-wrapper-dispatch` — `worker-start.ts` and `plot-worker-start.mjs` start the wrapper through `detachedNode`; `start_worker` calls it in place of the inline `sh -c` and `awk`; the Node major check; census row D1 recorded and held; `manifest-stamp-parity.test.ts` deleted; a row in `skills/plot/scripts/README.md`; a changeset <!-- builds: plot-worker-start.mjs, a detached start of the worker wrapper through the Detached port -->

### Continue

- `feature/node-worker-wrapper-continue` — `/api/continue`, restart and the fresh-session tick start the same wrapper; `reporterShell` removed; a changeset for `@plot-pm/board` <!-- builds: one worker wrapper for dispatch, continue and restart -->

## Notes

- Phase 6 of the story [`nothing-changed-nothing-runs`](../stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md), first step; candidate plan `node-worker-wrapper`.
- The story cites the wrapper at `plot-dispatch.sh:1507` and the exit handling at `:1455-1470`. On this worktree the `exec nohup sh -c` is at `:1510`, the subshell starts at `:1489`, and the comment that explains the group and `SIGTERM` order is at `:1444-1470`.
- `plot-dispatch.sh` has no owner story since `the-shell-holds-no-behavior` closed (its Phase 4, 2026-11-09). This plan converts one function of it and no more.
- Deliverable search (`plot-deliverable-search.sh`) for `node-worker-wrapper`, `worker wrapper`, `plot-worker-wrapper` and `workerWrapper` found no existing deliverable. `FIFO` found `reporterShell` and `REPORTER_FIFO_FILENAME` in `continuation.ts:831-880`, the second launch path this plan merges.
- Cross-plan: whichever of `desk-probes-in-domain` and `node-worker-wrapper` lands second keeps `LC_ALL=C` on the `ps -o lstart` start-time stamp.
- Line numbers checked on `idea/batch-refs-from-files` at `11a270538`, 2026-11-09.
- Definition of Done: docs/definition-of-done.md.
