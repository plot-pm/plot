---
title: Nothing changed, nothing runs
author: jwloka
issue: https://github.com/plot-pm/plot/issues/3170
status: ready
created: 2026-11-05
updated: 2026-11-05
---

# Nothing changed, nothing runs

Panel rounds: 1

## Objective

The board and the fleet start no process unless something changed. A board that no visible browser tab shows starts zero processes. fleetd starts a process only in answer to a change: a file under `.git` or a desk, a worker that ends, a host answer that differs from the last one, or a deadline that passes. Every rule reads one snapshot of answers, and only fleetd writes it.

## Why Now

On 2026-11-05 the operator's 16-core machine ran at load 13–17 for hours. `syspolicyd` used about 80 % CPU and `trustd` about 20 %, because macOS checks every new process, and the Plot processes started them at about 225 per second across three repos (3 boards, 3 fleetds). Stopping two repos' boards and fleetds brought load to about 7.

With only the plot repo's board and fleetd running, a 20-second sample counted about 1,800 new processes, about 90 per second. This count covers the whole process tree, desk-side monitors included. Of those, about 900 were `bash`, 315 `sleep`, about 200 `git`, about 200 text tools (`grep`, `cut`, `gsed`, `tr`, `awk`) and about 46 `node`. The sample names no instrument and records no desk or PR count, so Phase 1 measures a reproducible baseline and does not try to match this figure.

A 30-second sample of the two processes' direct children:

| Process | Direct children in 30 s | Largest items |
|---|---|---|
| board (nobody looking) | about 75 | 40 `git`, 8× `git rev-parse --show-toplevel`, 4× `plot-fleetctl.sh --status`, `plot-host.sh backend`, ref listings, per-desk worker-state probes |
| fleetd | about 160 | about 60 `bash -c . plot-worker-state.sh …` probes (one per desk per pass), 44 `git`, `plot-host.sh pr-list` per state |

The board does no work. It helps a person orient, so it has no reason to cost the machine anything while nobody looks at it.

## Decisions Taken in Scoping

- **A board that no visible browser tab shows starts zero processes.** It may take a second or two to catch up when a tab opens. — jwloka, 2026-11-05
- **The rule is "no process unless something changed", not a fixed budget per minute.** This holds for the fleet while agents work too. — jwloka, 2026-11-05
- **The target architecture is a change-driven observer (route B), delivered in the order of route A:** first the process-count gate and a baseline, then the cheap wins, then the snapshot and its channel, then the board as a pure reader, then the largest sources one by one, then change-driven triggers in place of the tick. — jwloka, 2026-11-05
- **Aggregate and replace scripts so fewer processes obtain the same information.** Ask once and share the answer; never re-ask an answer that is fixed for the process lifetime; read files instead of starting git where git keeps the answer in a file; batch what still needs git; talk to the host in-process. — jwloka, 2026-11-05
- **A git library inside Node (route C) is excluded.** See Excluded from Scope. — jwloka, 2026-11-05

## Target Shape

**"Nothing runs" means no new program image.** The counted event is `execve`, because `syspolicyd` checks each new image. An in-process timer, a file read, a syscall and an HTTPS request from inside a long-lived process are allowed. A new image (`git`, `bash`, `ps`, `gh`, `node`, `sleep`) is allowed only in answer to a trigger. A bash subshell that forks without `exec` is not counted; Phase 1 may record forks as a secondary figure.

**One observer, one snapshot.** fleetd observes and holds one snapshot per repository in memory: refs, worktrees and desks, desk files, worker records, plan content, the agent registry, PR rows, issue rows, the default-branch reading and the config. The snapshot holds answers, not verdicts. fleetd publishes it over the channel, and every reader, fleetd's own rules and the board alike, derives its verdicts from those answers with the same domain rules. The board subscribes and asks the world nothing while a fleetd runs.

**Placement under *The Layering Rule*.**

- The snapshot is a domain entity of readings, in the "readings as values" shape (`reap(readings, input)`). fleetd's composition root holds the instance.
- A file watch reaches the world through a new port the domain owns, and a watcher adapter implements it. `packages/*/src` holds no `fs.watch` today, so this is a new adapter kind.
- The table "which change makes which reading stale" is a pure domain rule. It never lives in `packages/fleet/src/shared/`, which would repeat `registry.ts`: a decision and a spawn site outside the domain.
- Per-desk liveness and cleanliness reach the world only through the `Processes` port. That includes the board's path through `registry.ts` (`bashLiveness`, `bashCleanliness`, `execFile` at `registry.ts:510`).

**Persisted files keep their roles.** The snapshot is not persisted. The index files `index/github.json` and `index/issues.json` hold bought answers. `default-branch.json` is the one verdict file `CLAUDE.md` licenses. `last-pulse.json` is the fleet bridge: it holds a `FleetReading` pulse with eligibility and wave verdicts, made safe by an age bound (`BRIDGE_MAX_AGE_MS = 15 min`, `fleet-state-file.ts:17`). It is a bridged verdict, not an index file.

**Re-ask before acting.** Every rule that asks the host again immediately before an action (`plot-ask.mjs merge` pinned to a head, `reviewPr`, destructive decisions on `mergedAt`) keeps doing so. Every destructive local action re-reads its local evidence immediately before it acts and never acts on the snapshot alone:

- a worktree removal (`git worktree remove --force`, `trees-git.ts:539`) re-reads that desk's `git status` and its `PLOT-BLOCKED` marker;
- a signal to a recorded pid re-reads the pid's identity, as `desk-monitors-shell.ts:93` does today with the pid's command;
- a ref deletion and a claim release re-read the ref they delete.

An action is itself a trigger, so its re-read is an action-time process and the idle count does not include it. The CLI controllers (`plot-ask.mjs`, `plot-dispatch-command.mjs`, `plot-continue-command.mjs`) run on demand and are out of the idle count.

**A shown tab is a visible SSE client.** The board counts clients on `GET /api/events` (`EventHub.clients()`, `channel-events.ts:39`). The page shares one `EventSource` across a browser's tabs (`event-listener.ts:31-66`) and today keeps it while a tab is hidden. The page closes its stream when the Page Visibility API reports hidden and reopens it when visible, and its 30 s `/api/board` and 4 s `/api/fleet` polls (`App.tsx:48-49`) stop while hidden. With zero clients and no fleetd, the board holds no timer that starts processes. A plain HTTP request (`/api/board`, `/api/fleet`, `plot-boardctl.sh --status`) gets one fresh read when the board's view is cold, and does not keep the board watched.

**Triggers, not a tick.** fleetd re-reads only what a trigger names:

| Trigger | Source | What it re-reads |
|---|---|---|
| A ref or `packed-refs` changes | directory watches on the common git dir's `refs/` (recursive) and on the directory that holds `packed-refs`, re-armed on `rename` | the changed refs, then the rules that read them |
| A desk's git state changes | a directory watch on `.git/worktrees/<desk>/` (`HEAD`, `index`) | that desk's status, through one `git --no-optional-locks status` |
| A desk's own files change | a non-recursive directory watch on the desk root: `PLOT-BLOCKED`, `PLOT-CORRECTION.md`, `.plot-worker.*` records (`.plot-worker.exit` is the wrapper's exit record) | that desk's worker record and findings |
| A worker's log grows | file events on the desk's `.plot-worker.log` | the working/idle activity reading |
| A worker ends without a record | the liveness token (Phase 6) | that desk's worker record |
| The host answers something new | an in-process host read whose answer differs, over every field a rule reads, from the last one | the changed PR rows, including a PR whose CI turned green or whose `plotReview` moved |
| A remote change | a host answer that names a new default-branch head, a merged PR or a new or deleted branch | one `git fetch --prune` |
| A deadline passes | an in-process timer set to the next recorded bound (`Claim stale after`, `Slice idle after`, `Worker bound`, `Checks wait`, the fixer bound, the default-branch re-ask, the issue read) | the rule that owns the deadline |
| Plan, sprint or story content changes | directory watches on the plan, sprint and story directories | the plan store readings |
| The agent registry changes | a directory watch on the `Agent registry` path | the registry readings |
| The config file changes | file events on `CLAUDE.md` (through its directory) | the config |
| The safety net | an in-process timer, every 10 minutes | a full read of every source, one `git fetch`, a desk `git status` per desk |

**Remote freshness.** fleetd runs `git fetch` only when the in-process host read reports a change, and on each safety-net pass. A claim pushed from another machine has no PR and no host answer, so it appears within one safety-net interval, 10 minutes. The remote still refuses a second claim push (`refs-remote-git.ts:79`), so a late view of a claim costs staleness, not a double claim.

**Worker liveness.** fleetd is not the parent of a dispatched worker: `plot-dispatch.sh:1507` starts each one under a detached `exec nohup sh -c` wrapper. The wrapper already `wait`s on the agent, writes `.plot-worker.exit` and appends a `gone` or `clear` line into the desk (`plot-dispatch.sh:1455-1470`), so a directory watch on the desk root sees a normal end. The gap is narrower: a wrapper killed by `SIGKILL`, OOM or a reboot writes nothing, and the agent `( $cmd ) &` can outlive it. The start-time check that tells a live worker from a reused pid reads `ps -o lstart` today (`plot-worker-state.sh:345-357`, `process-probe-system.ts:39`). Node has no API for a process's start time and macOS has no `/proc`, so `kill(pid, 0)` alone is not enough, and the start-time check stays until Phase 6 replaces it. Phase 6 moves the wrapper to a node bundle and gives it a liveness token the agent's process group inherits.

**Answers with no process.**

- Fixed for the process lifetime: `rev-parse --show-toplevel`, `--git-common-dir`, the host backend. Read once at start.
- Kept in plain files by git: loose refs, `packed-refs`, each worktree's `HEAD` under `.git/worktrees/*/HEAD`. Read the files, with a corpus test against git (see Phase 5). A repository with `extensions.refStorage=reftable` keeps no loose refs; the file reader detects it and falls back to git.
- Kept in plain files by Plot: `.plot-worker.*` records, `.plot/state/*`, desk markers. Read the files.
- Process liveness: `kill(pid, 0)` answers "no such pid" with no process. A "yes" still needs the start-time check until Phase 6.

**Batched where git is still needed.** One long-lived `git cat-file --batch` (and `--batch-check`) per repository answers every object read. `git worktree list --porcelain` answers for all desks in one call. `git --no-optional-locks status` runs for a desk only when its files changed; the flag stops the read rewriting the index it watches.

**Self-caused events.** fleetd's own `git status` and `git fetch` write files that fleetd watches. fleetd tells a self-caused event from a foreign one by content: a ref event whose SHA equals the snapshot's, or an index event whose checksum equals the last read, changes nothing. fleetd never ignores events for a time window, because a real change in that window would go missing.

**The host in-process.** fleetd reads the host over Node's HTTPS client inside the `host` connector adapter, instead of one `gh` process per question. The reads are those fleetd makes today: open PRs with checks and review statuses, the merged delta (`pr-list --state merged --since`), the `--state all --since` delta for `scanOnce`, the issue read and the default-branch re-ask. The in-process read keeps the partial-answer contracts: the `.list-complete` whole-page claim, and the refusal to fold when a carried OPEN row is absent. GraphQL has no conditional answers, so the read stays unconditional at today's cadence; the goal is zero processes, not zero requests. The connector refreshes its token when it expires: a GitHub App installation token lasts 1 hour. Shell consumers and the merge path keep `plot-host.sh`, so both transports charge one rate budget through the `Budget` port (`adapters/budget/budget-file.ts`, the same ledger `plot-host.sh` writes at `budget.tsv`).

**The per-desk shell probes become domain functions.** The `bash -c . plot-worker-state.sh && plot_worker_state …` calls (`processes-shell.ts:160-173`) and the `plot-agent-monitor.sh` polling loops are the paused Phase 4 of [`the-shell-holds-no-behavior`](../the-shell-holds-no-behavior/STORY-the-shell-holds-no-behavior.md) ("The readings move"). This story gives that phase a measured reason and an order: per-pass readings first.

**Failure modes and their answers.**

| Failure | Answer |
|---|---|
| A file watch follows the old inode after git renames a lock file over the target | Watch directories only, never files; re-arm on `rename`. A test commits twice and asserts the second commit triggers too. |
| Dropped or coalesced events (FSEvents `MustScanSubDirs`, inotify `IN_Q_OVERFLOW`); Node's `fs.watch` reports neither | The 10-minute safety net is mandatory. It logs a line when it finds a difference the triggers missed, so drift is visible. |
| Watch limits (Linux `max_user_watches`, a launchd job's low `ulimit -n` on macOS) | Watch `refs/`, `worktrees/*/` and the desk roots, never `.git/` recursively (`objects/` alone holds 256 directories). A watch that fails to arm marks the observer degraded. |
| Sleep and wake; wall-clock jumps | Timers measure elapsed time on the monotonic clock, which stops while macOS sleeps. Deadlines stay recorded in wall time. fleetd compares the two clocks on an in-process interval; on a wake or a jump it re-checks every deadline against the wall clock and runs one full read. A test injects the clock. |
| A reftable repository | The ref file reader detects `extensions.refStorage=reftable` and falls back to git. |
| fleetd restarts and missed events | Startup runs one full read, which re-derives every desk's finding. |
| The watcher wedges while the host read keeps the heartbeat fresh | The heartbeat carries observer fields (watches armed, last event handled, last safety-net pass). A reader trusts the snapshot only while those fields are fresh. |
| fleetd is dead and no tab is open | Nothing observes until launchd or systemd restarts fleetd (`KeepAlive`, `plot-fleetctl.sh:679`). Desk findings such as `stalled` and `waiting` are not produced in that time (see Open Points). |
| No fleetd and no tab | The board leaves everything stale. No process writes `index/github.json` or `default-branch.json`, so every board-free merge refuses as `default-branch-stale` until a tab opens or a fleetd starts. The index never says `pr: 'none'`, so this fails closed. Nobody loosens the staleness check to "fix" it. |

## Current Plan

### Phase 1: The gate and the baseline ⏸️

- ⏸️ The gate counts `execve` events per named scenario on a recorded fixture. A scenario states its fixture size beside its number: desks, open PRs, host. Scenarios: an idle board with no tab; an idle board with one visible tab; an idle fleetd per completed pass; fleetd with N idle desks; one desk commit; one PR whose CI turns green.
- ⏸️ The gate runs on Linux CI under `strace -f -e trace=execve,execveat`, which follows every descendant, including the detached `nohup sh -c` wrapper. A step checks that `strace` is present on the runner. Linux `execve` is a proxy for the macOS cost (`syspolicyd`), and a person still has to accept that proxy (see Open Points). The operator's macOS figure comes from a documented manual measurement.
- ⏸️ fleetd is measured per completed pass of all four loops (tick, scan, PR reader, issue reader, `registryd-main.ts:3221-3224`), delimited by fleetd's own log line, with the idle reader running. `--once` builds no idle reader (`registryd-main.ts:2804-2811`), so it is not the measured mode. Where a loop takes an injected clock (`startPulse(clockSystem(), …)`), the test drives the pass through it rather than a wall-clock window.
- ⏸️ The gate compares each count against the merge base, as `check-shell-lines.sh` does, and stores no number. A non-zero count may carry a stated tolerance; a count that is structurally 0 has none.
- ⏸️ Every zero target in Measures is written as an expected failure (`it.fails`). Each later plan names the assertion it turns into a required pass.
- ⏸️ Fixtures: GitHub with a stub `gh` on `PATH`; Bitbucket with a stub `bb` and a stub tracker; N desks with a stub worker that starts nothing (for example a long `read` on a FIFO). After Phase 7, the stubs become an injectable base URL and a local HTTPS server, because a `PATH` stub no longer sees an in-process call.
- ⏸️ Record the baseline on `main` in this story, GitHub and Bitbucket.

### Phase 2: Cheap wins ⏸️

Each item stands alone and turns one Phase 1 assertion green.

- ⏸️ No tab, no pulse. `ensureCache` starts a 5 s pulse (`fleet.ts:3225`) that nothing stops. The board stops it when `clients()` is 0 and no plain request arrived within a bound, and restarts it on the next request or SSE attach. The board then stops heartbeating the reader lock, so a `plot-pr-reader.mjs` it started exits after `HEARTBEAT_STALE_MS` (2 min, `reader-election.ts:137`).
- ⏸️ The page closes its SSE stream and stops its polls while hidden.
- ⏸️ The desk monitors nap without `sleep`. `plot_monitor_wait` runs an external `sleep 1` per second per monitor (`plot-monitor-subject.sh:193-203`). A builtin wait, for example `read -t 1` on a held-open descriptor, starts no process and runs on bash 3.2.
- ⏸️ `processesShell.isAlive` starts `bash -c "kill -0 <pid>"` (`processes-shell.ts:158-159`); `process.kill(pid, 0)` answers with no process, as `process-probe-system.ts` already does.
- ⏸️ Fixed answers read once per process lifetime: `--show-toplevel`, `--git-common-dir`, the host backend.

### Phase 3: The snapshot and the channel ⏸️

- ⏸️ The snapshot entity in `@plot-pm/domain`, the watch port the domain owns, a watcher adapter, and the domain rule that maps a change to the readings it makes stale. In this phase the existing tick fills the snapshot; the watches arm in Phase 8.
- ⏸️ A versioned channel contract. The channel carries findings today (`WelcomeSchema.current`, `channel-message.ts:15-18`), and the board ignores event bodies and refetches `/api/board` (`channel-events.ts:9-13`). New message kinds: a full snapshot on welcome for a late joiner, deltas after it, a generation number so a reader detects a missed delta and resynchronises, and a protocol version. The board does not reload its bundle when `main` moves, so a board and a fleetd from different commits share one socket; on a version mismatch the reader says so and falls back to its own reader.
- ⏸️ fleetd liveness that does not depend on activity. Three checks infer liveness from data age today: `OWNED_BRIDGE_MAX_AGE_MS = 180 s` (`scan-owner.ts:10`), `HEARTBEAT_STALE_MS = 2 min` (written only on a PR beat with a host backend, so a repository with no git host has none), and `BRIDGE_MAX_AGE_MS = 15 min` (the CLI controllers refuse past it). Under write-on-change an idle repository ages out all three. fleetd writes a heartbeat on an in-process timer, under a key that exists with no host backend, carrying the observer fields. `fleetOwnsScan`, the bridge consumers and the board read that heartbeat in place of data age.
- ⏸️ The board stops running `plot-fleetctl.sh --status` on every tick (`fleet.ts:2873`, 0.46–1.42 s per call, it walks every desk). It reads fleetd's heartbeat and the channel's own 10 s heartbeat (`channel-socket.ts:33`) instead.

### Phase 4: The board is a pure reader ⏸️

- ⏸️ While fleetd's heartbeat is fresh, the board reads the snapshot from the channel, derives its verdicts with the domain rules, and starts nothing. The agent registry, the supervisor reading and plan content travel in the snapshot; today the board reads them itself every beat (`fleet.ts:2836-2875`).
- ⏸️ With no fleetd and a visible tab, the board keeps its own reader, at the cost Phase 1 measures. When the last tab leaves, it stops that reader.

### Phase 5: The largest sources ⏸️

Order inside the phase follows the Phase 1 measurement: largest share first.

- ⏸️ Refs, `packed-refs`, worktree `HEAD`s and worker records read from files. Loose-over-packed precedence, peeled tags, symbolic refs and per-worktree refs are git's rules, so the file reader is a declared duplicate with a corpus test against git, and it falls back to git on reftable.
- ⏸️ One `git cat-file --batch` per repository.
- ⏸️ The per-desk `plot-worker-state.sh` probes become domain functions over the snapshot, through the `Processes` port, the board's `registry.ts` path included. Each replaced function gets a corpus test against `plot_worker_state`. `plot_worker_activity` runs `sleep 0.4` per running desk per probe (`plot-worker-state.sh:1101-1110`) under fleetd; the activity reading moves to file events on `.plot-worker.log`.
- ⏸️ The GitHub reads in-process: open PRs, the merged and `--since` deltas, the issue read and the default-branch re-ask. "Differs" covers every field a rule reads. A new gate holds the second transport: an HTTPS request to a host only from `packages/domain/src/adapters/host/`, because `check-host-cli-callers.sh` greps only `*.sh` for `gh`/`bb`. Reads and writes share the `Budget` port. Each rule copied out of `plot-host.sh` (6,050 lines) is a declared duplicate with a corpus test. The connector refreshes its token on expiry.
- ⏸️ Until Phase 6, the AgentMonitor still calls `plot-host.sh pr-state <branch>` per desk every 300 s (`plot-agent-monitor.sh:257-264`); the gate counts it.

### Phase 6: Worker liveness without a process ⏸️

**The problem.** fleetd must know when a worker dies, to restart its slice, release its claim or reap its desk. The wrapper writes an exit record on a normal end, but a wrapper killed by `SIGKILL`, OOM or a reboot writes nothing, and its agent can outlive it. Today the start-time check reads `ps -o lstart`, and the same pid-start question decides the reader election (`rules/reader-election.ts`, through `process-probe-system.ts`), the implement lock (`rules/implement-lock.ts`) and the continue lock (`rules/continue-lock.ts`). On 2026-11-05 the monitors' `sleep` calls were the largest single item in the census (315 in 20 s); Phase 2 removes that share.

- ⏸️ First step: the worker wrapper moves from the inline `nohup sh -c` string to a node bundle started through `adapters/detached/detached-node.ts`. macOS `sh` has no `flock` and cannot listen on a socket, and adding the contract to `plot-dispatch.sh` would grow the shell that `check-shell-lines.sh` ratchets.
- ⏸️ The liveness token is a descriptor the agent's process group inherits, for example the write end of a named FIFO. fleetd opens the read end with `O_NONBLOCK`; end-of-file means no holder is left. A socket or lock held by the wrapper alone would read "gone" while the agent lives, and a restart would then put two writers on one branch. The plan tests pid reuse and a killed wrapper with a live agent.
- ⏸️ The reader election, the implement lock and the continue lock use the same kind of token, or the plan names each one it leaves on `ps` and why.
- ⏸️ The per-desk `plot-agent-monitor.sh` loops end; what they watch moves into fleetd's triggers. Their final pass after an agent exits (`plot-agent-monitor.sh:552-569`) moves to fleetd's startup full read and desk-root watch.

### Phase 7: The other connectors in-process ⏸️

**The problem.** Plot also reads Bitbucket (`bb`), Jenkins (`jen`) and a separately configured issue tracker such as Jira (`issue-refresh.ts`). Each read starts a CLI process today, and `readBitbucketListing`'s refused-delta retry starts one `pr-list --branch` per tracked branch.

- ⏸️ One plan per connector moves its reads into the connector adapter over Node's HTTPS client. Each connector keeps its own budget and rate-limit bookkeeping and refreshes its own credentials on expiry. Order: by use in the operator's repositories; Bitbucket and Jira first for ewz-kus-portal. The Bitbucket baseline from Phase 1 is the number each plan moves.

### Phase 8: Triggers replace the tick ⏸️

- ⏸️ The watches arm, and fleetd waits on the triggers in *Target Shape* and re-reads only what a trigger names. The `git fetch --prune` on every 5 s scan (`fleet-scan.ts:32`, `:713`) ends; a fetch runs only on a host change or a safety-net pass.
- ⏸️ fleetd's own `git` probes for the fleet-size decision (5 `git rev-parse --git-dir` samples per measurement, `machine-system.ts:9`, `registryd-main.ts:633`) run on a dispatch decision only.
- ⏸️ Deadline timers re-check against the wall clock on wake and on a clock jump.
- ⏸️ The 10-minute safety net runs a full read and logs every difference the triggers missed.

## Measures

Each row has one unit. A baseline names its fixture.

| Measure | Unit | Baseline | Target |
|---|---|---|---|
| Whole tree, plot board + fleetd + desks, idle | new processes per second | about 90 (2026-11-05 census; fixture not recorded) | 0 between changes |
| Board, no tab, no fleetd | `execve` per minute | Phase 1 fixture | 0 |
| Board, one visible tab, fleetd running | `execve` per minute | Phase 1 fixture | 0 |
| fleetd, idle repository | `execve` per completed pass, N desks, M open PRs | Phase 1 fixture (GitHub and Bitbucket) | 0, except the safety-net pass |
| fleetd, safety-net pass | `execve` per pass | Phase 1 fixture | measured, then held by the gate |
| One desk commit | `execve` per change | Phase 1 fixture | measured, then held by the gate |

## Open Points

- ✅ Gate proxy, gate tolerance, desk findings with no fleetd, and connector credentials: decided by jwloka on 2026-11-05. See Decisions.

## Decisions

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-11-05 | The story's rule is "no process unless something changed" | A fixed budget invites spending it. The board does no work, so its fair cost at rest is zero. — jwloka |
| 2026-11-05 | Route B (change-driven observer), delivered in route A's order (gate first) | Only B meets the rule literally. A's order makes each step show its number and keeps each plan small. — jwloka |
| 2026-11-05 | "Nothing runs" means no new process; in-process timers, file reads, syscalls and HTTPS requests are allowed | The cost measured on 2026-11-05 is per new process (`syspolicyd`, process start). A timer costs neither. — master session's call from the builder check |
| 2026-11-05 | The snapshot lives in fleetd's memory and travels over the channel; it is not persisted | *Answers, never verdicts* refuses a persisted verdict. A persisted snapshot of refs is not forbidden, but git answers refs for free, so persisting them buys nothing. — master session's call, rationale corrected after the panel |
| 2026-11-05 | Re-ask-before-action rules stay | An action is a trigger, and those re-asks protect merges and deletions. — master session's call |
| 2026-11-05 | A deadline passing is a trigger, through an in-process timer | Stale claims, idle slices, worker bounds and `Checks wait` are rules over elapsed time; a timer starts no process. — master session's call |
| 2026-11-05 | A connected tab is an SSE client on `/api/events`; a plain HTTP request gets one cold read | Polling scripts would otherwise keep the board watched forever. — master session's call |
| 2026-11-05 | The host read stays unconditional GraphQL, in-process | GraphQL has no ETag, and the REST alternative costs several requests per pass. The goal is zero processes. — master session's call |
| 2026-11-05 | The story ends in several plans; Bitbucket, Jenkins and the issue tracker move in-process too, one plan per connector | The rule holds for every repository, not only GitHub ones. — jwloka |
| 2026-11-05 | Worker liveness gets its own phase and plans | It needs a new contract between the worker wrapper and fleetd. — jwloka |
| 2026-11-05 | The gate counts desk-side processes too | The largest single item measured (`sleep` from the monitor naps) runs under the desk; `plot_worker_activity`'s `sleep 0.4` runs under fleetd. — master session's call, attribution corrected after the panel |
| 2026-11-05 | A hidden or background tab does not count as shown: the page closes its SSE stream when hidden and reopens it when visible | The rule says "shows". A forgotten tab would otherwise keep the board watched all night. — jwloka |
| 2026-11-05 | fleetd runs `git fetch` only when the in-process host read reports a change; a safety-net full read runs every 10 minutes and bounds how late a claim pushed from another machine appears | A local watch cannot see a remote change, and a fetch every 5 s is several processes. The remote still refuses a second claim. — jwloka |
| 2026-11-05 | With no fleetd and no tab, the board may leave everything stale (no fresh readings; board-free merges refuse as stale) until a tab opens; it catches up then | The consumers fail closed: the index never says `pr: 'none'`, and `plot-ask.mjs merge` refuses `default-branch-stale`. — jwloka |
| 2026-11-05 | The worker wrapper moves from `sh` to a node bundle first, as the first step of the worker-liveness phase | macOS `sh` has no `flock` and cannot listen on a socket. — jwloka |
| 2026-11-05 | The channel carries answers (readings); each reader derives its verdicts | *Every rendered state is a domain property*: one set of rules derives verdicts in fleetd and on the board alike, and no verdict is shipped as a cache. — jwloka |
| 2026-11-05 | Connectors refresh tokens on expiry; "token read once at start" goes | GitHub App installation tokens last 1 hour, and a user token changes on re-login. — master session's call, accepted by jwloka |
| 2026-11-05 | The working/idle activity reading comes from file events on the worker log | CPU time has no change event; the log grows while an agent works. — master session's call, accepted by jwloka |
| 2026-11-05 | One fleetd per repository stays | `plot-registryd` is the old name of the per-repository fleetd (`packages/fleet/build.mjs` builds `plot-fleetd.mjs` from `registryd-main.ts`), not a machine-wide process. One fleetd per repository keeps repositories independent. — master session's call, accepted by jwloka |
| 2026-11-05 | Reconciled juror disagreements (see `panel.md`): the board reads the channel, not the persisted bridge; the liveness token is inherited by the agent's process group; deadlines are recorded in wall time and re-checked on wake | Each pick and its reason is in the panel record. — panel, round 1 |
| 2026-11-05 | The Phase 1 gate counts `execve` on Linux CI as the proxy for the macOS `syspolicyd` cost; the macOS figure stays a manual measurement | Exact counting on macOS needs root. — jwloka |
| 2026-11-05 | The gate allows a tolerance on non-zero counts and holds structural zeros strictly | A loaded runner makes non-zero counts jitter; a zero has no jitter. — jwloka |
| 2026-11-05 | While fleetd is stopped, desk findings (`stalled`, `waiting`) may go unproduced until it restarts | No fleet means nothing acts on them; a desk keeps no process-free self-report. — jwloka |
| 2026-11-05 | A long-lived fleetd may hold Bitbucket, Jira and Jenkins credentials in-process and refreshes each on expiry | One CLI call per refresh would bring back a process per poll. — jwloka |

## Key Findings

### 2026-11-05 — The Developer Tools exemption does not stop the per-process check

**Expected:** adding cmux and each fleetd's `node` binary to System Settings → Privacy & Security → Developer Tools stops `syspolicyd` checking the fleet's processes.

**Discovered:** after both exemptions and fleetd restarts, `syspolicyd` still logged about 3,400 "violates validation category policy" entries per 15 seconds, one per new process, and `sudo killall syspolicyd` brought it back to 80 % within two minutes. The count fell only when boards and fleetds stopped.

**Impact:** no machine setting removes the cost. Only fewer processes do.

### 2026-11-05 — Four jurors amend the story

**Expected:** the story names every source of new processes and a safe target shape.

**Discovered:** four jurors (layering, safety, testability, seams) each returned `amend`. The story missed sources (`git fetch --prune` every 5 s, desk marker files, the board's `plot-fleetctl.sh --status` per tick, `sleep 0.4` under fleetd), put the board's reader before the snapshot existed, and named no answer for renamed files, dropped events, sleep or self-triggering. Two claims were false: the wrapper already writes an exit record, and the WorkerMonitor process was already removed.

**Impact:** the phases now run gate, cheap wins, snapshot and channel, board reader, sources, liveness, connectors, triggers. See [`panel.md`](panel.md).

## Candidate Plans

| Candidate plan | Phase | What it changes | Slices | Size | Risk | Depends on |
|---|---|---|---|---|---|---|
| process-census-gate | 1 | `execve` count per scenario under `strace -f` on Linux CI, fixtures with stub `gh`, `bb`, tracker and worker, zero targets as expected failures | 3–4 | L | medium: counts jitter with retries and back-off on a loaded runner | — |
| no-tab-no-pulse | 2 | The board stops its pulse and reader with zero visible clients; the page closes SSE and stops polls while hidden | 2 | M | medium: a fleet-less board stops writing the indexes, so board-free merges refuse until a tab opens | process-census-gate |
| monitors-nap-without-sleep | 2 | Builtin wait in `plot_monitor_wait`; `isAlive` through `process.kill` | 1 | S | low: bash 3.2 `read -t` takes whole seconds only | process-census-gate |
| fixed-answers-once | 2 | `--show-toplevel`, `--git-common-dir` and the host backend read once per process | 1–2 | S | low: a cached answer outlives a moved repository | process-census-gate |
| the-snapshot-entity | 3 | Snapshot entity, watch port, watcher adapter and change-to-stale rule in `@plot-pm/domain`, filled by the existing tick | 2–3 | L | medium: a missing reading in the snapshot shows as a silent wrong row | process-census-gate |
| the-channel-carries-readings | 3 | Versioned channel messages: snapshot on welcome, deltas, generation, resync | 2 | M | high: board and fleetd from different commits share one socket | the-snapshot-entity |
| fleetd-heartbeat-not-data-age | 3 | Timer heartbeat with observer fields replaces the 180 s, 2 min and 15 min age checks and the board's `plot-fleetctl.sh --status` | 2–3 | M | high: a misread heartbeat lets the board and fleetd both scan, or makes the CLI controllers refuse | the-snapshot-entity |
| board-reads-the-channel | 4 | The board serves from the snapshot, derives verdicts in the domain, spawns nothing while fleetd lives | 3 | L | high: render parity across 8,151 lines of `fleet.ts` | the-channel-carries-readings, fleetd-heartbeat-not-data-age |
| refs-from-files | 5 | Refs, `packed-refs`, worktree `HEAD`s and worker records read from files, reftable fallback, corpus test against git | 2 | M | medium: a second implementation of git's ref rules drifts | the-snapshot-entity |
| one-cat-file-batch | 5 | One long-lived `git cat-file --batch` per repository | 1–2 | M | medium: a wedged batch process blocks every object read | the-snapshot-entity |
| desk-probes-in-domain | 5 | `plot_worker_state` (1,506-line script) becomes domain functions through the `Processes` port, `registry.ts` included; activity from worker-log events | 3–5 | XL | high: worker-state semantics drift; overlaps `the-shell-holds-no-behavior` Phase 4 | the-snapshot-entity |
| github-reads-in-process | 5 | HTTPS GitHub adapter for open, merged and `--since` reads, issue read and default-branch re-ask; host-API gate; shared budget; corpus tests; token refresh | 4–5 | XL | high: partial-answer semantics (`.list-complete`, absent OPEN row) lost silently | the-snapshot-entity |
| node-worker-wrapper | 6 | The `nohup sh -c` wrapper at `plot-dispatch.sh:1507` becomes a node bundle through `detached-node.ts` | 2 | M | high: every dispatch runs through it, and exit records must keep their shape | process-census-gate |
| liveness-token | 6 | An inherited FIFO token replaces `ps -o lstart` for workers, reader election, implement and continue locks; the AgentMonitor loops end | 3–4 | L | high: a false "gone" puts two writers on one branch | node-worker-wrapper |
| bitbucket-reads-in-process | 7 | HTTPS Bitbucket adapter for the listing pair and the branch-sweep retry | 3 | L | high: credentials of another tool; page-length rules | github-reads-in-process |
| tracker-reads-in-process | 7 | HTTPS Jira reads in the tracker connector | 2 | M | medium: separate account and budget | github-reads-in-process |
| jenkins-reads-in-process | 7 | HTTPS Jenkins reads with device-flow bearer refresh | 2 | M | medium: bearer expiry | github-reads-in-process |
| triggers-replace-the-tick | 8 | Watches arm, fetch only on change, deadline timers with wake re-check, 10-minute safety net, self-trigger by content | 4–5 | XL | high: a missed change stays invisible until the safety net | board-reads-the-channel, refs-from-files, desk-probes-in-domain, github-reads-in-process, liveness-token |

Basis: slice counts and sizes come from the files each plan touches on `main` (line counts of `fleet.ts`, `plot-host.sh`, `plot-worker-state.sh`, `plot-dispatch.sh`, `registryd-main.ts`), the callers named in this story, and one test layer per slice; they are estimates to within one size step, not measurements.

## Excluded from Scope

| Item | Reason | Revisit If |
|------|--------|------------|
| A git library inside Node (`isomorphic-git`, libgit2 bindings) | Under the change-driven observer, git runs only on a change and through one batch process, so a library saves little. A pure-JS status is slow on this repository, it re-implements worktree and ignore semantics, and native bindings break across the pinned Node major. | The Phase 1 gate shows git calls still dominate after Phase 6. |
| Machine settings (Gatekeeper exemptions, `syspolicyd` restarts) | Measured to have no lasting effect; see Key Findings. | — |
| A machine-wide watcher process for all repositories | One fleetd per repository stays (Decisions). A machine-wide watcher needs a new launchd/systemd unit and couples repositories' failures. | Watch limits per user block several fleetds on one machine. |

## Session Log

### 2026-11-05 — The machine at load 17

The operator reported the machine dying. Load was 13–17 on 16 cores; `syspolicyd` ran at about 80 % CPU. Exempting cmux and the three fleetds' `node` binaries, and restarting `syspolicyd`, changed nothing lasting. Stopping the quatico-business-tools and quaweb-website boards and fleetds and the agent-skills fleetd brought load to about 7. A process census then measured about 90 new processes per second from the plot board and fleetd alone.

**Key outcomes:**

- jwloka set the rule: no process unless something changed; a board with no tab starts zero.
- jwloka chose the change-driven observer, delivered gate first.
- The restart of the agent-skills fleetd (plugin 2.29.0) overwrote the plot repository's launchd job; the bug is fixed after 2.29.0. An old plugin in one repository can still stop another repository's fleet.

### 2026-11-05 — Panel round 1

Four jurors read the story through the lenses layering, safety, testability and seams. All four returned `amend`. jwloka made six decisions on the open questions, and the story took 36 amendments, each confirmed against `main` before it was written. The panel record is [`panel.md`](panel.md).

**Key outcomes:**

- The phase order now builds the snapshot and its versioned channel before the board reads it, and moves three cheap wins ahead.
- fleetd liveness no longer depends on data age, and the board stops running `plot-fleetctl.sh --status` per tick.
- Destructive local actions re-read their evidence before they act.
- The gate counts `execve` per scenario on Linux CI; the macOS proxy stays an open point.
- A Candidate Plans table estimates 18 plans.
