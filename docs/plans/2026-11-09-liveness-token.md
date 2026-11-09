# A worker's liveness is a token

> The node worker wrapper opens a named FIFO in the desk and hands its write end to the agent's process group. fleetd reads the FIFO without blocking: end-of-file means no holder is left. That token replaces the `ps -o lstart` start-time check for workers. The reader election and the implement lock use the same kind of token; the continue lock stays on `ps`. The per-desk `plot-agent-monitor.sh` loops end, and fleetd takes their findings and their final pass.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #3170
- **Story:** nothing-changed-nothing-runs
- **Review:** pr
- **Impl:** own branches

## Changelog

- fleetd now tells a live agent from a dead one by a token the agent holds, not by asking the process table when a pid started. A wrapper killed by `SIGKILL`, OOM or a reboot no longer hides a live agent or invents a dead one. The per-desk AgentMonitor processes stop; fleetd writes the same findings (`owes an answer`, `holds unlanded work`, `owes a review`, `owes a gate`) and reads a desk's pull request from the PR index instead of asking the host every 5 minutes per desk.

Board impact: the board shows the same agent states and findings. `skills/plot/scripts/plot-agent-monitor.sh` (570 lines) and its README row go; `plot-monitor-subject.sh` loses the monitor nap. The page, the plan format, the template and the `docs/plans` layout do not change.

## Motivation

fleetd must know when a worker dies, to restart its slice, release its claim or reap its desk (story, Phase 6). The wrapper writes `.plot-worker.exit` on a normal end. A wrapper killed by `SIGKILL`, OOM or a reboot writes nothing, and its agent can outlive it. Today the reading that separates a live worker from a reused pid is the start time:

| Reader | Where | Question |
|---|---|---|
| desk worker state | `plot_pid_is_current`, `skills/plot/scripts/plot-worker-state.sh:347` (`ps -o lstart=` at `:352`); after `desk-probes-in-domain`, `pidIsCurrent` over one process table per pass | is the recorded pid the worker the wrapper started? |
| reader election | `psLiveness`, `packages/fleet/src/server/entry/pr-reader.ts:98` (`ps -o pid=,lstart=` at `:106`); `readerIsStale`, `packages/domain/src/rules/reader-election.ts:65`; `reader-lock-file.ts:434` passes `null` and falls back to the 10-minute age bound | does the elected PR reader still run? |
| implement lock | `holdingRecord`, `packages/fleet/src/shared/implement-run.ts:205-211` (`probe.startedAt`, `process-probe-system.ts:20-28`); `implementLockHeld`, `rules/implement-lock.ts` | does the implement or brief run still hold the slug? |
| continue lock | `holdingRecord`, `packages/fleet/src/shared/continue-lock.ts:66-72`; `continueLockHeld`, `rules/continue-lock.ts:46` | does a continue call still hold the desk? |

Node has no API for a process's start time and macOS has no `/proc`, so `kill(pid, 0)` alone cannot tell a reused pid from the worker. Each start-time read is a `ps` process.

The AgentMonitor (`plot-agent-monitor.sh`) runs one loop per desk for the agent's life. Every 300 s (`PLOT_MONITOR_INTERVAL`, `:138`) its `sample_finding` (`:424`) reads the marker, `git status`, `git rev-list` and `plot-host.sh pr-state <branch>` (`:257-264`); the story names that host call as a per-desk cost that stays until this phase. When the agent exits, the loop runs one final pass (`:565-569`), the pass that catches an agent that committed everything and opened no PR.

Census on CI run 42595561157 (PR #3277): S4 on GitHub with 3 desks reads 2585.5 `execve` per pass, of which `ps` is 21 per pass; Bitbucket with 3 desks 2676; S5 2587; S6 2696. P1 (an AgentMonitor's naps) reads 0 since `monitors-nap-without-sleep`. No census row counts the AgentMonitor's 300 s pass.

## Design

This plan depends on `node-worker-wrapper` (all three slices), because the token is opened by the node wrapper, and on the *Worker readings* slice of `desk-probes-in-domain`, because the *Worker token* slice replaces the start-time column that slice reads into `readWorkerReadings`. `triggers-replace-the-tick` depends on this plan: its trigger "a worker ends without a record" is the token's end-of-file. This plan shares `continuation.ts` with `node-worker-wrapper` and `registryd-main.ts` with `desk-probes-in-domain`; it shares no file with `refs-from-files`, `one-cat-file-batch`, `github-reads-in-process` or `sprint-prs-run-ci`.

### Approach

**The token.** A FIFO at `<desk>/.plot-worker.token.fifo`. The wrapper creates it with `mkfifo` before the agent starts, opens it read-write (an open for write alone blocks until a reader exists), passes the descriptor to the agent as fd 3 through `spawn`'s `stdio`, and closes its own copy once the agent runs. A holder is any process that inherited fd 3: the agent's `sh`, `plot-worker-loop.sh` and the node loop under it. A reader opens the FIFO `O_RDONLY | O_NONBLOCK` and reads once: `EAGAIN` means at least one holder is alive; a read of 0 bytes means no holder is left; `ENOENT` means no token was ever made. Each answer is a syscall, not a process.

`workerLiveness({ exit, token, pidAnswers })` in `packages/domain/src/rules/worker-liveness.ts` decides, in this order:

1. An exit record exists → the process ended; the token is not read. A holder that outlived the agent (a background child that kept fd 3) does not keep a finished desk `running`.
2. No exit record and the token reads `held` → `live`.
3. No exit record and the token reads `released` → `dead`: the wrapper was killed and every holder is gone. This is the case the exit record cannot cover.
4. No token (`ENOENT`, a desk launched before this plan, or a hand-started worker) → the start-time path from `desk-probes-in-domain`, unchanged.

**Why the agent and not the wrapper holds it.** A token held by the wrapper alone reads `released` when the wrapper is killed while the agent lives; a restart would then put two writers on one branch (story, Phase 6). A token held only through the agent's process group reads `held` as long as any holder lives, so a false `released` needs every holder to close fd 3. The tests below try the ways that can happen.

**Reader election and implement lock.** The holder there is a long-lived node process that creates its own token rather than inheriting one: `plot-pr-reader.mjs` and fleetd open `.plot/state/reader.<connector>.fifo` at election, and an implement or brief run opens `.plot/state/implement/<slug>.fifo` beside its lock record. `readerIsStale` and `implementLockHeld` take the token reading in place of `startedAt`; the `ps` in `psLiveness` and the `probe.startedAt` in `implement-run.ts:209` go for a holder with a token and stay for a lock record written before this plan.

**Continue lock: stays on `ps`.** `continueLockHeld` is asked only when a person presses Continue or the registry tick starts a fresh session, an action that the story counts as a trigger, and its holder lives for one HTTP request. A token adds a file per request and saves one `ps` per action. This plan names it and leaves it.

**The AgentMonitor loops end.** `agentFinding(readings)` in `packages/domain/src/rules/agent-finding.ts` moves `sample_finding`'s order: marker → dirty → unpushed → no commits → no PR → no changeset. fleetd computes it per desk from the readings `readDeskReadings` already takes and from the PR index row for the branch, not from `plot-host.sh pr-state`; an index with no row for the branch answers `unaskable` and writes no `owes a review`, because the index never says `pr: 'none'`. fleetd appends a finding line to `.plot-worker.monitor.agent.jsonl` with the shell's field order only when the finding changes, as `monitor_pass` does. The final pass runs when `workerLiveness` moves from `live` to `ended` or `dead`, and once per desk at fleetd start (the story's startup full read). The wrapper stops starting `plot-agent-monitor.sh`; `deskMonitorsShell.start` and the script go.

**Census effect.** The *Worker token* slice removes the start-time `ps` from every pass for a desk with a token: S4 GitHub 3 desks reads `ps` 0 per pass, from 21 on the baseline (or from 1 after `desk-probes-in-domain`). The *Monitor in fleetd* slice removes one `bash` loop per desk and, per desk every 300 s, `git status`, `git rev-list`, `git log` and one `plot-host.sh pr-state` with its `gh` or `bb` call. P1's fixture starts `plot-agent-monitor.sh`, so P1 is retired with the script; a new row `P5: an idle desk with a live agent starts no monitor process` holds the zero.

### Open Questions

- [ ] Which processes hold fd 3 is unmeasured. The expected chain: `plot-worker-loop.sh` runs the node loop and passes fd 3 on; the node loop keeps it; the harness the loop starts (`claude`) gets only the descriptors its `spawn` call names. Then the token answers "the loop lives", which is the recorded pid's question today. The *Worker token* slice measures the chain with `lsof` on Linux and macOS before it writes the rule. A person confirms that "the agent's process group" in the story means the loop, not the harness.
- [ ] The `orphaned` reading (a live loop around a dead harness, `rules/agent-state.ts:23-26`) needs a process-table walk, and a token held by the loop cannot answer it. This plan keeps the walk for `orphaned` and removes only the start-time read. A person decides whether the loop writes a harness-ended record instead, in a later plan.
- [ ] `mkfifo` fails on some network filesystems. The wrapper then starts the agent with no token, and the desk falls back to the start-time path (rule 4). A person confirms that the fallback is enough, or that no operator keeps desks on a network mount.
- [ ] `.plot-worker.token.fifo` must not read as dirt. `PLOT_WORKER_RECORD` (`plot-worker-state.sh:89`) already excludes `.plot-worker.*`, and `deskDirtFilter` copies it. A person confirms that `.plot/state/*.fifo` is excluded too (`PLOT_TOOL_SCRATCH` covers `.plot/state`).
- [ ] The reader election's token lives in `.plot/state/` under the main checkout. Two boards in two linked worktrees resolve one main checkout since #3298. A person confirms that both open the same FIFO path.
- [ ] Retiring P1 changes a green census row. A person confirms that P5 replaces it, or names the row that holds the zero instead.

## Done when

| Claim | Check | Slice |
|---|---|---|
| A live agent reads live after its wrapper is killed | test: `SIGKILL` to the node wrapper while the loop runs; `workerLiveness` reads `live` for 3 reads over 3 s; no restart starts | Worker token |
| A killed tree reads dead with no exit record | test: `SIGKILL` to the wrapper's whole group; the token reads `released` on the next read and `workerLiveness` reads `dead` | Worker token |
| A reused pid cannot hold the token | test: after the worker ends, a new process takes the recorded pid (forced by a pid-reuse fixture on Linux with `ns_last_pid`, or by a stub table); the token reads `released` and the desk reads `ended`/`dead`, never `live` | Worker token |
| A finished desk does not stay running | test: the agent exits 0 and leaves a background child holding fd 3; the exit record wins and the desk reads `finished` | Worker token |
| A desk with no token keeps today's answer | `worker-readings.corpus.test.ts` still passes on desks launched before the token | Worker token |
| No pass reads a start time for a desk with a token | census S4 GitHub 3 desks: `ps` 0 per pass; S4, S5 and S6 read at or below their merge base on every fixture | Worker token |
| The reader election needs no `ps` | test: a reader with a token is `held` while it lives and stale on `SIGKILL` within one read; `psLiveness` starts no `ps` for it | Locks |
| The implement lock needs no `ps` | test: an implement run with a token holds the slug while it lives and releases it on `SIGKILL` | Locks |
| The continue lock is named, not moved | `continue-lock.ts` unchanged; the plan's Notes name it | Locks |
| fleetd writes the AgentMonitor's findings | `agentFinding` rows: one per `sample_finding` arm in the shell's order; a fleetd test over 4 desks writes the same `.plot-worker.monitor.agent.jsonl` lines (timestamps masked) as `plot-agent-monitor.sh --once` | Monitor in fleetd |
| The final pass is not lost | test: an agent exits 0 with commits and no PR row; fleetd writes `owes a review` within one pass | Monitor in fleetd |
| No desk runs a monitor | after a dispatch, no process runs `plot-agent-monitor.sh`; `scripts/check-shell-lines.sh pr` reads at least 250 fewer counted commands (`plot-agent-monitor.sh` counts 250 on `11a270538`) | Monitor in fleetd |

## Slices

### Worker token

- `feature/liveness-token-worker` — the wrapper makes `.plot-worker.token.fifo` and hands fd 3 to the agent; a `LivenessToken` port and FIFO adapter in `packages/domain/src/adapters/liveness-token/`; `workerLiveness` in `rules/worker-liveness.ts`; `readWorkerReadings` reads the token before the start time; the pid-reuse and killed-wrapper tests <!-- builds: workerLiveness, worker liveness from an inherited FIFO token -->

### Locks

- `feature/liveness-token-locks` — the PR reader and implement runs hold a token; `readerIsStale` and `implementLockHeld` read it; `psLiveness` and `probe.startedAt` stay only for records without one <!-- builds: token-held reader election and implement lock -->

### Monitor in fleetd

- `feature/liveness-token-monitor` — `agentFinding` in `rules/agent-finding.ts`; fleetd writes the findings and the final pass from the PR index; the wrapper stops starting `plot-agent-monitor.sh`; the script, `deskMonitorsShell.start` and the README row go; census P1 retired and P5 added; a changeset <!-- builds: agentFinding, the AgentMonitor's findings computed in fleetd -->

## Notes

- Phase 6 of the story [`nothing-changed-nothing-runs`](../stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md); candidate plan `liveness-token`; depends on `node-worker-wrapper` and on `desk-probes-in-domain`'s *Worker readings* slice.
- The continue path already holds a FIFO, `.plot-worker.reporter.fifo` (`packages/fleet/src/shared/continuation.ts:831-880`), but closes it for the `Worker command` (`3>&-`) and reads it only inside the reporter. `node-worker-wrapper` moves that path onto the node wrapper; this plan replaces the reporter FIFO with the token.
- The story cites the AgentMonitor's final pass at `plot-agent-monitor.sh:552-569`. On this worktree `:552` is the first pass, the loop is `:565-567` and the final pass `:569`.
- The continue lock stays on `ps`: it is an action-time read (story, *Re-ask before acting*: "An action is itself a trigger"), and its holder lives for one request.
- Deliverable search (`plot-deliverable-search.sh`) for `liveness-token`, `liveness token`, `livenessToken`, `holderGone` and `FIFO` found no token deliverable. It found `REPORTER_FIFO_FILENAME` and `reporterShell` (`continuation.ts`) and the monitor nap's FIFO in `plot-monitor-subject.sh:193`, neither a liveness reading for fleetd.
- Census figures: `census-report-head` artifact of CI run 42595561157 (PR #3277, 2026-11-09), per pass (half the two recorded passes).
- Line numbers checked on `idea/batch-refs-from-files` at `11a270538`, 2026-11-09.
- Definition of Done: docs/definition-of-done.md.
