---
title: Nothing changed, nothing runs
author: jwloka
status: ready
created: 2026-11-05
updated: 2026-11-05
---

# Nothing changed, nothing runs

## Objective

The board and the fleet start no process unless something changed. A board that no browser tab shows starts zero processes. fleetd starts a process only in answer to a change: a file under `.git` or a desk, a worker process that exits, or a host answer that differs from the last one. Every rule reads one shared snapshot of what is known, and only fleetd writes it.

## Why Now

On 2026-11-05 the operator's 16-core machine ran at load 13–17 for hours. `syspolicyd` used about 80 % CPU and `trustd` about 20 %, because macOS checks every new process, and the Plot processes started them at about 225 per second across three repos (3 boards, 3 fleetds). Stopping two repos' boards and fleetds brought load to about 7.

With only the plot repo's board and fleetd running, a 20-second sample counted about 1,800 new processes, about 90 per second. Of those, about 900 were `bash`, 315 `sleep`, about 200 `git`, about 200 text tools (`grep`, `cut`, `gsed`, `tr`, `awk`) and about 46 `node`. Plot's own logic is a small share; wrappers, polling and pipelines are the rest.

A 30-second sample of the two processes' direct children:

| Process | Direct children in 30 s | Largest items |
|---|---|---|
| board (nobody looking) | about 75 | 40 `git`, 8× `git rev-parse --show-toplevel`, 4× `plot-fleetctl.sh --status`, `plot-host.sh backend`, ref listings, per-desk worker-state probes |
| fleetd | about 160 | about 60 `bash -c . plot-worker-state.sh …` probes (one per desk per pass), 44 `git`, `plot-host.sh pr-list` per state |

The board does no work. It helps a person orient, so it has no reason to cost the machine anything while nobody looks at it.

## Decisions Taken in Scoping

- **A board that no browser tab shows starts zero processes.** It may take a second or two to catch up when a tab opens. — jwloka, 2026-11-05
- **The rule is "no process unless something changed", not a fixed budget per minute.** This holds for the fleet while agents work too. — jwloka, 2026-11-05
- **The target architecture is a change-driven observer (route B), delivered in the order of route A:** first the process-count gate and a baseline, then the board as a pure reader, then the largest sources one by one, then change-driven triggers in place of the tick. — jwloka, 2026-11-05
- **Aggregate and replace scripts so fewer processes obtain the same information.** Ask once and share the answer; never re-ask an answer that is fixed for the process lifetime; read files instead of starting git where git keeps the answer in a file; batch what still needs git; talk to the host in-process. — jwloka, 2026-11-05
- **A git library inside Node (route C) is excluded.** See Excluded from Scope. — jwloka, 2026-11-05

## Target Shape

**"Nothing runs" means no new process.** An in-process timer, a file read, a syscall and an HTTPS request from inside a long-lived process are allowed. A new process (`git`, `bash`, `ps`, `gh`, `node`, `sleep`) is allowed only in answer to a trigger.

**One observer, one snapshot.** fleetd observes and holds one snapshot per repository in memory: refs, worktrees and desks, worker records, PR rows and the config. It publishes changes over the existing channel. Every rule inside fleetd reads the snapshot. The board subscribes to the channel and asks the world nothing while a fleetd runs. The snapshot is not persisted, so *Answers, never verdicts* in `CLAUDE.md` stays unchanged, and the existing index files (`index/github.json`, `index/issues.json`, `last-pulse.json`, `default-branch.json`) keep their roles.

**Re-ask rules stay.** Every rule that asks the host again immediately before an action (`plot-ask.mjs merge` pinned to a head, `reviewPr`, destructive decisions on `mergedAt`) keeps doing so. An action is itself a trigger, so its re-ask is allowed. The CLI controllers (`plot-ask.mjs`, `plot-dispatch-command.mjs`, `plot-continue-command.mjs`) run on demand and are out of the idle count.

**A connected tab is an SSE client.** The board counts clients on `GET /api/events` (`EventHub.clients()`). With zero clients and no fleetd, the board holds no timer that starts processes. A plain HTTP request (`/api/board`, `/api/fleet`, `plot-boardctl.sh --status`) gets one fresh read when the board's view is cold, and does not keep the board watched.

**Triggers, not a tick.** fleetd re-reads only what a trigger names:

| Trigger | Source | What it re-reads |
|---|---|---|
| A ref or `packed-refs` changes | file events (FSEvents through `fs.watch`) on the common git dir | the changed refs, then the rules that read them |
| A desk's files change | file events on the desk's git index and `HEAD`, not the whole tree (a recursive watch over `node_modules` costs one inotify watch per directory on Linux) | that desk's status, through one `git status` |
| A worker exits | a liveness check from inside fleetd (see *Worker liveness* below) | that desk's worker record |
| The host answers something new | an in-process host poll whose answer differs from the last one | the changed PR rows, including a PR whose CI turned green |
| A deadline passes | an in-process timer set to the next recorded bound (`Claim stale after`, `Slice idle after`, `Worker bound`, `Checks wait`, the fixer bound, the default-branch re-ask) | the rule that owns the deadline |
| The config file changes | file events on `CLAUDE.md` | the config |

**Worker liveness.** fleetd is not the parent of a dispatched worker: `plot-dispatch.sh` starts each one under a detached `nohup sh -c` wrapper, so fleetd never sees the exit. `kill(pid, 0)` answers from inside fleetd, but cannot tell a reused pid, and today's start-time check reads `ps -o lstart`. The target is a liveness signal that needs no process, for example a socket or lock that the wrapper holds and fleetd tests. That is a new wrapper-to-fleetd contract inside `plot-dispatch.sh` and gets its own plan. Until then, one batched `ps -ax` per safety-net pass is allowed and counted by the gate.

**Answers with no process.**

- Fixed for the process lifetime: `rev-parse --show-toplevel`, `--git-common-dir`, the host backend. Read once at start.
- Kept in plain files by git: refs and `packed-refs`, each worktree's `HEAD` under `.git/worktrees/*/HEAD`. Read the files.
- Kept in plain files by Plot: `.plot-worker.*` records, `.plot/state/*`. Read the files.
- Process liveness: `kill(pid, 0)` plus the recorded start time. No `ps`, no `sleep` loop.

**Batched where git is still needed.** One long-lived `git cat-file --batch` (and `--batch-check`) per repository answers every object read. `git worktree list --porcelain` answers for all desks in one call. `git status` runs for a desk only when its files changed.

**The host in-process.** One GraphQL request returns the open PRs with their checks and review statuses, sent over Node's HTTPS client with a token read once at start, instead of one `gh` process per question. GraphQL has no conditional ("not modified") answers, so the poll stays unconditional at today's cadence and rate-limit spend; the goal is zero processes, not zero requests. The request stays inside the `host` connector adapter (*The Layering Rule*), and the connector keeps the budget and rate-limit bookkeeping that `plot-host.sh` does today.

**The per-desk shell probes become domain functions.** The `bash -c . plot-worker-state.sh && plot_worker_state …` calls and the `plot-agent-monitor.sh` polling loops are the paused Phase 4 of [`the-shell-holds-no-behavior`](../the-shell-holds-no-behavior/STORY-the-shell-holds-no-behavior.md). This story gives that phase a measured reason and an order: per-pass readings first.

## Current Plan

### Phase 1: The gate and the baseline ⏸️

- ⏸️ A test runs one idle pass of fleetd and one of the board in a sandbox repository, counts the processes each starts, and fails when a count grows. It counts at runtime, unlike the *One place reaches a process* ratchet, which counts call sites. The count covers the whole process tree, desk-side processes included: the worker wrapper, the WorkerMonitor and `plot-agent-monitor.sh` loops (their `sleep` calls were the largest single item on 2026-11-05).
- ⏸️ A second case: a sandbox with N idle desks, to show the per-desk share.
- ⏸️ Record the baseline on `main` in this story.

### Phase 2: The board is a pure reader ⏸️

- ⏸️ While a fleetd heartbeat is live, the board reads fleetd's snapshot and starts nothing.
- ⏸️ With no browser tab connected, the board starts nothing at all. On the first connection it reads once and serves.
- ⏸️ With no fleetd, the board keeps its own reader, at the cost Phase 1 measures.

### Phase 3: The largest sources ⏸️

- ⏸️ Fixed answers read once per process lifetime.
- ⏸️ Refs, worktree `HEAD`s and worker records read from files.
- ⏸️ The per-desk `plot-worker-state.sh` probes become domain functions over the snapshot.
- ⏸️ One `git cat-file --batch` per repository.
- ⏸️ The GitHub read as one in-process GraphQL request.

Order inside the phase follows the Phase 1 measurement: largest share first.

### Phase 4: Worker liveness without a process ⏸️

**The problem.** fleetd must know when a worker dies, to restart its slice, release its claim or reap its desk. fleetd is not the worker's parent: `plot-dispatch.sh` (about line 1507) starts each worker under a detached `nohup sh -c` wrapper, so no exit event reaches fleetd. Today fleetd and the desk-side monitors poll for it. `plot-worker-state.sh:345-357` and `process-probe-system.ts:39` read the pid's start time with `ps -o lstart` to tell a live worker from a reused pid, and each desk runs a `plot-agent-monitor.sh` loop that wakes with `sleep`. On 2026-11-05 those `sleep` calls were the largest single item in the process census (315 in 20 s), and the `bash -c . plot-worker-state.sh` probes were the largest item among fleetd's own children (about 60 in 30 s). `kill(pid, 0)` answers from inside fleetd with no process, but it cannot tell a reused pid from the worker. macOS has no `/proc`, and Node has no API for a process's start time, so the start-time check needs a process or a native addon.

- ⏸️ A plan of its own sets a contract between the worker wrapper and fleetd: a liveness signal fleetd can test with no process, for example a Unix socket the wrapper listens on or a lock it holds for its lifetime. A refused connection or a free lock means the worker is gone, with no pid reuse to rule out.
- ⏸️ The per-desk `plot-agent-monitor.sh` loops end; what they watch moves into fleetd's triggers.
- ⏸️ Until this plan lands, one batched `ps -ax` per safety-net pass is allowed and the gate counts it.

### Phase 5: The other connectors in-process ⏸️

**The problem.** Plot also reads Bitbucket (`bb`), Jenkins (`jen`) and a separately configured issue tracker such as Jira (`issue-refresh.ts`). Each poll of those starts a CLI process today, so a repository on those hosts breaks "no process unless something changed" even after the GitHub read moves in-process.

- ⏸️ One plan per connector moves its reads into the connector adapter over Node's HTTPS client, with the token read once at start. Each connector keeps its own budget and rate-limit bookkeeping (*The Layering Rule*: a connector owns its limit). Order: by use in the operator's repositories; Bitbucket and Jira first for ewz-kus-portal.

### Phase 6: Triggers replace the tick ⏸️

- ⏸️ fleetd waits on the triggers in *Target Shape* and re-reads only what a trigger names.
- ⏸️ A periodic full read stays as a safety net, with a long interval, and the gate counts it.

## Measures

| Measure | Baseline 2026-11-05 | Target |
|---|---|---|
| New processes per second, plot board + fleetd, idle repository | about 90 | 0 between changes |
| Board processes with no tab connected | about 2.5/s | 0 |
| Processes per change (one desk commit) | not measured | measured in Phase 1, then held by the gate |

## Open Points

- ⏸️ Which process holds the file watches for many repositories on one machine: one fleetd per repository, or `plot-registryd` for all? One watcher per machine costs fewer processes; one per repository keeps repositories independent.
- ⏸️ The safety-net interval for the full read in Phase 4.
- ⏸️ Whether the board's own reader (no fleetd) also becomes change-driven, or stays periodic and gated.
- ⏸️ How the Phase 1 test counts processes portably on macOS and Linux CI.

## Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-11-05 | The story's rule is "no process unless something changed" | A fixed budget invites spending it. The board does no work, so its fair cost at rest is zero. — jwloka |
| 2026-11-05 | Route B (change-driven observer), delivered in route A's order (gate first) | Only B meets the rule literally. A's order makes each step show its number and keeps each plan small. — jwloka |
| 2026-11-05 | "Nothing runs" means no new process; in-process timers, file reads, syscalls and HTTPS requests are allowed | The cost measured on 2026-11-05 is per new process (`syspolicyd`, process start). A timer costs neither. — master session's call from the builder check |
| 2026-11-05 | The snapshot lives in fleetd's memory and travels over the existing channel; it is not persisted | A persisted snapshot of refs and worktrees is a cache git can reach for free, which *Answers, never verdicts* refuses. — master session's call |
| 2026-11-05 | Re-ask-before-action rules stay | An action is a trigger, and those re-asks protect merges and deletions. — master session's call |
| 2026-11-05 | A deadline passing is a trigger, through an in-process timer | Stale claims, idle slices, worker bounds and `Checks wait` are rules over elapsed time; a timer starts no process. — master session's call |
| 2026-11-05 | A connected tab is an SSE client on `/api/events`; a plain HTTP request gets one cold read | Polling scripts would otherwise keep the board watched forever. — master session's call |
| 2026-11-05 | The host poll stays unconditional GraphQL, in-process | GraphQL has no ETag, and the REST alternative costs several requests per pass. The goal is zero processes. — master session's call |
| 2026-11-05 | The story ends in several plans; Bitbucket, Jenkins and the issue tracker move in-process too, one plan per connector | The rule holds for every repository, not only GitHub ones. — jwloka |
| 2026-11-05 | Worker liveness gets its own phase and plan | It needs a new contract between the worker wrapper and fleetd, and it removes the largest measured item. — jwloka |
| 2026-11-05 | The gate counts desk-side processes too | The largest single item measured (`sleep` from monitor loops) runs under the desk, not under fleetd. — master session's call |

## Key Findings

### 2026-11-05 — The Developer Tools exemption does not stop the per-process check

**Expected:** adding cmux and each fleetd's `node` binary to System Settings → Privacy & Security → Developer Tools stops `syspolicyd` checking the fleet's processes.

**Discovered:** after both exemptions and fleetd restarts, `syspolicyd` still logged about 3,400 "violates validation category policy" entries per 15 seconds, one per new process, and `sudo killall syspolicyd` brought it back to 80 % within two minutes. The count fell only when boards and fleetds stopped.

**Impact:** no machine setting removes the cost. Only fewer processes do.

## Excluded from Scope

| Item | Reason | Revisit If |
|------|--------|------------|
| A git library inside Node (`isomorphic-git`, libgit2 bindings) | Under the change-driven observer, git runs only on a change and through one batch process, so a library saves little. A pure-JS status is slow on this repository, it re-implements worktree and ignore semantics, and native bindings break across the pinned Node major. | The Phase 1 gate shows git calls still dominate after Phase 4. |
| Machine settings (Gatekeeper exemptions, `syspolicyd` restarts) | Measured to have no lasting effect; see Key Findings. | — |

## Session Log

### 2026-11-05 — The machine at load 17

The operator reported the machine dying. Load was 13–17 on 16 cores; `syspolicyd` ran at about 80 % CPU. Exempting cmux and the three fleetds' `node` binaries, and restarting `syspolicyd`, changed nothing lasting. Stopping the quatico-business-tools and quaweb-website boards and fleetds and the agent-skills fleetd brought load to about 7. A process census then measured about 90 new processes per second from the plot board and fleetd alone.

**Key outcomes:**

- jwloka set the rule: no process unless something changed; a board with no tab starts zero.
- jwloka chose the change-driven observer, delivered gate first.
- The restart of the agent-skills fleetd (plugin 2.29.0) overwrote the plot repository's launchd job; the bug is fixed after 2.29.0. An old plugin in one repository can still stop another repository's fleet.
