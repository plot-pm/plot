# A worker's liveness is a token

> The node worker wrapper opens a named FIFO in the desk and hands its write end to the agent's process group. fleetd reads the FIFO without blocking: end-of-file means no holder is left. The worker loop and the harness it starts both hold the token. That token replaces the `ps -o lstart` start-time check for workers. The reader election's follower check reads `kill(pid, 0)` instead of `ps`; the implement lock and the continue lock stay on `ps`. The per-desk `plot-agent-monitor.sh` loops end, and fleetd takes their findings and their final pass; with no fleetd running, the node wrapper runs the final pass itself.

## Status

- **State:** Delivered
- **Type:** feature
- **Sprint:** desk-probes-and-liveness
- **Issue:** #3170
- **Story:** nothing-changed-nothing-runs
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** 2026-11-09, jwloka, plan-PR #3308 merged
- **Delivered:** 2026-11-10

## Changelog

- fleetd now tells a live agent from a dead one by a token the agent holds, not by asking the process table when a pid started. A wrapper killed by `SIGKILL`, OOM or a reboot no longer hides a live agent or invents a dead one. The per-desk AgentMonitor processes stop; fleetd writes the same findings (`owes an answer`, `holds unlanded work`, `owes a review`, `owes a gate`) and stops asking the host about each desk's pull request every 5 minutes.

Board impact: the board shows the same agent states and findings, and a desk with no token shows "liveness by start time". `skills/plot/scripts/plot-agent-monitor.sh` (570 lines) and its README row go; `plot-monitor-subject.sh` loses the monitor nap. The page, the plan format, the template and the `docs/plans` layout do not change.

## Motivation

fleetd must know when a worker dies, to restart its slice, release its claim or reap its desk (story, Phase 6). The wrapper writes `.plot-worker.exit` on a normal end. A wrapper killed by `SIGKILL`, OOM or a reboot writes nothing, and its agent can outlive it. Today the reading that separates a live worker from a reused pid is the start time:

| Reader | Where | Question |
|---|---|---|
| desk worker state | `plot_pid_is_current`, `skills/plot/scripts/plot-worker-state.sh:347` (`ps -o lstart=` at `:352`); after `desk-probes-in-domain`, `pidIsCurrent` over one process table per pass | is the recorded pid the worker the wrapper started? |
| PR reader's followers | `psLiveness`, `packages/fleet/src/server/entry/pr-reader.ts:98` (`ps -o pid=,lstart=` at `:106`), called only by `stillFollowed` (`:139-153`) for `board.<pid>` heartbeats, which reads `.alive` and never `startedAt` | does a board that follows this reader still run? |
| reader election | `readerIsStale`, `packages/domain/src/rules/reader-election.ts:65`; `packages/domain/src/adapters/reader-lock/reader-lock-file.ts:434` passes `null` after `pidAlive` (`process.kill(pid, 0)`) and falls back to the 10-minute age bound; no `ps` | does the elected PR reader still run? |
| implement lock | `holdingRecord`, `packages/fleet/src/shared/implement-run.ts:205-211` (`probe.startedAt`, `process-probe-system.ts:20-28`); `implementLockHeld`, `rules/implement-lock.ts` | does the implement or brief run still hold the slug? |
| continue lock | `holdingRecord`, `packages/fleet/src/shared/continue-lock.ts:66-72`; `continueLockHeld`, `rules/continue-lock.ts:46` | does a continue call still hold the desk? |

Node has no API for a process's start time and macOS has no `/proc`, so `kill(pid, 0)` alone cannot tell a reused pid from the worker. Each start-time read is a `ps` process.

The AgentMonitor (`plot-agent-monitor.sh`) runs one loop per desk for the agent's life. Every 300 s (`PLOT_MONITOR_INTERVAL`, `:138`) its `sample_finding` (`:424`) reads the marker, `git status`, `git rev-list` and `plot-host.sh pr-state <branch>` (`:257-264`); the story names that host call as a per-desk cost that stays until this phase. When the agent exits, the loop runs one final pass (`:565-569`), the pass that catches an agent that committed everything and opened no PR.

Census on CI run 42595561157 (PR #3277): S4 on GitHub with 3 desks reads 2585.5 `execve` per pass, of which `ps` is 21 per pass; Bitbucket with 3 desks 2676; S5 2587; S6 2696. P1 (an AgentMonitor's naps) reads 0 since `monitors-nap-without-sleep`. No census row counts the AgentMonitor's 300 s pass.

## Design

This plan depends on `node-worker-wrapper` (all three slices), because the token is opened by the node wrapper, and on the *Worker readings* slice of `desk-probes-in-domain`, because the *Worker token* slice replaces the start-time column that slice reads into `readWorkerReadings`. `triggers-replace-the-tick` depends on this plan: its trigger "a worker ends without a record" is the token's end-of-file. This plan shares `continuation.ts` with `node-worker-wrapper` and `registryd-main.ts` with `desk-probes-in-domain`; it shares `registryd-main.ts` with `github-reads-in-process` too (that plan moves `mergedBranches`, this plan changes the worker reading), and the second to merge rebases; it shares no file with `refs-from-files`, `one-cat-file-batch` or `sprint-prs-run-ci`.

### Approach

**The token.** A FIFO at `<desk>/.plot-worker.token.fifo`. The wrapper creates it with `mkfifo` before the agent starts, opens it read-write (an open for write alone blocks until a reader exists), passes the descriptor to the agent as fd 3 through `spawn`'s `stdio`, and closes its own copy once the agent runs. A holder is any process that inherited fd 3: the agent's `sh`, `plot-worker-loop.sh`, the node loop under it, and the harness the loop starts. A node process that receives fd 3 through `spawn` `stdio[3]` keeps it, and a child it spawns with three `stdio` entries does not (measured on macOS, Node v26.13.0), so the node loop names fd 3 in the `stdio` of every harness it spawns. A loop killed alone (jetsam, OOM) with a live harness therefore leaves the token `held`, and the desk reads `stray-holder`, never `dead`: no second writer starts on the branch. The *Worker token* slice measures the chain with `lsof` on Linux and macOS before it writes the rule. A reader opens the FIFO `O_RDONLY | O_NONBLOCK` and reads once: `EAGAIN` means at least one holder is alive; a read of 0 bytes means no holder is left; `ENOENT` means no token was ever made. Each answer is a syscall, not a process.

`workerLiveness({ exit, token, pidAnswers })` in `packages/domain/src/rules/worker-liveness.ts` decides, in this order:

1. An exit record exists and is not older than the token (its mtime against the FIFO's, both file reads) → the process ended; the token is not read. A holder that outlived the agent (a background child that kept fd 3) does not keep a finished desk `running`. An exit record older than the token is a late write from an earlier run's wrapper (#1379, `continuation.ts:1096-1105`) and is ignored.
2. No exit record, the token reads `held`, `kill(recordedPid, 0)` answers, and the manifest's `startedAt` lies less than `Worker bound` ago → `live`.
3. No exit record, the token reads `held`, and the recorded pid does not answer → `stray-holder`: the worker ended without a record and a process that inherited fd 3 still holds the token. It starts no restart and releases no claim, and it reads `dead` once `Worker bound` from `startedAt` has passed. A `held` token past `Worker bound` never reads `live`, because the bound the wrapper enforced dies with the wrapper.
4. No exit record and the token reads `released` → `dead`: the wrapper was killed and every holder is gone. This is the case the exit record cannot cover. fleetd writes a desk log line and a `.plot-worker.monitor.agent.jsonl` line with the reason "the token was released with no exit record".
5. No token (`ENOENT`, a non-FIFO at the path, a desk launched before this plan, or a hand-started worker) → the start-time path from `desk-probes-in-domain`, unchanged. `workerLiveness` reports the basis of its answer, `token` or `start-time`, and the board shows "liveness by start time" on a desk whose answer has the basis `start-time`.

**`orphaned` reads the process table on a trigger only.** The `orphaned` reading (`rules/agent-state.ts:23-26`) needs the process-table walk (`plot-worker-state.sh:1020`). fleetd runs that walk for a desk only when its token reading changes or its worker loop records a new pass, and carries the last answer between triggers. A pass with neither runs no `ps` for the desk. No slice drops `orphaned` to meet a census number.

**Desks live on a local filesystem.** `mkfifo` fails on some network filesystems, and NFS can create a FIFO node whose pipe lives in each host's kernel, so a reader on another host reads `released` for a live agent. The desk root therefore must lie on a local filesystem. `skills/plot-dispatch/README.md` and the `plot-desk-root.sh` row of `skills/plot/scripts/README.md` state this. The desk-root check reads the filesystem type of the root once per operator command (the `statfs` magic number on Linux, the `mount` line of the root's mount point on macOS), and `plot_desk_root` exits 3 with the type named when the type is `nfs`, `smbfs`, `cifs`, `afpfs` or `webdav`. A type outside that list passes, and a failed `mkfifo` still falls back to rule 5.

`workerLiveness` owns this order. `agentState` (`rules/agent-state.ts:136`) returns `running` on `live` before any exit arm today, so the *Worker token* slice makes `agentState` take `workerLiveness`'s answer and not reorder it.

**Making the token.** The wrapper calls `mkfifo` on a temporary name in the desk, opens it read-write, `rename`s it over `.plot-worker.token.fifo`, and only then removes the previous run's `.plot-worker.exit` and writes the new pid. A restart therefore never reads a stray holder of the earlier run's FIFO, and a reader in the gap never sees "no exit record" next to the old `released` FIFO. When `mkfifo` or the open fails, the wrapper leaves no file at the token path, writes the errno and path to the desk log, records `token: none (<reason>)` in the manifest, and starts the agent with no token (rule 5).

**Why the agent and not the wrapper holds it.** A token held by the wrapper alone reads `released` when the wrapper is killed while the agent lives; a restart would then put two writers on one branch (story, Phase 6). A token held only through the agent's process group reads `held` as long as any holder lives, so a false `released` needs every holder to close fd 3. The tests below try the ways that can happen.

**Reader election: no token.** The election runs no `ps` today: `reader-lock-file.ts:434` passes `null` as the start time after `pidAlive`. The one `ps` on this path is `psLiveness`, which `stillFollowed` (`pr-reader.ts:139-153`) calls for the `board.<pid>` followers on every `PR_REFRESH_MS` beat, and a token held by the reader cannot answer for a follower. `stillFollowed` reads only `.alive`, and a fresh heartbeat already bounds pid reuse, so `psLiveness` becomes `process.kill(pid, 0)`: no process, no FIFO, no new file.

**Implement lock: stays on `ps`.** All three callers of `implementLockHeld` (`dispatch-command.ts:135`, `brief-ask.ts:141`, `implement-run.ts:601`) run at action time, and an action is itself a trigger (story, *Re-ask before acting*). A token would add a FIFO per run and save one `ps` per action, and a token opened by the runner is not held by the agent, because Node passes no non-stdio descriptor to a child unless its `spawn` names it. `holdingRecord` keeps `probe.startedAt` (`implement-run.ts:205-211`), and this plan names the lock and leaves it, as it leaves the continue lock.

**Continue lock: stays on `ps`.** `continueLockHeld` is asked only when a person presses Continue or the registry tick starts a fresh session, an action that the story counts as a trigger, and its holder lives for one HTTP request. A token adds a file per request and saves one `ps` per action. This plan names it and leaves it.

**The AgentMonitor loops end.** `agentFinding(readings)` in `packages/domain/src/rules/agent-finding.ts` moves `sample_finding`'s order: marker → dirty → unpushed → no commits → no PR → no changeset. fleetd computes it per desk from the readings `readDeskReadings` already takes (marker, dirt, unpushed) and from the branch stage the same pass holds (`commitsAhead` and `changedPaths`, `plan-walk-branches.ts:465-478`), not from new per-pass `git` calls and not from `plot-host.sh pr-state`; `DeskReading` (`plan-walk-desks.ts`) holds no commit count and no changeset list. On a per-pass read, a branch with no PR answer licensed as `none` answers `unaskable` and writes no `owes a review`, because the PR index never says `pr: 'none'`. The final pass asks the host once for the branch, one `pr-state` per agent end: an agent's end is a trigger the story allows. A refused or unaskable `pr-state` writes no `owes a review`, and the desk log names the refusal. fleetd appends a finding line to `.plot-worker.monitor.agent.jsonl` with the shell's field order only when the finding changes, as `monitor_pass` does. The final pass runs when `workerLiveness` moves from `live` to `ended` or `dead`, and once per desk at fleetd start (the story's startup full read). The wrapper stops starting `plot-agent-monitor.sh`; `deskMonitorsShell.start` and the script go.

**With no fleetd, the wrapper runs the final pass.** `plot-dispatch-command.mjs` dispatches with no board and no fleetd, and `packages/board/src/server/findings.ts:12-14` names why findings matter there: the failures they catch happen where nothing else is up. When the agent ends, the node wrapper reads fleetd's heartbeat. With no live heartbeat, the wrapper computes `agentFinding` once over the desk's readings and one host `pr-state`, and appends the finding line to `.plot-worker.monitor.agent.jsonl`. With a live heartbeat, the wrapper writes nothing and fleetd runs the final pass, so one agent end writes one finding. A desk with no fleetd writes no per-pass findings while its agent runs.

**Census effect.** The *Worker token* slice removes the start-time read from every pass for a desk with a token. After `desk-probes-in-domain` that read is the `lstart` column of one shared `ps` table. The `orphaned` walk runs only on a token change or a loop pass, so an idle pass with every desk on a token runs no `ps`: S4 GitHub 3 desks reads `ps` 0 per idle pass, from 21 on the baseline. The slice's value is the killed-wrapper answer and the trigger `triggers-replace-the-tick` needs. The wrapper adds one `mkfifo` process per launch; a launch is an action and so a trigger (story, *Re-ask before acting*), outside the per-pass count. No FIFO is made per election beat. The *Locks* slice removes the `ps` that `stillFollowed` starts on every PR beat while a board follows a reader. The *Monitor in fleetd* slice removes one `bash` loop per desk and, per desk every 300 s, `git status`, `git rev-list`, `git log` and one `plot-host.sh pr-state` with its `gh` or `bb` call. P1's fixture starts `plot-agent-monitor.sh`, so P1 is retired in the same slice that deletes the script, and the census README names the replacement: a new row `P6: an idle desk with a live agent starts no monitor process` holds the zero. A second row holds fleetd's finding cost: `execve` per pass for 3 desks with no HEAD change reads at or below S4 at the merge base.

### Open Questions

- [x] **Who holds fd 3** (panel disagreement 1). Measured on macOS, Node v26.13.0 (panel, correctness juror): a node process that receives fd 3 through `spawn` `stdio[3]` keeps it, and a child it spawns with three `stdio` entries does not. `plot-worker-loop.sh:18` `exec`s the node loop, so today the holders are the `sh -c` and the node loop, and the token answers "the loop lives". Options: (a) the loop also passes fd 3 to the harness, so a loop killed alone (jetsam, OOM) with a live harness does not read `dead` and start a second writer (correctness); (b) the loop holds fd 3 and closes it for every child (`3>&-`), so one known holder answers (operator); (c) the loop holds it and passes a second token to the harness only (cost). The *Worker token* slice still measures the chain with `lsof` on Linux and macOS before it writes the rule. A person decides. **Decided 2026-11-09, jwloka: option (a). The loop and the harness both hold fd 3.**
- [x] **How `orphaned` keeps its answer** (panel disagreement 2). The `orphaned` reading (`rules/agent-state.ts:23-26`) needs the process-table walk (`plot-worker-state.sh:1020`). Options: (a) keep the walk, 1 `ps` per pass (the plan as written); (b) run the walk only on a trigger, such as a log that stops growing past `Slice idle after` (correctness, operator); (c) a second token passed only to the harness: "loop token held, harness token released" reads `orphaned`, 0 `ps` per pass, one more `mkfifo` per launch (cost). No slice drops `orphaned` to meet a census number. A person decides. **Decided 2026-11-09, jwloka: option (b). The process walk runs only on a trigger: a token change or a loop pass.**
- [x] **The implement lock: token or `ps`** (panel disagreement 3). Options: (a) a token, with the agent and group arms of `implementLockHeld` kept, so a runner `SIGKILL`ed alone with a live agent still holds the slug (correctness); (b) stay on `ps`: all three callers (`dispatch-command.ts:135`, `brief-ask.ts:141`, `implement-run.ts:601`) run at action time, the argument the plan already gives for the continue lock (cost). A person decides. **Decided 2026-11-09, jwloka: option (b). The implement lock stays on `ps`, like the continue lock, because its callers run at action time.**
- [x] **The final pass's "no PR"** (panel disagreement 4). Options: (a) on the final pass only, ask the host once for the branch (`pr-state`), a trigger the story allows, with a host stub that answers no PR in the test (correctness, operator); (b) read the branch stage's `pr: 'none'`, which `plan-walk-branches.ts:372`/`:377` give only from a complete listing, at zero host calls, and answer `unreadable` when the listing is incomplete (cost). A person decides. **Decided 2026-11-09, jwloka: option (a). One host `pr-state` per agent end.**
- [x] **A dispatch with no fleetd** (panel, shared blind spot). `plot-dispatch.sh:1430-1431` starts `plot-agent-monitor.sh` per desk whatever runs above it, and `packages/board/src/server/findings.ts:12-14` names the reason: the failures the monitors catch happen where nothing else is up. `plot-dispatch-command.mjs` dispatches with no board and no fleetd. After the *Monitor in fleetd* slice such a desk writes no finding and no final pass. Options: (a) the wrapper keeps a final pass of its own; (b) a desk with no fleetd writes no findings, and the board says so; (c) dispatch requires fleetd. A person decides. **Decided 2026-11-09, jwloka: option (a). With no fleetd running, the node wrapper keeps its own final pass.**
- [x] **Desks on a network mount.** `mkfifo` fails on some network filesystems, and the wrapper then starts the agent with no token (rule 5, logged; all three jurors accept the fallback). Unverified (panel): NFS can also create a FIFO node whose pipe lives in each host's kernel, so a reader on another host reads `released` for a live agent. A person confirms that desks live on a local filesystem, or asks for a same-host check. **Decided 2026-11-09, jwloka: desks must be on a local filesystem. The plan documents it, and the desk-root check refuses a known network filesystem type.**
- [x] **The board label for a desk with no token** (operator juror only). Show "liveness by start time" on that desk, or keep the board unchanged as *Board impact* states. A person decides. **Decided 2026-11-09, jwloka: the board shows "liveness by start time" on a desk with no token.**

## Done when

| Claim | Check | Slice |
|---|---|---|
| A live agent reads live after its wrapper is killed | test: `SIGKILL` to the node wrapper while the loop runs; `workerLiveness` reads `live` for 3 reads over 3 s; no restart starts | Worker token |
| A killed tree reads dead with no exit record | test: `SIGKILL` to the wrapper's whole group; the token reads `released` on the next read and `workerLiveness` reads `dead` | Worker token |
| A reused pid cannot hold the token | test: after the worker ends, a new process takes the recorded pid (forced by a pid-reuse fixture on Linux with `ns_last_pid`, or by a stub table); the token reads `released` and the desk reads `ended`/`dead`, never `live` | Worker token |
| A finished desk does not stay running | test: the agent exits 0 and leaves a background child holding fd 3; the exit record wins and the desk reads `finished` | Worker token |
| A loop killed alone does not read dead | test: `SIGKILL` the node loop alone while its harness runs; the token reads `held`, the desk reads `stray-holder`, and no restart starts; `lsof` on Linux and macOS shows fd 3 open in the harness | Worker token |
| A stray holder has a bound | test: `SIGKILL` the wrapper, end the loop, leave a child holding fd 3; the desk reads `stray-holder` on the next read, starts no restart, and reads `dead` once `Worker bound` from `startedAt` has passed; a desk past `Worker bound` never reads `live` | Worker token |
| A restart never inherits the old token | test: restart a desk whose earlier run left a stray holder on its FIFO; the new run makes a new FIFO by `rename`, and the desk reads `dead` when the new loop's holders are gone | Worker token |
| A late exit record does not end a new run | test: an exit record written after the current token was made wins; one older than the token is ignored and the desk reads `live` | Worker token |
| Exit record and token: one order | corpus row "exit record present, token held" reads `finished`/`failed` through `workerLiveness`, and `agentState` takes that answer | Worker token |
| A desk on a network filesystem is refused | test: `plot_desk_root` with a stubbed filesystem type of `nfs` or `smbfs` exits 3 and names the type; `apfs` and `ext4` pass | Worker token |
| A desk with no token says so | `workerLiveness` row: a desk with no token answers basis `start-time`; a board test shows "liveness by start time" on that desk and nothing on a desk with a token | Worker token |
| A failed `mkfifo` leaves no token and a reason | test: `mkfifo` fails; no file exists at the token path, the desk log and the manifest name `token: none (<reason>)`, and the desk reads the start-time path; a regular file at the token path also reads the start-time path | Worker token |
| A released token names its cause | test: `SIGKILL` the wrapper's whole group; the desk log and `.plot-worker.monitor.agent.jsonl` carry "the token was released with no exit record" | Worker token |
| The FIFO is not dirt | test: a desk holding `.plot-worker.token.fifo` reads clean through `deskDirtFilter` and the shell's `PLOT_WORKER_RECORD`; the `desk-probes-in-domain` corpus carries a FIFO row | Worker token |
| A desk with no token keeps today's answer | `worker-readings.corpus.test.ts` still passes on desks launched before the token | Worker token |
| No pass reads a start time for a desk with a token | no `lstart` read for a desk with a token; census S4 GitHub 3 desks: `ps` 0 per idle pass; a test: the `orphaned` walk runs on a token change and on a loop pass, and on no other pass; S4, S5 and S6 read at or below their merge base on every fixture | Worker token |
| The PR reader's follower check needs no `ps` | test: `stillFollowed` reads a live `board.<pid>` follower as followed and a killed one as not, through `process.kill(pid, 0)`; no `ps` starts on a PR beat | Locks |
| The implement lock is named, not moved | `implement-run.ts` `holdingRecord` unchanged; the plan's Notes name the implement lock with its reason | Locks |
| The continue lock is named, not moved | `continue-lock.ts` unchanged; the plan's Notes name it | Locks |
| fleetd writes the AgentMonitor's findings | `agentFinding` rows: one per `sample_finding` arm in the shell's order; a fleetd test over 4 desks writes the same `.plot-worker.monitor.agent.jsonl` lines (timestamps masked) as `plot-agent-monitor.sh --once` | Monitor in fleetd |
| The final pass is not lost | test: an agent exits 0 with commits and no PR; fleetd writes `owes a review` within one pass, from one host `pr-state` call for that agent end (a host stub answers no PR); a per-pass read with no licensed `none` writes no `owes a review` | Monitor in fleetd |
| A dispatch with no fleetd keeps its final pass | test: with no fleetd heartbeat, an agent exits 0 with commits and no PR; the node wrapper writes `owes a review` once; with a live heartbeat the wrapper writes nothing and fleetd writes it once | Monitor in fleetd |
| Findings cost no new per-pass process | census: `execve` per pass for 3 desks with no HEAD change reads at or below S4 at the merge base; the finding reads `commitsAhead` and `changedPaths` from the branch stage | Monitor in fleetd |
| No desk runs a monitor | after a dispatch, no process runs `plot-agent-monitor.sh`; `scripts/check-shell-lines.sh pr` reads at least 250 fewer counted commands (`plot-agent-monitor.sh` counts 250 on `11a270538`) | Monitor in fleetd |

## Slices

### Worker token

- `feature/liveness-token-worker` — the wrapper makes `.plot-worker.token.fifo` and hands fd 3 to the agent; a `LivenessToken` port and FIFO adapter in `packages/domain/src/adapters/liveness-token/`; `workerLiveness` in `rules/worker-liveness.ts`; `readWorkerReadings` reads the token before the start time; the loop passes fd 3 to the harness; the `orphaned` walk on a trigger; the network-filesystem refusal in the desk-root check; "liveness by start time" on the board; the pid-reuse and killed-wrapper tests <!-- builds: workerLiveness, worker liveness from an inherited FIFO token --> → #3361

### Locks

- `feature/liveness-token-locks` — `psLiveness` in `pr-reader.ts` becomes `process.kill(pid, 0)`; the implement lock and the continue lock stay on `ps` <!-- builds: a ps-free reader follower check --> → #3364

### Monitor in fleetd

- `feature/liveness-token-monitor` — `agentFinding` in `rules/agent-finding.ts`; fleetd writes the findings, and the final pass with one host `pr-state` per agent end; the node wrapper runs the final pass when no fleetd heartbeat is live; the wrapper stops starting `plot-agent-monitor.sh`; the script, `deskMonitorsShell.start` and the README row go; census P1 retired and P6 added in the census README; a changeset <!-- builds: agentFinding, the AgentMonitor's findings computed in fleetd --> → #3365

## Notes

- Census row numbering: this plan adds `P6` (an idle desk with a live agent starts no monitor process); `github-reads-in-process` adds `P5`.
- Phase 6 of the story [`nothing-changed-nothing-runs`](../stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md); candidate plan `liveness-token`; depends on `node-worker-wrapper` and on `desk-probes-in-domain`'s *Worker readings* slice.
- The continue path already holds a FIFO, `.plot-worker.reporter.fifo` (`packages/fleet/src/shared/continuation.ts:831-880`), but closes it for the `Worker command` (`3>&-`) and reads it only inside the reporter. `node-worker-wrapper` moves that path onto the node wrapper; this plan replaces the reporter FIFO with the token.
- The story cites the AgentMonitor's final pass at `plot-agent-monitor.sh:552-569`. On this worktree `:552` is the first pass, the loop is `:565-567` and the final pass `:569`.
- The continue lock stays on `ps`: it is an action-time read (story, *Re-ask before acting*: "An action is itself a trigger"), and its holder lives for one request. The implement lock stays on `ps` for the same reason: its three callers run at action time.
- Cross-plan: whichever of `desk-probes-in-domain` and `node-worker-wrapper` lands second keeps `LC_ALL=C` on the `ps -o lstart` start-time stamp, which rule 5 still reads for a desk with no token.
- Deliverable search (`plot-deliverable-search.sh`) for `liveness-token`, `liveness token`, `livenessToken`, `holderGone` and `FIFO` found no token deliverable. It found `REPORTER_FIFO_FILENAME` and `reporterShell` (`continuation.ts`) and the monitor nap's FIFO in `plot-monitor-subject.sh:193`, neither a liveness reading for fleetd.
- Census figures: `census-report-head` artifact of CI run 42595561157 (PR #3277, 2026-11-09), per pass (half the two recorded passes).
- Line numbers checked on `idea/batch-refs-from-files` at `11a270538`, 2026-11-09.
- Definition of Done: docs/definition-of-done.md.
