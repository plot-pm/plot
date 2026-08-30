## Implementation brief — two-monitors-watch-the-agent (slice 2: Watching the worker)

- **Plan (canonical):** `docs/plans/2026-08-30-two-monitors-watch-the-agent.md` on `main`
- **Branch:** `feature/the-worker-monitor-samples-the-process` (base: `main`)
- **Ends as:** one PR to `main`

Needs `feature/every-worker-is-born-monitored`. Gives the no-op WorkerMonitor
its measurements.

### What to build

Two findings, sampled from the process table on a tight cadence (~30 s), with
the previous answer kept:

| finding | measurement |
|---|---|
| **idle** | pid alive, CPU delta zero across consecutive samples, **tree unchanged, and commits already present** |
| **gone** | pid dead |

Build on `plot_worker_activity()` rather than beside it — it already samples
subtree CPU over `PLOT_ACTIVITY_INTERVAL` (0.4 s) and returns `working`/`idle`.

### The decisions the plan settles — do not re-derive them

**`idle` carries three conditions, and the extra two are not caution.** A worker
waiting on a long model response has the same zero CPU delta as one whose agent
has vanished. What separated the three stalls measured on 2026-08-30 is that
each had **already committed** and then gone quiet:

```
no CPU, tree unchanged, commits present   → idle
no CPU, tree unchanged, no commits yet    → silent (it may be thinking)
no CPU, tree CHANGED between samples      → silent (something is happening)
```

**The middle row is where the false positives would have been.** An agent given
a hard first slice is quiet for a long time with nothing to show; calling that a
stall teaches an operator to ignore the finding.

**Do NOT call it `stalled`.** The spec owns that word for an **Agent** fact —
*"exited 0, unlanded work, no PR"*
([DESIGN-agent.md](../../docs/stories/the-master-agent-holds-the-fleet/DESIGN-agent.md)).
A stalled agent has work to rescue; an idle worker may just be waiting on the
network. An earlier draft reused the name and put a process fact on the agent
side — the exact confusion CLAUDE.md's split exists to prevent.

**Two samples, never one.** A single idle reading is a process between syscalls.
The comparison is the finding, so the monitor keeps the previous answer — one
piece of state, derived rather than recorded: lose it and the next sample
rebuilds it, at one interval's delay.

**This monitor makes NO host call at all.** One that asks the host has become an
AgentMonitor with a fast loop, and the rate problem follows — 127 git processes
per scan is what that costs here.

### Done when

The plan's Watching-the-worker `Done when`. Plus: it publishes the moment a
finding holds and publishes nothing when nothing changed, carrying `finding`,
`since`, `evidence` and `measuredAt`.

**Tested unit-first against mocked ports.** Every branch is reachable that way,
including the ones a real machine will not produce on demand — a pid that dies
mid-sample, a tree that changes between readings. One e2e test in `test/e2e/`
proves the process boundary: a real wrapper, a real publish, a subscriber
receiving it.

Repo gates: `pnpm test`, `pnpm run typecheck`, changeset. Node 24, `corepack pnpm`.

### Scope guard

Owns the WorkerMonitor's sampling. Not the channel protocol (slice 4), not the
AgentMonitor (slice 3), and it writes nothing anywhere.

**The file is `skills/plot/scripts/plot-worker-monitor.sh`**, landed by slice 1
(#536) as a no-op. Its `noop_pass` becomes a real sample; the argument parsing,
the publish path and the main loop stay as they are.

**Do NOT fix the monitor lifetime here, even though you will see it.** Measured
2026-08-30, right after #536 merged: 112 monitor processes running, 56 pairs,
all `ppid=1`. The wrapper starts three children and waits for one
(`plot-dispatch.sh:600`) —

```sh
"$PLOT_WORKER_MONITOR" & "$PLOT_AGENT_MONITOR" &
( <cmd> ) & agent=$!
wait "$agent"; rc=$?; printf "%s" "$rc" > "$PLOT_EXIT_FILE"
```

— then exits, and init adopts the two loops. `wait "$agent"` is correct and must
stay: waiting on all three would hang forever on two infinite loops and the exit
record would never be written. The fix is `kill` of both monitor pids on the
line that writes the exit code, and it lives in **`plot-dispatch.sh`**, in the
wrapper — a different file, a different owner, and the plan records it under
*Where the leak is, and where the fix belongs*.

Mentioned here only so you recognise the orphans rather than diagnosing them
again. **If your own test runs leave monitors behind, that is this defect and
not yours** — `makeSandbox().cleanup` is `fs.rmSync(root)`, which removes a
directory and signals nothing. Clean them up by hand
(`pkill -f plot-worker-monitor`) and carry on; the sandbox helper is correctly
scoped and is not yours to change either.
