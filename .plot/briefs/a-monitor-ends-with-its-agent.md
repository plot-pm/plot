# Implementation brief — two-monitors-watch-the-agent (Ending)

- **Plan (canonical):** `docs/plans/2026-08-30-two-monitors-watch-the-agent.md` on main
- **Branch:** `bug/a-monitor-ends-with-its-agent` (base: `main`)
- **Ends as:** one PR to main
- **Depends on nothing in the plan**, and nothing depends on it. Run it whenever
  a slot is free.

### What to build

Monitors that end when their agent's worker does. Today none do, and nothing in
the plan ever asked them to.

### The measurement that makes this worth doing

**2026-08-30, with 154 monitors alive and 152 of them `ppid=1`:**

```
spawn cost, 100 forks    23.3 ms      ← "tight" by DESIGN-machine.md section 5
after killing the 152    11.6 ms
later, estate quiet       4.8 ms      ← "clear"
```

**The orphans cost half the machine's spawn cost.** Load average was 13.0 before
and after — unchanged — which is precisely why that spec makes spawn cost the
verdict and load average context. Do not use load average to check your work.

### The decisions the plan settles — do not re-derive them

**`wait "$agent"` must stay** (`plot-dispatch.sh:600`). The wrapper starts three
children and waits for one deliberately: waiting on two infinite loops would
hang forever and `.plot-worker.exit` would never be written. Whatever you add,
add it around that, not instead of it.

**The `kill -9` at the bound hits the AGENT, not the wrapper**
(`plot-worker-loop.sh:172`). An afternoon entry in this plan claimed otherwise
and was withdrawn: the wrapper survives and writes the exit file afterwards,
which a killed wrapper could not.

**A monitor must still outlive the agent** long enough to record its finding.
That is the Attaching slice's property and it stays — this slice adds an upper
bound to a lifetime that only had a lower one.

### Measure before you fix — this is the first done-when

**One timed-out run's monitors WERE terminated, by something nobody could
identify.** Its log ends `Terminated: 15` for both. Three explanations were
tested and all three failed:

- `sh` does not signal its background jobs at exit — measured directly, and
  again with `nohup` + `wait` in the wrapper's exact shape
- `plot-dispatch.sh` contains no `kill`
- neither pid appeared in either orphan list killed by hand that day

**So establish the exit path in writing first**, on both paths — an ordinary
finish and a `Worker bound` timeout — with the commands that show it. **A
negative result is a finding**, not a failure. A cleanup bolted onto a mechanism
nobody understands is how the same processes come back under a different parent.

### Done when

The plan's list. Two of them deserve emphasis:

- **assert by pid, not by counting.** "No monitors are running" passes on a
  machine where someone else's run just ended. Capture this worker's monitor
  pids and assert those are gone.
- **the mechanism is a measurement, not a timer.** A monitor exiting after N
  seconds regardless would pass the visible assertions and destroy the property
  the whole plan rests on — a monitor that stops publishing means something.

Plus: `pnpm test`, `pnpm run typecheck`, `pnpm run test:e2e` (with
`env -u PLOT_UNATTENDED`), and the Attaching slice's `--stop` test green
**unedited** — if it needs editing, the upper bound has eaten the lower one.

Changeset: `bumps: skills: plot-dispatch: patch` if the fix lands in the
dispatcher; adjust to what you actually touch.

### Scope guard

The lifetime, and nothing about what monitors measure. Not the WorkerMonitor's
sampling (its own slice, #538), not the channel, not the reap of worktrees.

**If you find monitors that belong to no worktree at all**, report them — they
are the same defect from before this branch and not yours to clean up in a diff.
