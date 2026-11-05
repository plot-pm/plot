# Panel record: nothing-changed-nothing-runs

- **Subject:** [`STORY-nothing-changed-nothing-runs.md`](STORY-nothing-changed-nothing-runs.md) at `8c97b79e8`
- **Date:** 2026-11-05
- **Rounds:** 1
- **Reconcile result:** unanimous `amend`

## Lenses and Positions

| Juror | Lens | Position |
|---|---|---|
| layering | layering and ownership under *The Layering Rule* | amend |
| safety | safety and correctness of destructive and liveness decisions | amend |
| testability | testability and measurement of the process-count gate | amend |
| seams | seams between board, fleetd, desks and scripts during the migration | amend |

All four jurors accept the rule and the route. All four ask for named changes before plans are cut.

## Decisions by jwloka

jwloka made these decisions on 2026-11-05 after reading the verdicts:

1. A hidden or background tab does not count as shown. The page closes its SSE stream when hidden (Page Visibility) and reopens it when visible.
2. fleetd runs `git fetch` only when the in-process host read reports a change. A safety-net full read runs every 10 minutes and bounds how late a claim pushed from another machine appears.
3. With no fleetd and no tab, the board may leave everything stale (no fresh readings; board-free merges refuse as stale) until a tab opens; it catches up then.
4. The worker wrapper moves from `sh` to a node bundle first, as the first step of the worker-liveness phase. macOS `sh` has no `flock` and cannot listen on a socket.
5. The channel carries answers (readings); each reader derives its verdicts.
6. jwloka accepted three master-session calls: connectors refresh tokens on expiry (App tokens last 1 h); the working/idle activity reading comes from file events on the worker log; one fleetd per repository stays, and the `plot-registryd` per-machine open point goes, because `plot-registryd` is the old name of the per-repository fleetd.

## Amendments Applied

Each amendment was confirmed against `main` before it was written. A juror tag names every juror that asked for it. Count: 36.

| # | Amendment | Jurors |
|---|---|---|
| 1 | *Placement* paragraph: snapshot is a domain entity; watch port owned by the domain; watcher adapter; change-to-stale table is a domain rule | layering |
| 2 | Per-desk liveness and cleanliness only through the `Processes` port, including `registry.ts` (`:510`) | layering |
| 3 | `last-pulse.json` named as the bridged verdict, not an index file; the snapshot Decisions row's rationale corrected | layering |
| 4 | Snapshot and versioned channel contract (welcome snapshot, deltas, generation, protocol version) as Phase 3, before the board reads it | layering, safety, testability, seams |
| 5 | fleetd liveness on a timer heartbeat, not data age (180 s, 2 min, 15 min checks) | layering, seams |
| 6 | The board's per-tick `plot-fleetctl.sh --status` replaced by the heartbeat and the channel heartbeat | layering, seams |
| 7 | Heartbeat carries observer fields; a reader trusts the snapshot only while they are fresh | safety |
| 8 | Agent registry, supervisor reading and plan content travel in the snapshot | layering, seams |
| 9 | Gate for in-process host requests (only `adapters/host/`); `check-host-cli-callers.sh` greps only shell | layering, seams |
| 10 | One rate budget across both transports through the `Budget` port and `budget.tsv` | layering, safety, seams |
| 11 | Corpus test for every rule copied out of `plot-host.sh` | layering, seams |
| 12 | Merged and `--since` deltas, the issue read and the default-branch re-ask listed with the open-PR read | layering, safety |
| 13 | "Differs" covers every field a rule reads; the `.list-complete` and absent-OPEN-row contracts stay | safety |
| 14 | Token refresh on expiry replaces "token read once at start" | layering, seams |
| 15 | Desk-root directory watch for `PLOT-BLOCKED`, `PLOT-CORRECTION.md`, `.plot-worker.*` | layering, safety |
| 16 | Trigger rows for plan content, the agent registry and worker-log activity | layering, safety |
| 17 | Remote trigger: `git fetch --prune` (every 5 s today, `fleet-scan.ts:713`) runs only on a host change or a safety-net pass | safety, seams |
| 18 | fleetd's `git` probes for the fleet-size decision run on a dispatch decision only | layering |
| 19 | `plot_worker_activity`'s `sleep 0.4` under fleetd named; the `sleep` attribution row corrected | layering |
| 20 | `isAlive` through `process.kill` instead of `bash -c "kill -0"` | layering |
| 21 | The AgentMonitor's per-desk `plot-host.sh pr-state` call named and counted | seams |
| 22 | Destructive local actions (reap, signals, ref deletion, claim release) re-read their evidence immediately before acting | safety |
| 23 | False claim fixed: `kill(pid, 0)` alone cannot replace the start-time check | safety |
| 24 | False claim fixed: the wrapper already writes `.plot-worker.exit` and a `gone`/`clear` line | safety |
| 25 | False claim fixed: the WorkerMonitor process is already removed; the `sleep` is `plot_monitor_wait`'s nap | safety |
| 26 | Liveness token inherited by the agent's process group; reader election, implement lock and continue lock join the phase | safety, seams |
| 27 | Wrapper moves to a node bundle through `detached-node.ts` as Phase 6's first step | layering, seams |
| 28 | Failure modes with answers: directory watches re-armed on `rename`, dropped events, watch limits, reftable, sleep/wake and clock jumps, startup full read | layering, safety, testability, seams |
| 29 | Self-caused events told apart by content; `git --no-optional-locks status` | safety, seams |
| 30 | Corpus test for the ref-file reader and for each function replacing `plot_worker_state` | safety |
| 31 | The no-fleetd, no-tab case stated as fail-closed | safety, seams |
| 32 | The counted unit is `execve` | testability |
| 33 | fleetd measured per completed pass of all four loops, not `--once`; injected clock where one exists; compare against the merge base | testability, seams |
| 34 | Instrument: `strace -f` on Linux CI with a presence check; macOS by documented manual measurement; the proxy kept as an open point | testability |
| 35 | Zero targets written as expected failures; fixtures with stub `gh`, `bb`, tracker and worker; a Bitbucket baseline; Measures in one unit per row | testability, seams |
| 36 | Cheap wins moved to Phase 2: no tab stops the `ensureCache` pulse; builtin wait for the monitors' `sleep 1`; Open Point fixes (Phase 4 → safety net; `plot-registryd`) | testability, seams, safety |

## Disagreements and Picks

| Point | Jurors and positions | Pick | Reason |
|---|---|---|---|
| What the board reads from fleetd | seams: the persisted bridge (`last-pulse.json`) avoids channel versioning. layering, safety, testability: a channel message with a contract | The channel, versioned | jwloka decided the channel carries answers. The bridge holds verdicts, and the board must derive its own. |
| Where the liveness token lives | layering: a node wrapper. testability: a FIFO whose write end the wrapper holds. safety: the agent's process group must hold it, because the agent survives a killed wrapper | A FIFO write end the agent's process group inherits, in a node wrapper | It meets all three: no `ps`, no shell growth, and no false "gone" while the agent lives. |
| Deadline clock | layering: base timers on a monotonic clock. safety, testability, seams: the monotonic clock stops while macOS sleeps, so a timer fires late | Elapsed time on the monotonic clock; deadlines recorded in wall time and re-checked on wake or a clock jump | Both are right about one half. The rules compare wall-clock records (`slice-idle.ts:118-126`). |
| How the gate counts | testability: per tick delimited by a log line. seams: per pass under an injected clock, against the merge base | Both: injected clock where a loop takes one, log-line delimiting elsewhere, comparison against the merge base | The two answers address different loops and do not conflict. |

## Findings Not Taken

- **layering, "base deadline timers on a monotonic clock" alone.** Taken only in part (see Disagreements): a monotonic-only deadline fires late after a macOS sleep.
- **seams, "Phase 2 can ship on the persisted bridge".** Not taken; jwloka's decision 5 sends answers over the channel.
- **The interim "one batched `ps -ax` per safety-net pass".** Removed rather than repaired: no safety-net pass exists before Phase 8, and the start-time check stays on `ps` until Phase 6, counted by the gate.

## Questions Left for a Person

Recorded in the story's Open Points: the Linux `execve` proxy for the macOS cost, a tolerance for non-zero counts, desk findings while fleetd is stopped, and in-process credentials for Bitbucket, Jira and Jenkins.
