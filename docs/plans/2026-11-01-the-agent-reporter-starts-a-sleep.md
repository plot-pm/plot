# Two per-agent waits start a process per poll

> The reporter beside every continued or restarted agent starts a `sleep` 20 times per second, and the AgentMonitor beside every agent starts `sleep`, `cat` and `tr` once per second. Both run for the agent's whole life. The reporter waits on a held descriptor and starts no process while the agent runs; the AgentMonitor reads the pid file with a builtin and starts one process per second instead of three.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** delivery-loop
- **Issue:** #3024
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-01, Jan Wloka, plan-PR #3025 merged
- **Started:** 2026-11-01, Jan Wloka, `bug/the-agent-reporter-waits-without-a-poll`

## Changelog

- A continued or restarted agent no longer costs a process start per 50 ms for its whole run. The reporter beside it waits on a FIFO that the agent holds open and starts no process until the agent ends. It still writes the exit record and the `WorkerMonitor` line once, after the agent ends, and it still writes `137` after a `SIGKILL`.
- The AgentMonitor that watches every agent starts one process per second instead of three. It reads the agent's pid file with the shell's `read` builtin instead of `cat` and `tr`. Its one-second check and its pass interval do not change.
- Tests: `packages/fleet/test/unit/continuation.test.ts` runs the reporter's `sh -c` command alone and holds the exit record, the `WorkerMonitor` line, `SIGKILL` → `137`, group `SIGTERM` → `143`, the ppid-1 shape and the process-start count. `test/reconcile/agentmonitor.test.mjs` holds the AgentMonitor's start count.

<!-- Board impact: none. One TS-built shell string, one sourced helper and their tests; no plan-format, template, helper-script-contract or board change. -->

## Motivation

Two loops start processes for every second of every agent's life.

**The reporter.** `packages/fleet/src/shared/continuation.ts:1398` builds the agent's `sh -c` command. Its reporter part is:

    ( trap '' TERM; while kill -0 "$agent" 2>/dev/null; do sleep 0.05; done; ${reporterTail} ) &

- The reporter runs beside every continued or restarted agent. `plot-dispatch.sh --restart` reaches `continueOnDesk` too (`test/e2e/monitors-attached.test.mjs:34-35`).
- On an idle machine it starts up to 20 `sleep` processes per second: up to 576,000 over the `Worker bound` of 28800 s.
- Under load the rate falls, because each start is slower. Measured 2026-11-01 at 22:15: a 10 s `ps` sample found 49 `sleep 0.05` starts under one restarted agent's `sh -c` wrapper (pid 24682), about 5 per second. The seams juror's shim run counted 8 starts in 5 s at about 600 ms per start.

**The AgentMonitor.** `plot_monitor_wait` (`skills/plot/scripts/plot-monitor-subject.sh:193-203`) naps `sleep 1`, then calls `plot_monitor_subject`, which reads the pid with `$(cat "$pid_file" | tr -d ' \n')` (`:131`). `plot-agent-monitor.sh:565` runs that loop until the agent ends.

- Every agent gets an AgentMonitor: a dispatched agent through `start_worker`, a continued or restarted agent through `startMonitors` (`continuation.ts:790-805`, `desk-monitors-shell.ts:9`).
- Measured by the seams juror with `PATH` shims against a live pid for 5 s: 5 `sleep`, 5 `cat`, 5 `tr`. That is 3 starts per second per agent, independent of load, because the nap is fixed.
- With 6 agents the AgentMonitors alone start 18 processes per second. A continued agent runs both loops: up to 23 starts per second on an idle machine.

**Why the starts matter.** On the measuring machine every process start costs a `syspolicyd` check. A `syspolicyd` log over 68 s shows checks on 17,435 distinct processes (about 256 per second) at 80 to 85 % CPU. Each process start cost 50 to 300 ms, and fleetd's auto-dispatch held back new agents (`spawn cost 131.0 ms against a clear reading under 10 ms`).

**Other sources.** The board's request path (#3017, plan `the-board-starts-processes-on-the`) and the fleet scan are separate plans. The panel counted every other short-interval poll in shipped code; each is bounded, operator-run or one-shot (see Notes). These two loops are the only ones whose cost grows with the number of agents and with their run time.

## Design

### Mechanism measured

All four jurors ran shell probes in round 1.

- **The held descriptor works on both shells.** Layering (`scratchpad/jl/exp/probe.sh`, macOS `/bin/sh`): natural exit → `done rc=0`, agent ppid 1; `kill -9` to the recorded pid → `done rc=137` while the command's own `sleep 30` still ran; group `SIGTERM` → `rc=143`, reporter alive. Safety (`scratchpad/probe/probe.mjs`, `linux.sh`; macOS `/bin/sh` and `dash` in `debian:stable-slim`): natural exit, `exit 3`, instant exit, `SIGKILL` and group `SIGTERM` each wrote the exit record and exactly one finding, with 4 process starts per run whatever the run time. Testability (`/bin/sh` and `/bin/dash`): with the write end closed on the command, EOF arrived in the same second as `kill -9`.
- **Three ways to lose the finding, each proven by probe.**
    - The command keeps the write end: after a `SIGKILL` the finding waits for the command's last descendant. Safety measured 4 s and 6 s for `sleep 4` and `sleep 6 & exit 0`; with a daemon there is no bound. Testability: `done=none` after 1.5 s.
    - The reporter keeps the write end: it never sees EOF, never writes, and with `trap '' TERM` it survives `--stop` (safety, pid 22140, ended only by `SIGKILL`).
    - A failed open of the FIFO path by `exec 4<"$FIFO"` ends the reporter's shell under both shells before it writes `WorkerMonitor` or `137`. A redirect on a compound command, `{ ...; } < "$FIFO" || fallback`, is not fatal and falls through on both shells (safety).
- **Open order.** If each side opens its end of the FIFO by path, an agent that ends before the reporter opens leaves the reporter blocked in `open` forever, an orphan at ppid 1 (testability, safety). The outer shell must open the FIFO read-write before it forks either side.
- **The bounded builtin poll does not exist.** `dash` has no `read -t` and no builtin `sleep`; bash 3.2 has no `sleep` builtin. A 1 s poll starts one `sleep` per second, so its count still grows with run time (all four jurors).

### Approach

**Slice 1: the reporter waits on a held descriptor, inside the existing `sh -c` string.**

- The change stays in the string `continuation.ts:1391-1399` builds. No new shipped script: it would grow shipped shell and add a script crossing that CI ratchets. No node reporter: it would keep a node process (tens of MB) per agent for the whole run and still poll `process.kill(pid, 0)`, because it cannot `wait` on a non-child. No new spawn site: CI's *One place reaches a process* step does not see `spawnFn(` (layering).
- The reporter stays a sibling of the agent, never its parent. The ppid-1 argument at `continuation.ts:1264` onward and `continue-route.test.ts:2730` hold the recorded pid at ppid 1, and ad509c157 records that a waited-on process cannot have ppid 1. The dispatch path's `start_worker` already runs `wait "$agent"` as the agent's parent and starts no poll process; its contract differs, and it is out of scope.
- The descriptor discipline:
    - The FIFO is `.plot-worker.reporter.fifo` in the worktree, beside `.plot-worker.exit`, with a `.gitignore` line beside `.gitignore:66`. The controller removes a stale FIFO before the spawn, as it removes `.plot-worker.wrapper.pid`.
    - The outer shell runs `mkfifo`, then opens the FIFO read-write on one descriptor before it forks the agent or the reporter. The open must not be fatal: on a failed `mkfifo` or open, the agent still starts exactly once and the reporter takes the fallback.
    - The agent runs its command with the write end closed, `( ${cmd} ) 3>&-`, so a command's descendants cannot delay the finding.
    - The reporter opens its read end while it still holds the inherited descriptor, then closes the write end inside the redirected block, `{ exec 3>&-; while read -r _; do :; done; } < "$FIFO" || fallback`. After the read ends it runs `reporterTail` and removes the FIFO by its exact path.
    - The outer shell holds no write end after it forks both sides. No process other than the agent subshell holds the write end.
    - The fallback is today's `kill -0` loop at a 1 s interval. It writes `137` and exactly one finding. It starts one `sleep` per second and runs only when the FIFO cannot be made or opened.
- The `sh -c` string moves into one exported arrow function in `continuation.ts`, so a unit test can spawn it alone. `continueOnDesk` calls it.
- The comment block at `continuation.ts:1275-1374` describes the poll ("It polls `kill -0`", "the one case where polling is unavoidable"). It is rewritten to describe the held descriptor.
- `reporterTail` keeps its text. It and `start_worker`'s tail are a declared duplicate held by `monitors-attached` and `monitors-end`; the slice adds no third copy.

**Slice 2: the AgentMonitor reads the pid with a builtin.**

- `plot_monitor_subject` reads the pid file with `read -r pid < "$pid_file"` instead of `$(cat ... | tr -d ' \n')`. `pid` is initialised in its `local` line, so a failed read leaves it empty and the existing `''` arm answers `starting` or `gone`. `$(dirname "$pid_file")` becomes `${pid_file%/*}`.
- The `sleep 1` nap stays. No builtin wait with a bound exists in `dash` or bash 3.2, and the AgentMonitor is a separate process that cannot share the reporter's FIFO without a new seam. One start per second per agent is the floor this slice reaches; a wake-up from the agent's end is a follow-up.
- `plot_watched_desk` does not change. The reporter sources it, and `packages/domain/corpus/desk-manifest.corpus.test.ts` holds it to `watchedDesk`.
- `scripts/check-shell-lines.sh pr` reads zero or fewer. The slice never joins lines to pass it.

**Order: none.** The slices share no file. Slice 1 changes `continuation.ts`, its unit test and `.gitignore`; slice 2 changes `plot-monitor-subject.sh` and `agentmonitor.test.mjs`. They write different findings files: the reporter appends to `.plot-worker.monitor.worker.jsonl`, the AgentMonitor to `.plot-worker.monitor.agent.jsonl` (`plot-agent-monitor.sh:144`). Their two contacts stay fixed: slice 1 keeps the writer and the content of `.plot-worker.pid`, which the AgentMonitor reads, and slice 2 keeps `plot_watched_desk`, which the reporter sources. Either can merge first.

### Constraints

- The process-start count is read from a `PATH` shim log, never from a process-table sample: a sample sees only the processes alive at sample time and depends on load. Testability's shim run of the current loop counted 12 starts at 1 s and 37 at 3 s against a nominal 20 and 60.
- The shim logs every external the code can reach (`sleep`, `cat`, `tr`, `date`, `kill`, `mkfifo`, `rm`, `ps`, `dirname`), not only `sleep`. A shim for `sleep` alone passes a loop that moves to another command.
- The agent in a test blocks on a FIFO the test holds and calls no shimmed name, so the shim never logs the agent's own command.
- The shim reaches the reporter through `input.spawn`: a wrapper over `spawn` that sets `PATH` and the log path in `env`, not a change to `process.env`.
- Every test waits for each process it started, by its own pid, and kills a blocked reporter in `afterEach`, so a failing row fails and does not hang. Each test removes its FIFO and worktree by the exact name `mkdtempSync` returned.
- `exec 3<>fifo` is not POSIX. Slice 1's rows run on macOS `/bin/sh` (bash 3.2) and on Linux `dash`: CI's fleet tests job runs on `ubuntu-latest`, and the PR records a local macOS run.
- No row asserts an elapsed time, only a bound. The existing bounds stay: `monitorLines` 10 s (`continuation.test.ts:44`), 5 s for the exit file after `SIGKILL` (`test/e2e/monitors-end.test.mjs:416`) and for the `WorkerMonitor` line (`test/e2e/monitors-attached.test.mjs:349`). The fallback's 1 s interval fits them.
- A `SIGKILL` to the recorded pid leaves `( cmd )` running, as today. This plan does not change that.
- New and changed functions are arrows; TSDoc states behaviour, not history.
- Each slice changes shipped code and carries a changeset for package `plot`.

### Open Questions

- [x] Does a blocking read on a descriptor held only by the agent subshell return EOF on `SIGKILL`, given that the agent's child inherits the descriptor? Yes, on macOS `/bin/sh` and on Linux `dash`, when the command runs with the write end closed (`3>&-`) and neither the reporter nor the outer shell keeps a write end. Without the close, the finding waits for the command's last descendant (layering, safety, testability; see *Mechanism measured*).
- [x] Which builtin waits without a process start in `sh` on macOS and on Linux? None. `dash` has no `read -t` and no builtin `sleep`; bash 3.2 has no `sleep` builtin. The bounded poll is dropped and survives only as slice 1's fallback, at one `sleep` per second.
- [x] How does the test count processes? A `PATH` shim log of every external name, injected through `input.spawn`, with the agent gated on a test-held FIFO. The assertion is zero starts while the agent runs and equal tail starts for a 1 s and a 3 s agent. A structural check on the command string is the second arm. The process-table sample is rejected.

## Done when

Slice 1 rows run in `pnpm --filter @plot-pm/fleet exec vitest run test/unit/continuation.test.ts`, on macOS and on CI's Linux runner. Slice 2 rows run in `node --test test/reconcile/agentmonitor.test.mjs`. The `SIGKILL` and group-`SIGTERM` rows run 20 times each in one test, so a race shows by repetition and not by one green run.

| Claim | Input | Expected | Test | Slice |
|---|---|---|---|---|
| The reporter starts nothing while the agent runs | shim log of every external; agent blocked on a test-held FIFO; release after 1 s and after 3 s | no shim line before release in either run; the same tail lines after release in both | `continuation.test.ts` | 1 |
| The wait holds no poll | the string the function returns | no `sleep` and no absolute path between the reporter's open and its tail | `continuation.test.ts` | 1 |
| A natural exit is reported once | command exits 0 | `.plot-worker.exit` reads `0`; one `clear` line | `continuation.test.ts` | 1 |
| A failing exit is reported once | `exit 3` | exit file `3`; one `gone` line | `continuation.test.ts` | 1 |
| The exit file exists when the agent is gone (d4bc9b8fc) | a shim that delays the reporter's first command | when `kill -0` on the recorded pid first fails, the exit file already holds the code | `continuation.test.ts` | 1 |
| A `SIGKILL` is reported while the command lives | `kill -9` to the recorded pid while `( cmd )` runs | exit file `137`; one `gone` line, asserted while the command's pid is alive | `continuation.test.ts` | 1 |
| A command's descendant cannot delay the finding | command leaves a background grandchild and exits | the finding arrives inside the bound while the grandchild lives | `continuation.test.ts` | 1 |
| An agent that ends at once is reported | the agent ends before the reporter opens its read end | one finding; no reporter left at ppid 1 | `continuation.test.ts` | 1 |
| A group stop does not end the reporter (6b0ac7188) | group `SIGTERM` | exit file `143`; the reporter survives; one `gone` line | `continuation.test.ts` | 1 |
| A FIFO that cannot be made falls back | a directory at the FIFO path | the agent starts once; the fallback writes the exit record and one finding; `137` after `SIGKILL` | `continuation.test.ts` | 1 |
| A missing script dir still reports | `PLOT_SCRIPT_DIR=/nonexistent` | exit file and finding written | `continuation.test.ts` | 1 |
| Nothing is left behind | after every row | no reporter in the group; no FIFO on disk | `continuation.test.ts` | 1 |
| The recorded pid has ppid 1 (ad509c157) | existing test | unchanged and green | `packages/board/test/unit/continue-route.test.ts:2730`, `:2801` | 1 |
| The e2e contracts hold | existing tests | green in CI | `test/e2e/monitors-end.test.mjs`, `test/e2e/monitors-attached.test.mjs` | 1 |
| The AgentMonitor starts one process per second | shim log of `sleep`, `cat`, `tr`, `dirname`; live pid; 5 s | 5 `sleep` lines; no `cat`, `tr` or `dirname` line (on `origin/main`: 5 of each) | `agentmonitor.test.mjs` | 2 |
| A pid file with no newline reads | `printf "%s" 123` into the pid file; live and dead pid | `alive` and `gone` | `agentmonitor.test.mjs` | 2 |
| A half-written or missing pid file keeps its answers | empty file; desk present; desk removed; exit file beside an empty file | `starting`, `starting`, `gone`, `gone` | `agentmonitor.test.mjs`, `moved-worker-pid.test.mjs` | 2 |
| The shipped shell does not grow | the slice's diff | `scripts/check-shell-lines.sh pr` passes with no joined lines | CI | 2 |

**Mutation checks.** Slice 1: remove `3>&-` from the command, and the `SIGKILL` row fails; keep the write end in the reporter, and the reporter row hangs to its bound and fails; restore the `sleep 0.05` loop, and the first two rows fail. Slice 2: restore `cat | tr`, and the start-count row fails.

## Slices

### Reporter wait

- `bug/the-agent-reporter-waits-without-a-poll` — `packages/fleet/src/shared/continuation.ts`: the `sh -c` string as one exported arrow function, the held-descriptor wait, the 1 s fallback, the rewritten comment block; the `.gitignore` line for `.plot-worker.reporter.fifo`; the stale-FIFO removal before the spawn; the slice 1 rows in `packages/fleet/test/unit/continuation.test.ts`; a changeset for `plot`. <!-- builds: the reporter's process-free wait on the agent in continuation.ts -->

### AgentMonitor read

- `bug/the-agent-monitor-reads-its-pid-with-a-builtin` — `skills/plot/scripts/plot-monitor-subject.sh`: `read -r` for the pid, `${pid_file%/*}` for the directory; the slice 2 rows in `test/reconcile/agentmonitor.test.mjs`; a changeset for `plot`. No wait: it shares no file with slice 1. <!-- builds: the AgentMonitor's one-start-per-second check in plot-monitor-subject.sh -->

## Notes

- Issue: https://github.com/plot-pm/plot/issues/3024. Amended from panel round 1 (`.plot/panels/2026-11-01-the-agent-reporter-starts-a-sleep/panel.md`, unanimous amend). The operator made the AgentMonitor loop slice 2 of this plan.
- Related: `the-board-starts-processes-on-the` (#3017) covers the board's request path, a different source of the same load.
- Definition of Done: docs/definition-of-done.md.

**Left out, each a follow-up rather than a slice here:**

- The AgentMonitor's `sleep 1` nap remains, one start per second per agent. A wake-up from the agent's end (a seam from the wrapper or the reporter to the monitor) needs its own issue.
- CI's *One place reaches a process* step greps `spawn(` and misses an aliased `spawnFn(` (`continuation.ts:1391`). Its blind spot needs its own issue.
- `host_slot_take` (`plot-host.sh:3875`) polls at 1 s for at most 30 s while an account's slots are full, so it multiplies when many callers wait at once. It belongs with #3017's family.
- The other short polls are bounded, operator-run or one-shot and stay as they are: `plot-board-verify.sh:42` (0.1 s, at most 100 passes), `plot-boardctl.sh:454` and `:553` (0.5 s, start and stop bounds), `plot-fleetctl.sh:571` (0.5 s, `--wait` bound), `plot-worker-state.sh:1110` (one 0.4 s sample), `plot-host.sh:2153` (one-shot timeout watcher), and `worker-loop.ts:1590` (30 s idle watcher, about 0.2 starts per second).
